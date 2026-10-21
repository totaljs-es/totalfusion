"""TotalFusion Python worker.

Speaks length-prefixed JSON frames with Node.js over stdin/stdout (protocol 1).
Standard library only. Usage: worker.py --path <components directory>
"""

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

PROTOCOL = 1
MAX_FRAME = 64 * 1024 * 1024
MODULE = re.compile(r'^[A-Za-z_]\w*(\.[A-Za-z_]\w*)*$')

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


def send(message):
    data = json.dumps(message, separators=(',', ':'), ensure_ascii=False, allow_nan=False).encode('utf-8')
    if len(data) > MAX_FRAME:
        raise ValueError('The result is larger than %d MB' % (MAX_FRAME // 1024 // 1024))
    with lock:
        try:
            out.write(struct.pack('>I', len(data)) + data)
            out.flush()
        except (BrokenPipeError, OSError):
            os._exit(0)


def fail(id, name, message, code=None, tb=None):
    error = {'name': name, 'message': message}
    if code:
        error['code'] = code
    if tb:
        error['traceback'] = tb
    send({'t': 'res', 'id': id, 'ok': False, 'error': error})


def resolve(name):
    """Only functions defined in modules inside the components directory can be called."""

    if name in resolved:
        return resolved[name]

    module_name, _, func_name = name.rpartition('.')

    if not module_name or not MODULE.match(module_name) or not func_name or func_name.startswith('_'):
        raise LookupError('Invalid function name "%s", expected "module.function"' % name)

    try:
        module = importlib.import_module(module_name)
    except ModuleNotFoundError as e:
        if e.name and module_name.split('.')[0] == e.name.split('.')[0]:
            raise LookupError('Module "%s" not found in %s' % (module_name, root))
        raise

    file = getattr(module, '__file__', None)

    if not file or not os.path.realpath(file).startswith(root + os.sep):
        raise LookupError('Module "%s" is not a component of %s' % (module_name, root))

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


async def run(loop, message):

    id = message['id']
    entry = running[id]

    try:
        fn = resolve(message['fn'])

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


def stop(loop):
    for entry in list(running.values()):
        entry['task'].cancel()
    loop.call_later(0.05, lambda: os._exit(0))


def read(loop):
    try:
        while True:
            head = inp.read(4)
            if len(head) < 4:
                break
            (length,) = struct.unpack('>I', head)
            if length == 0 or length > MAX_FRAME:
                break
            body = inp.read(length)
            if len(body) < length:
                break
            loop.call_soon_threadsafe(dispatch, loop, json.loads(body))
    except Exception:
        pass
    finally:
        # The parent is gone or closed the pipe
        loop.call_soon_threadsafe(stop, loop)


def main():

    global root

    args = sys.argv[1:]
    path = args[args.index('--path') + 1] if '--path' in args else os.getcwd()
    root = os.path.realpath(path)
    sys.path.insert(0, root)

    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)

    send({'t': 'ready', 'v': PROTOCOL, 'pid': os.getpid(), 'python': sys.version.split()[0]})
    threading.Thread(target=read, args=(loop,), daemon=True).start()
    loop.run_forever()


if __name__ == '__main__':
    main()
