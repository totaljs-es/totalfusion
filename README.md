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

Throughput with 4 workers and trivial calls: about 23,000 calls/s. These numbers are a starting point, not a benchmark suite. Large binary payloads currently go through JSON, and a dedicated binary channel is planned.

## Security

Workers are ordinary child processes. They run your Python code with your user's permissions and inherit the environment (pass `env` to restrict it). **A worker is not a sandbox**: only run components you trust. Function names are restricted to your components directory, but that is a guard against mistakes, not a security boundary.

## Tests

```bash
npm test
```

## License

MIT
