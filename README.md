# TotalFusion

Persistent, supervised workers for Node.js. Call functions written in other languages as plain `async` functions. Python is the first runtime.

```js
const fusion = require('totalfusion');

const result = await fusion.python('analyzer.analyze', { text: 'Hello world' });
```

```python
# python/analyzer.py
def analyze(data):
    return { 'success': True, 'result': len(data['text']) }
```

No process management, no IPC, no serialization code: a pool of long-lived workers, correlated calls, timeouts, cancellation and real Python tracebacks in your JavaScript errors.

## Install

```bash
npm install totalfusion
```

Requires Node.js 20+ and Python 3.9+ already installed. TotalFusion never installs anything on your system. The worker uses only the Python standard library.

## Usage

```js
fusion.configure({
    python: {
        path: './python',      // directory with your components (default: ./python)
        workers: 4,            // pool size, started on demand (default: 1)
        timeout: 30000,        // ms per call, 0 disables (default: 30000)
        preload: ['classifier'], // modules to import (and run @startup) before a worker is ready
        maxQueue: 1000,        // pending calls before QUEUE_FULL (default: 1000)
        venv: './.venv'        // use the interpreter of a virtual environment
    }
});

await fusion.python('module.function', args, { timeout: 5000, signal });
await fusion.call('python', 'module.function', args);   // generic form

fusion.stats();                // { python: { workers, ready, busy, queued } }
await fusion.shutdown();       // also done automatically when the process exits
```

`configure()` must run before the first call. The interpreter is chosen in this order: `python` option, `venv` option, `TOTALFUSION_PYTHON`, then `python3` (`python` on Windows).

### Writing components

A component is a Python module inside `path`. Every public function defined in it can be called from Node.js with one argument (any JSON value) and returns any JSON value. Functions can be `def` or `async def`.

- Use `__all__` to expose an explicit list instead.
- Names starting with `_` and names imported from other modules are not callable.
- Modules outside `path` (standard library, site-packages) cannot be called. Import them from your own component instead.
- `print()` and anything written to stdout goes to stderr, so it never breaks the protocol.

### Contracts and hooks

```python
from totalfusion import action, startup, shutdown

model = None

@startup
def load():                       # once per worker, right after the module is imported
    global model
    model = load_my_model()

@shutdown
def unload():                     # when the worker stops gracefully (1.5 s at most)
    model.close()

@action(summary='Classifies a text', input='*text:String // Text to classify', output='label:String', mcp=True)
def classify(data):
    return { 'label': model.predict(data['text']) }
```

`@action` declares the contract: `summary`, `input`, `output` (Total.js schema syntax), `mcp`, `permissions`, `timeout` and `name`/`id`. Its arguments are read **statically** (they must be literals), so `fusion.describe('python')` lists every contract without importing your code and without loading any model.

`@startup` and `@shutdown` can be `def` or `async def`. To load a model **before** the worker reports ready (so the first call is not slow), name the module in `preload`: `fusion.configure({ python: { preload: ['classifier'] } })`. A module that cannot be preloaded fails the start with the real traceback in `err.stderr`.

### Models and memory

Every worker is a separate process with **its own copy of the model**, so memory grows with `workers`. Measured on a MacBook (8 cores, Python 3.12, physical footprint from `footprint`, not `ps`, which under-reports compressed memory on macOS):

| Model | Per worker | 1 worker | 2 workers | 4 workers |
|---|---|---|---|---|
| scikit-learn random forest ([classifier.py](examples/components/classifier.py)) | 129 MB | 150 calls/s | - | 554 calls/s (516 MB) |
| DistilBERT sentiment with PyTorch ([sentiment.py](examples/components/sentiment.py)) | 1.35 GB | 186 calls/s | 274-309 calls/s (2.7 GB) | 334-366 calls/s (5.4 GB) |

The DistilBERT call takes about 5-7 ms for a sentence and 25 ms for 1,900 characters. A worker is ready in about 2.5 s (PyTorch import plus the model, from a warm disk cache), against 2.7-3.3 s **per call** when a process is spawned each time.

What to do with it:

- **Small models:** one worker per core you want to use scales almost linearly.
- **Large models:** start with `workers: 1` or `2`. PyTorch already uses several threads inside one process, so four workers gave +20% throughput over two for twice the memory. Setting `OMP_NUM_THREADS` through the `env` option did not change that noticeably.
- **Use `preload`.** The `timeout` of a call starts when it is sent to a worker, so a model loaded lazily on the first call would count its loading time against that call. With `preload` the worker reports ready only after loading, and the load has its own limit (`startTimeout`, 30 s by default, raise it for big models).
- **Use `warmup`.** Workers start with the first call. `await fusion.warmup('python')` (or `register({ warmup: true })`) starts them all at boot, so the first request does not wait for the model: the first request through MCP went from 2.4 s to about 22 ms (later ones take 9-12 ms), with the boot taking the 2.6 s instead.
- **Keep input shapes fixed.** PyTorch on CPU prepares its kernels per tensor shape, and the first call with each new sequence length took 130-250 ms. Padding to a fixed length in `@startup` and in the function removed every slow call (40 different sentences, all between 7 and 9 ms). See [sentiment.py](examples/components/sentiment.py).

### Total.js 5

```js
const { register } = require('totalfusion/total5');

await register({ python: { path: PATH.root('python'), workers: 2 } });
```

Every function decorated with `@action` becomes a `NEWACTION()` named `<module>/<function>` (change it with `prefix` or `@action(id=...)`). Because they are normal actions they work with `ACTION()`, `API` routes and FlowStream. `register` also adds the modules with `@startup` to `preload` automatically.

- **Validation first.** Total.js validates `input` with the contract before Python runs, so invalid data never reaches your function.
- **MCP is opt-in.** Only functions with `mcp=True` are exposed to agents (`CONF.$mcp = true` enables the endpoint). Everything else stays internal.
- **Errors.** A Python `ValueError` is treated as the caller's mistake and its message reaches the client. Any other exception returns `The action failed`, and the real error goes to `onerror` (default: `console.error`), so paths, queries or secrets inside exception messages are not leaked.
- **Boot.** `register({ warmup: true })` loads the models before it resolves, and `preload: false` leaves the modules with `@startup` to load on their first call.
- **Schemas.** Total.js splits the fields of a schema on commas **even inside a `// comment`**, so `'*text:String // Text, up to 2000 chars'` declares a second field called `up to 2000 chars`. `register` returns a `warnings` list for it: use parentheses or a new line.
- Needs a Total.js 5 version that includes `mcp.js` for the MCP part (the actions work with any `total5`).

### Errors

Every error is a `FusionError` with a stable `code`.

| Code | Meaning |
|---|---|
| `REMOTE_ERROR` | The Python function raised. `err.remote` has `name`, `message` and `traceback`, and the traceback is appended to `err.stack`. |
| `TIMEOUT` / `ABORTED` | The call exceeded its timeout or its `AbortSignal` fired. |
| `WORKER_CRASHED` | The worker died during the call. The call is **not** retried, because it may have had side effects. The worker is replaced. |
| `QUEUE_FULL` | The bounded queue is full: backpressure instead of unbounded memory growth. |
| `NOT_FOUND` | Unknown module or function (or not exposed). |
| `NOT_SERIALIZABLE` / `ENCODE_ERROR` | The result / the arguments are not valid JSON. |
| `SPAWN_FAILED` / `START_FAILED` | The interpreter was not found or the worker cannot start. |
| `CLOSED` | The pool was shut down while the call was pending. |

### Cancellation

`async def` functions are cancelled for real (`asyncio` cancellation). Synchronous functions cannot be interrupted: after a timeout the caller is rejected immediately, and if the function does not finish within `cancelGrace` (2 s) the worker is killed and replaced.

## How it works

Each worker is a Python process that talks to Node.js over stdin/stdout with length-prefixed JSON frames (protocol version 1, see [lib/protocol.js](lib/protocol.js)). Calls carry an id, so responses never mix under concurrency. Workers start on demand, are replaced when they crash, exit when the parent dies and do not keep your Node.js process alive while idle.

Measured on one machine (Python 3.15, Node 24, macOS arm64), warm workers, JSON payloads:

| Scenario | p50 | p99 |
|---|---|---|
| `child_process` spawn per call | 17.6 ms | 19.8 ms |
| TotalFusion, small call | 0.07 ms | 0.12 ms |
| TotalFusion, 1 MB payload round trip | 3.0 ms | 4.4 ms |
| TotalFusion, 32 MB payload round trip | 104 ms | 120 ms |

With a real library (NumPy in a virtual environment, nearest neighbours over 50,000 vectors of 128 dimensions, see [examples/components/vectors.py](examples/components/vectors.py)): the worker starts and builds the index once (about 145 ms with a warm disk cache), then every call takes about 3 ms (p50), against about 98 ms when a process is spawned per call.

Throughput with 4 workers and trivial calls: about 23,000 calls/s. These numbers are a starting point, not a benchmark suite. Large binary payloads currently go through JSON, and a dedicated binary channel is planned.

## Security

Workers are ordinary child processes. They run your Python code with your user's permissions and inherit the environment (pass `env` to restrict it). **A worker is not a sandbox**: only run components you trust. Function names are restricted to your components directory, but that is a guard against mistakes, not a security boundary.

## Tests

```bash
npm test
```

## License

MIT
