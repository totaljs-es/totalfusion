# Python

Write functions in Python and call them from Node.js and Total.js as `async` functions. Python is the right choice when you need its ecosystem: machine learning, scientific computing, data processing, any library that only exists for Python.

## Quick start

```python
# python/analyzer.py
from totalfusion import action

@action(summary='Counts the words of a text', input='*text:String', output='words:Number', mcp=True)
def analyze(data):
    return {'words': len(data['text'].split())}
```

```js
// any Node.js program
const fusion = require('totalfusion');
const result = await fusion.python('analyzer.analyze', { text: 'Hello world' });   // { words: 2 }
```

```js
// a Total.js application: the function becomes the action 'analyzer/analyze'
await REQUIRE('totalfusion').register({ python: { path: PATH.root('python') } });
```

## Requirements and the environment

- **Python 3.9 or newer.** The test suite has been run on 3.9, 3.10, 3.11, 3.12, 3.13, 3.14 and 3.15. The worker uses only the standard library.
- **TotalFusion never installs anything.** You create the environment and install the libraries your components need.
- **The interpreter** is chosen in this order: the `python` option, the `venv` option, the `TOTALFUSION_PYTHON` variable, then `python3` (`python` on Windows).
- **Use a virtual environment.** The libraries you install are then yours alone:

```bash
python3 -m venv .venv
.venv/bin/python -m pip install numpy scikit-learn
```

```js
fusion.configure({ python: { path: './python', venv: './.venv' } });
```

- **Check it** before running anything with `npx totalfusion doctor --path ./python --venv ./.venv`: it tells you which libraries are missing and the exact command to install them in the right Python. See [Development and diagnosis](development.md#checking-your-setup).

## Writing components

A component is a Python module inside `path`. Every public function defined in it can be called from Node.js with one argument (any JSON value) and returns any JSON value. Functions can be `def` or `async def`.

- Use `__all__` to expose an explicit list instead.
- Names starting with `_` and names imported from other modules are not callable.
- Modules outside `path` (standard library, site-packages) cannot be called. Import them from your own component instead.
- `print()` and anything written to stdout goes to stderr, so it never breaks the protocol.
- **Components are always loaded from their source.** Python trusts a `.pyc` when the modification time of the source (in whole seconds) and its size have not changed, so a file saved twice within a second without changing its size would keep running the old code, even in a new worker. TotalFusion never reads or writes bytecode for your components, which also means it never leaves a `__pycache__` next to your files. The libraries you import (NumPy, PyTorch, the standard library) keep their own bytecode.

## Contracts and hooks

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

`@action` declares the contract: `summary`, `input`, `output`, `query`, `params` (Total.js schema syntax), `mcp`, `permissions`, `user`, `sa`, `su`, `idempotent`, `timeout` and `name`/`id`. Its arguments are read **statically** (they must be literals), so `fusion.describe('python')` lists every contract without importing your code and without loading any model.

`@startup` and `@shutdown` can be `def` or `async def`. To load a model **before** the worker reports ready (so the first call is not slow), name the module in `preload`: `fusion.configure({ python: { preload: ['classifier'] } })`. A module that cannot be preloaded fails the start with the real traceback in `err.stderr`.

## Models and memory

Every worker is a separate process with **its own copy of the model**, so memory grows with `workers`. Measured on a MacBook (8 cores, Python 3.12, physical footprint from `footprint`, not `ps`, which under-reports compressed memory on macOS):

| Model | Per worker | 1 worker | 2 workers | 4 workers |
|---|---|---|---|---|
| scikit-learn random forest ([classifier.py](../examples/components/classifier.py)) | 129 MB | 150 calls/s | - | 554 calls/s (516 MB) |
| DistilBERT sentiment with PyTorch ([sentiment.py](../examples/components/sentiment.py)) | 1.35 GB | 186 calls/s | 274-309 calls/s (2.7 GB) | 334-366 calls/s (5.4 GB) |

The DistilBERT call takes about 5-7 ms for a sentence and 25 ms for 1,900 characters. A worker is ready in about 2.5 s (PyTorch import plus the model, from a warm disk cache), against 2.7-3.3 s **per call** when a process is spawned each time.

What to do with it:

- **Small models:** one worker per core you want to use scales almost linearly.
- **Large models:** start with `workers: 1` or `2`. PyTorch already uses several threads inside one process, so four workers gave +20% throughput over two for twice the memory. Setting `OMP_NUM_THREADS` through the `env` option did not change that noticeably.
- **Use `preload`.** The `timeout` of a call starts when it is sent to a worker, so a model loaded lazily on the first call would count its loading time against that call. With `preload` the worker reports ready only after loading, and the load has its own limit (`startTimeout`, 30 s by default, raise it for big models).
- **Use `warmup`.** Workers start with the first call. `await fusion.warmup('python')` (or `fusion.register({ warmup: true })`) starts them all at boot, so the first request does not wait for the model: the first request through MCP went from 2.4 s to about 22 ms (later ones take 9-12 ms), with the boot taking the 2.6 s instead.
- **Keep input shapes fixed.** PyTorch on CPU prepares its kernels per tensor shape, and the first call with each new sequence length took 130-250 ms. Padding to a fixed length in `@startup` and in the function removed every slow call (40 different sentences, all between 7 and 9 ms). See [sentiment.py](../examples/components/sentiment.py).

## How a call runs

- A function receives **one argument**, any JSON value (usually a dict), and returns any JSON value. `def` and `async def` are both fine, and a function that yields is a [stream](streaming.md).
- `async def` functions run in the event loop of the worker and overlap. `def` functions run in a pool of threads, as many as `concurrency` allows (at least 8).
- With `concurrency: 1`, the default, a worker runs one call at a time and the work is spread over the processes. See [Several calls at the same time](workers.md#several-calls-at-the-same-time) for what changes when you raise it: calls that overlap in a worker **share the state of its modules**, and because of the GIL, computation in pure Python does not speed up with threads (use more workers for it).
- A `def` function cannot be interrupted. After a timeout the caller is rejected at once, and if the function does not return within `cancelGrace` the worker is killed and replaced. An `async def` function is cancelled for real. See [Errors and cancellation](errors.md#cancellation).
- **Components are loaded from their source every time.** Edit a file and the next worker runs the new code, even if you saved twice within a second.

## What crosses the boundary

| JavaScript | Python |
|---|---|
| object, array, string, number, boolean, `null` | `dict`, `list`, `str`, `int` or `float`, `bool`, `None` |
| `Buffer`, `Uint8Array`, `ArrayBuffer` | `bytes` |
| `Float32Array`, `Float64Array`, `Int32Array`... | `memoryview` of the matching type, without copying |

From Python, `bytes`, `bytearray`, `memoryview`, `array.array` and anything with the buffer protocol (NumPy arrays included) go back as a `Buffer` or the matching typed array. Tuples go back as arrays. A value that is not JSON (a `set`, an object of your own) fails with `NOT_SERIALIZABLE`, and so do `NaN` and infinity. See [Binary data](binary-data.md) for the details and the numbers.

## Options of the Python runtime

`path`, `venv`, `python`, `preload` and `requirements` are specific to Python. `workers`, `concurrency`, `timeout`, `maxQueue`, `startTimeout`, `cancelGrace`, `maxCalls`, `maxMemory`, `healthInterval`, `healthTimeout`, `forwardStderr` and `env` are shared. All of them are in the [reference](reference.md#options).

## When something goes wrong

| What you see | Why, and what to do |
|---|---|
| `ModuleNotFoundError` | A library is not installed **in the Python that runs the workers**. `err.hint` has the command to install it there. |
| `NOT_FOUND` for a function that exists | Only public functions defined in modules inside `path` can be called: names that start with `_`, names imported from other modules and modules outside `path` are not exposed. |
| The first call is slow | The model loads when the worker starts. Use `preload` and `fusion.warmup('python')` so it loads at boot. |
| `print()` shows up in the terminal of the application | What a worker writes to its standard output goes to the error output, so it never breaks the protocol. `forwardStderr: false` hides it. |
| Memory grows over the days | Libraries for machine learning tend to leak: use `maxCalls` or `maxMemory` and the worker is replaced without losing a call. See [Keeping workers healthy](workers.md#keeping-workers-healthy). |
| A call never returns | Set a `timeout`. A `def` function that cannot be cancelled costs its worker. |
