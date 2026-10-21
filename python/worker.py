"""TotalFusion Python worker.

Speaks length-prefixed frames with Node.js over stdin/stdout (protocol 2): JSON plus raw binary parts.
Standard library only.

    worker.py --path <components directory> [--preload module,module]
    worker.py --path <components directory> --describe
"""

import array
import ast
import asyncio
import importlib
import inspect
import json
import os
import re
import struct
import sys
import threading
import traceback
from concurrent.futures import ThreadPoolExecutor

PROTOCOL = 2
MAX_FRAME = 512 * 1024 * 1024
MAX_JSON = 64 * 1024 * 1024

# Binary data crosses the protocol as raw bytes, not as JSON. These are the typed arrays of JavaScript
# (little endian) and the formats of Python buffers (bytes, bytearray, memoryview, array.array, numpy arrays).
FORMATS = {'Int8Array': 'b', 'Uint8Array': 'B', 'Int16Array': 'h', 'Uint16Array': 'H', 'Int32Array': 'i', 'Uint32Array': 'I', 'Float32Array': 'f', 'Float64Array': 'd', 'BigInt64Array': 'q', 'BigUint64Array': 'Q'}
NAMES = {('b', 1): 'Int8Array', ('B', 1): 'Uint8Array', ('?', 1): 'Uint8Array', ('c', 1): 'Uint8Array', ('h', 2): 'Int16Array', ('H', 2): 'Uint16Array', ('i', 4): 'Int32Array', ('I', 4): 'Uint32Array', ('l', 4): 'Int32Array', ('L', 4): 'Uint32Array', ('l', 8): 'BigInt64Array', ('L', 8): 'BigUint64Array', ('q', 8): 'BigInt64Array', ('Q', 8): 'BigUint64Array', ('f', 4): 'Float32Array', ('d', 8): 'Float64Array'}
MODULE = re.compile(r'^[A-Za-z_]\w*(\.[A-Za-z_]\w*)*$')
SKIP = ('node_modules', 'venv', 'site-packages')

# The real stdout is reserved for the protocol. Everything that prints
# (including C extensions writing to fd 1) goes to stderr instead.
out = os.fdopen(os.dup(1), 'wb')
os.dup2(2, 1)
sys.stdout = sys.stderr
inp = os.fdopen(os.dup(0), 'rb')
os.dup2(os.open(os.devnull, os.O_RDONLY), 0)

root = ''
lock = threading.Lock()
executor = ThreadPoolExecutor(max_workers=8)
running = {}
resolved = {}
modules = {}
stopping = False


def pack(obj, parts):
    """json.dumps hook: buffers go to `parts` and are replaced by a reference."""

    # numpy scalars and 0-d arrays are numbers, not binary data
    if getattr(obj, 'shape', None) == () and hasattr(obj, 'item'):
        return obj.item()

    try:
        view = memoryview(obj)
    except TypeError:
        raise TypeError('Object of type %s is not JSON serializable' % type(obj).__name__)

    code = view.format.lstrip('@<>=!')
    name = NAMES.get((code, view.itemsize), 'Uint8Array')

    # JavaScript typed arrays are little endian. A big-endian buffer (for example numpy '>f4') is converted.
    if view.format[:1] in ('>', '!') and view.itemsize > 1:
        if code not in array.typecodes:
            raise TypeError('Big-endian buffers of format "%s" are not supported, convert them to little-endian first' % view.format)
        swapped = array.array(code)
        swapped.frombytes(view.tobytes())
        swapped.byteswap()
        raw = memoryview(swapped).cast('B')
    else:
        try:
            raw = view.cast('B') if (view.ndim != 1 or view.format != 'B') else view
        except (TypeError, ValueError):
            raw = memoryview(view.tobytes())

    parts.append(raw)
    return {'$bin': len(parts) - 1, 'type': name}


def send(message):

    parts = []
    text = json.dumps(message, default=lambda obj: pack(obj, parts), separators=(',', ':'), ensure_ascii=False, allow_nan=False).encode('utf-8')

    if len(text) > MAX_JSON:
        raise ValueError('The JSON part of the result is larger than %d MB' % (MAX_JSON // 1024 // 1024))

    table = struct.pack('>I', len(parts)) + b''.join(struct.pack('>I', len(part)) for part in parts)
    total = 4 + len(text) + len(table) + sum(len(part) for part in parts)

    if total > MAX_FRAME:
        raise ValueError('The result is larger than %d MB' % (MAX_FRAME // 1024 // 1024))

    with lock:
        try:
            out.write(struct.pack('>II', total, len(text)))
            out.write(text)
            out.write(table)
            for part in parts:
                out.write(part)
            out.flush()
        except (BrokenPipeError, OSError):
            os._exit(0)


def decode(body):

    view = memoryview(body)
    (length,) = struct.unpack_from('>I', body, 0)
    text = bytes(view[4:4 + length])
    (count,) = struct.unpack_from('>I', body, 4 + length)
    lengths = struct.unpack_from('>%dI' % count, body, 8 + length)
    offset = 8 + length + 4 * count
    parts = []

    for size in lengths:
        parts.append(view[offset:offset + size])
        offset += size

    if offset != len(body):
        raise ValueError('Invalid frame')

    def reference(value):
        if len(value) == 2 and type(value.get('$bin')) is int and value.get('type') in FORMATS and 0 <= value['$bin'] < len(parts):
            part = parts[value['$bin']]
            # Buffer and Uint8Array arrive as bytes, the other typed arrays as a memoryview without copying
            return bytes(part) if value['type'] == 'Uint8Array' else part.cast(FORMATS[value['type']])
        return value

    return json.loads(text, object_hook=reference) if parts else json.loads(text)


def fail(id, name, message, code=None, tb=None):
    error = {'name': name, 'message': message}
    if code:
        error['code'] = code
    if tb:
        error['traceback'] = tb
    send({'t': 'res', 'id': id, 'ok': False, 'error': error})


def hooks(module, attribute):
    """Functions defined in the module (not imported into it) marked by the SDK decorators."""
    return [fn for fn in vars(module).values() if callable(fn) and getattr(fn, attribute, False) and getattr(fn, '__module__', None) == module.__name__]


async def invoke(fn, *args):
    """Sync hooks run in a thread so a long model load does not block the worker's event loop."""

    if inspect.iscoroutinefunction(fn):
        return await fn(*args)

    result = await asyncio.get_running_loop().run_in_executor(executor, fn, *args)

    if inspect.isawaitable(result):
        result = await result

    return result


async def load(loop, name):
    """Imports a component once per worker and runs its startup hooks. Concurrent callers share the same load."""

    if name not in modules:
        modules[name] = loop.create_task(import_module(loop, name))

    try:
        return await asyncio.shield(modules[name])
    except BaseException:
        modules.pop(name, None)
        raise


async def import_module(loop, name):

    try:
        module = await loop.run_in_executor(executor, importlib.import_module, name)
    except ModuleNotFoundError as e:
        if e.name and name.split('.')[0] == e.name.split('.')[0]:
            raise LookupError('Module "%s" not found in %s' % (name, root))
        raise

    file = getattr(module, '__file__', None)

    if not file or not os.path.realpath(file).startswith(root + os.sep):
        raise LookupError('Module "%s" is not a component of %s' % (name, root))

    for fn in hooks(module, '__fusion_startup__'):
        await invoke(fn)

    return module


async def resolve(loop, name):
    """Only functions defined in modules inside the components directory can be called."""

    if name in resolved:
        return resolved[name]

    module_name, _, func_name = name.rpartition('.')

    if not module_name or not MODULE.match(module_name) or not func_name or func_name.startswith('_'):
        raise LookupError('Invalid function name "%s", expected "module.function"' % name)

    module = await load(loop, module_name)
    fn = getattr(module, func_name, None)
    exported = getattr(module, '__all__', None)

    if exported is not None:
        allowed = func_name in exported
    else:
        allowed = getattr(fn, '__module__', None) == module.__name__

    if not callable(fn) or not allowed:
        raise LookupError('Function "%s" not found in module "%s"' % (func_name, module_name))

    resolved[name] = fn
    return fn


def decorator(node, name):
    """Returns the decorator call (or True for a bare decorator) when `node` is decorated with `name`."""

    for item in node.decorator_list:
        target = item.func if isinstance(item, ast.Call) else item
        found = target.id if isinstance(target, ast.Name) else (target.attr if isinstance(target, ast.Attribute) else None)
        if found == name:
            return item
    return None


def describe():
    """Reads the contracts declared with @action without importing anything (no side effects, no models loaded)."""

    actions = []
    startups = []
    errors = []

    for folder, dirs, files in os.walk(root):

        dirs[:] = sorted(d for d in dirs if not d.startswith(('.', '_')) and d not in SKIP)

        for file in sorted(files):

            if not file.endswith('.py') or file.startswith('_'):
                continue

            path = os.path.join(folder, file)
            module = os.path.relpath(path, root)[:-3].replace(os.sep, '.')

            try:
                with open(path, encoding='utf-8') as f:
                    tree = ast.parse(f.read(), path)
            except (SyntaxError, UnicodeDecodeError, ValueError) as e:
                errors.append({'module': module, 'message': '%s: %s' % (type(e).__name__, e)})
                continue

            for node in tree.body:

                if not isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
                    continue

                if decorator(node, 'startup') and module not in startups:
                    startups.append(module)

                found = decorator(node, 'action')

                if found is None or node.name.startswith('_'):
                    continue

                try:
                    meta = {kw.arg: ast.literal_eval(kw.value) for kw in found.keywords if kw.arg} if isinstance(found, ast.Call) else {}
                except ValueError:
                    errors.append({'module': module, 'function': node.name, 'message': 'The arguments of @action must be literals'})
                    continue

                actions.append({
                    'fn': module + '.' + node.name,
                    'module': module,
                    'name': node.name,
                    'async': isinstance(node, ast.AsyncFunctionDef),
                    'doc': ast.get_docstring(node),
                    'meta': meta
                })

    return {'actions': actions, 'startups': startups, 'errors': errors}


async def run(loop, message):

    id = message['id']
    entry = running[id]

    try:
        fn = await resolve(loop, message['fn'])

        if inspect.iscoroutinefunction(fn):
            entry['async'] = True
            result = await fn(message.get('args'))
        else:
            result = await loop.run_in_executor(executor, fn, message.get('args'))

        try:
            send({'t': 'res', 'id': id, 'ok': True, 'data': result})
        except (TypeError, ValueError) as e:
            fail(id, type(e).__name__, 'The result cannot be serialized to JSON: %s' % e, 'NOT_SERIALIZABLE')

    except asyncio.CancelledError:
        fail(id, 'CancelledError', 'The call was cancelled', 'CANCELLED')
    except LookupError as e:
        fail(id, 'LookupError', str(e).strip('"\''), 'NOT_FOUND')
    except BaseException as e:
        fail(id, type(e).__name__, str(e), None, traceback.format_exc())
    finally:
        running.pop(id, None)


def dispatch(loop, message):

    kind = message.get('t')

    if kind == 'call':
        running[message['id']] = {'async': False, 'task': loop.create_task(run(loop, message))}
    elif kind == 'cancel':
        # Only coroutines can be interrupted. Sync functions run in a thread and
        # cannot be stopped: the parent kills the worker if it does not finish in time.
        entry = running.get(message.get('id'))
        if entry and entry['async']:
            entry['task'].cancel()
    elif kind == 'ping':
        send({'t': 'pong', 'id': message.get('id')})
    elif kind == 'bye':
        stop(loop)


async def finish():

    for entry in list(running.values()):
        entry['task'].cancel()

    for name, task in list(modules.items()):
        if task.done() and not task.cancelled() and not task.exception():
            for fn in hooks(task.result(), '__fusion_shutdown__'):
                try:
                    await asyncio.wait_for(invoke(fn), 1.5)
                except BaseException:
                    traceback.print_exc()

    os._exit(0)


def stop(loop):
    global stopping
    if not stopping:
        stopping = True
        loop.create_task(finish())


def read(loop):
    try:
        while True:
            head = inp.read(4)
            if len(head) < 4:
                break
            (total,) = struct.unpack('>I', head)
            if total < 8 or total > MAX_FRAME:
                break
            body = inp.read(total)
            if len(body) < total:
                break
            loop.call_soon_threadsafe(dispatch, loop, decode(body))
    except Exception:
        traceback.print_exc()
    finally:
        # The parent is gone or closed the pipe
        loop.call_soon_threadsafe(stop, loop)


def main():

    global root

    args = sys.argv[1:]
    path = args[args.index('--path') + 1] if '--path' in args else os.getcwd()
    root = os.path.realpath(path)

    if '--describe' in args:
        out.write(json.dumps(describe()).encode('utf-8'))
        out.flush()
        os._exit(0)

    sys.path.insert(0, root)
    sys.path.append(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'sdk'))

    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)

    # Heavy initialization (models, connections) happens before the worker reports ready
    preload = args[args.index('--preload') + 1].split(',') if '--preload' in args else []

    for name in filter(None, preload):
        try:
            loop.run_until_complete(load(loop, name))
        except BaseException:
            print('TotalFusion: cannot preload "%s"' % name, file=sys.stderr)
            traceback.print_exc()
            os._exit(1)

    send({'t': 'ready', 'v': PROTOCOL, 'pid': os.getpid(), 'python': sys.version.split()[0]})
    threading.Thread(target=read, args=(loop,), daemon=True).start()
    loop.run_forever()


if __name__ == '__main__':
    main()
