# TotalFusion

**Extends the capabilities of Total.js with other runtimes.** Python and Rust today: bring machine learning, scientific computing, any Python library and native speed into a Total.js application as ordinary Actions, API endpoints and MCP tools, without leaving JavaScript.

```python
# python/sentiment.py
from totalfusion import action

@action(summary='Detects the sentiment of a text', input='*text:String', output='label:String', mcp=True)
def analyze(data):
    return { 'label': 'POSITIVE' if 'love' in data['text'] else 'NEGATIVE' }
```

```js
// Total.js application
const fusion = REQUIRE('totalfusion');

await fusion.register({ python: { path: PATH.root('python') } });

// 'sentiment/analyze' is now a Total.js action: ACTION(), API routes and an MCP tool for AI agents
```

Total.js validates the input with the contract before Python runs, and the same function can be called from your own code:

```js
const result = await ACTION('sentiment/analyze', { text: 'I love it' }).promise();
```

Under the hood there is a pool of long-lived worker processes, correlated calls, timeouts, cancellation and real Python tracebacks in your JavaScript errors. That engine (`require('totalfusion')`) is plain Node.js and does not depend on Total.js, so `fusion.python('module.function', data)` also works in any Node.js application.

## Install

```bash
npm install totalfusion
```

Add it to your Total.js 5 project. It requires Node.js 20+ and Python 3.9+ already installed. TotalFusion never installs anything on your system. The worker uses only the Python standard library.

## Examples

All of them run from a clone of the repository:

| | |
|---|---|
| [examples/totaljs-app](examples/totaljs-app) | A Total.js 5 application with Python: actions, an API route, Server-Sent Events and reload on edit. `npm install && npm start`. |
| [examples/basic.js](examples/basic.js) | `fusion.python()` in any Node.js program. |
| [examples/streaming.js](examples/streaming.js) | A Python generator as an async iterable, and cancelling it. |
| [examples/rust.js](examples/rust.js) | The Rust worker of [examples/rust](examples/rust) (build it first with `cargo build --release`). |
| [examples/components](examples/components) | Components that use scikit-learn, NumPy and PyTorch (they need those libraries in your Python). |

## Compatibility

What the test suite (more than 230 tests, more than 170 of them without Rust) has been run against:

| | Verified |
|---|---|
| Node.js | 20, 22, 24 |
| Python | 3.9, 3.10, 3.11, 3.12, 3.13, 3.14, 3.15 |
| Total.js | `total5` 0.0.19-8 from npm and the 0.0.20 development version |
| Rust | 1.99 (the `totalfusion` crate and its worker) |
| Operating system | macOS on Apple silicon |

Linux and Windows are **not verified yet**. The code for them is written (binary pipes and memory of a worker on Windows, in Python and in Rust) and the Rust crate compiles for `x86_64-pc-windows-msvc` and `x86_64-unknown-linux-gnu`, but it has not been run there. The GitHub Actions workflow in [.github/workflows/test.yml](.github/workflows/test.yml) runs the suite on Linux, macOS and Windows with those Node.js and Python versions, but it has not run yet.

## Usage

```js
fusion.configure({
    python: {
        path: './python',      // directory with your components (default: ./python)
        workers: 4,            // pool size, started on demand (default: 1)
        concurrency: 1,        // calls a worker runs at the same time (default: 1)
        timeout: 30000,        // ms per call, 0 disables (default: 30000)
        preload: ['classifier'], // modules to import (and run @startup) before a worker is ready
        maxQueue: 1000,        // pending calls before QUEUE_FULL (default: 1000)
        maxCalls: 5000,        // replace a worker after this many calls (default: never)
        maxMemory: '2gb',      // replace a worker that uses more than this (default: no limit)
        healthInterval: 10000, // ping idle workers every N ms, 0 disables (default: 10000)
        venv: './.venv'        // use the interpreter of a virtual environment
    }
});

await fusion.python('module.function', args, { timeout: 5000, signal });
await fusion.call('python', 'module.function', args);   // generic form

fusion.stats();                // what every pool is doing, see "Keeping workers healthy"
await fusion.shutdown();       // stops the workers; they also end by themselves if the process exits
```

`configure()` must run before the first call. The interpreter is chosen in this order: `python` option, `venv` option, `TOTALFUSION_PYTHON`, then `python3` (`python` on Windows).

### Options

The options of `fusion.configure({ python: {...} })` and `fusion.configure({ rust: {...} })`:

| Option | Runtime | Default | |
|---|---|---|---|
| `workers` | both | `1` | Processes in the pool. They start on demand. |
| `concurrency` | both | `1` | Calls a worker runs at the same time. |
| `timeout` | both | `30000` | Milliseconds per call (in a stream, without progress). `0` disables it. |
| `maxQueue` | both | `1000` | Calls waiting for a worker before `QUEUE_FULL`. |
| `startTimeout` | both | `30000` | Milliseconds a worker has to become ready (raise it for big models). |
| `cancelGrace` | both | `2000` | Milliseconds a worker has to cancel a call before it is killed. |
| `maxCalls` | both | never | Replace a worker after this many calls. |
| `maxMemory` | both | no limit | Replace a worker that uses more: bytes, `'512mb'`, `'1.5gb'`. |
| `healthInterval` | both | `10000` | Ping idle workers every N ms. `0` disables it. |
| `healthTimeout` | both | `10000` | Milliseconds a worker has to answer a ping. |
| `forwardStderr` | both | `true` | Show what the workers write to their error output. |
| `env` | both | `process.env` | The environment of the workers. |
| `path` | Python | `./python` | The directory with your components. |
| `python` | Python | | The interpreter command (wins over `venv`). |
| `venv` | Python | | A virtual environment whose interpreter is used. |
| `preload` | Python | none | Modules to import (running their `@startup`) before a worker is ready. |
| `requirements` | Python | `requirements.txt` | The file that `doctor` checks. |
| `binary` | Rust | | The path of the worker you built. |
| `args` | Rust | none | Arguments for the worker. |
| `cwd` | Rust | folder of the binary | Working directory of the worker. |

Options of a single call (`fusion.python(fn, args, options)`): `timeout`, `signal` (an `AbortSignal`), `idempotent` and `retries` (see [Retrying](#retrying-a-call-that-can-be-repeated)), and for a stream `highWaterMark`.

The methods: `fusion.python(fn, args, options)` and `fusion.rust(...)` (or `fusion.call(runtime, fn, args, options)`), `fusion.stream(...)` and `fusion.python.stream(...)` / `fusion.rust.stream(...)`, `fusion.describe(runtime)`, `fusion.warmup(runtime)`, `fusion.watch(runtime)`, `fusion.doctor(runtime)`, `fusion.register(options)` and `fusion.sse($, stream)` for Total.js, `fusion.stats()` and `fusion.shutdown()`.

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

`@action` declares the contract: `summary`, `input`, `output`, `query`, `params` (Total.js schema syntax), `mcp`, `permissions`, `user`, `sa`, `su`, `idempotent`, `timeout` and `name`/`id`. Its arguments are read **statically** (they must be literals), so `fusion.describe('python')` lists every contract without importing your code and without loading any model.

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
- **Use `warmup`.** Workers start with the first call. `await fusion.warmup('python')` (or `fusion.register({ warmup: true })`) starts them all at boot, so the first request does not wait for the model: the first request through MCP went from 2.4 s to about 22 ms (later ones take 9-12 ms), with the boot taking the 2.6 s instead.
- **Keep input shapes fixed.** PyTorch on CPU prepares its kernels per tensor shape, and the first call with each new sequence length took 130-250 ms. Padding to a fixed length in `@startup` and in the function removed every slow call (40 different sentences, all between 7 and 9 ms). See [sentiment.py](examples/components/sentiment.py).

### Total.js 5

```js
// definitions/fusion.js
const fusion = REQUIRE('totalfusion');

exports.install = function() {
	fusion.register({ python: { path: PATH.root('python'), workers: 2 } }).then(function(result) {
		console.log('TotalFusion:', result.ids.join(', '));
	});
};
```

`register` is asynchronous (it reads the contracts with a short Python process) and resolves with `{ ids, errors, warnings }`. `require('totalfusion')` works the same as `REQUIRE('totalfusion')`.

Every function decorated with `@action` becomes a `NEWACTION()` named `<module>/<function>` (change it with `prefix` or `@action(id=...)`). Because they are normal actions they work with `ACTION()` and `API` routes (`ROUTE('API /v1/ +count --> contract/count')`). `register` also adds the modules with `@startup` to `preload` automatically.

- **Validation first.** Total.js validates `input` with the contract before Python runs, so invalid data never reaches your function. Fields marked with `*` are required; an optional field with an invalid value is dropped by Total.js, not reported.
- **Query and params.** Declare them in the contract like the input: `@action(input='a:Number', query='*page:Number', params='id:UID')`. Python then receives an object with the sections that were declared, already validated and converted: `{ 'input': {'a': 5}, 'query': {'page': 2}, 'params': {'id': '...'} }`. Without `query` and `params` it receives the input alone, as before. `ACTION('x', input).query({...}).params({...})`, the `API` routes and the MCP tools (`arguments: { input, query, params }`) all fill them.
- **Who may call.** `permissions` (`'admin,editor'`: any of them), `user=True` (only a logged in user), `sa` and `su` go to `NEWACTION()` as they are, so Total.js decides before Python is reached and answers `401` otherwise. An administrator (`user.sa` or `user.su`) always passes. Python does not see the user: if a function needs to know who calls, pass what it needs in the input.
- **MCP is opt-in.** Only functions with `mcp=True` are exposed to agents (`CONF.$mcp = true` enables the endpoint). Everything else stays internal.
- **Errors.** A Python `ValueError` is treated as the caller's mistake and its message reaches the client. Any other exception returns `The action failed`, and the real error goes to `onerror` (default: `console.error`), so paths, queries or secrets inside exception messages are not leaked.
- **Generators.** A function that yields is a stream, not an action: `register` skips it with a warning. Call it with `fusion.stream()` or `fusion.sse()`.
- **Boot.** `fusion.register({ warmup: true })` loads the models before it resolves, and `preload: false` leaves the modules with `@startup` to load on their first call.
- **Schemas.** Total.js splits the fields of a schema on commas **even inside a `// comment`**, so `'*text:String // Text, up to 2000 chars'` declares a second field called `up to 2000 chars`. `register` returns a `warnings` list for it: use parentheses or a new line.
- **MCP.** Exposing an action as a tool uses the MCP router of Total.js 5 (`CONF.$mcp = true`). Actions and API routes work without it.

#### FlowStream

[total5/flow/python.html](total5/flow/python.html) is a FlowStream component that calls a Python function with the data of each message: the result goes out through the first output, and a failure through the second one as `{ code, message }` (the message of the Python exception, without the traceback; do not connect that output straight to a public response). Its settings are the function (`module.function`) and a timeout. It uses the same pool of workers as the rest of the application. It is a standard component file; how you add it to your flow depends on your project. It was run with the test harness of Total.js (`flow-test.js`), not inside the Flow designer.

### Binary data

`Buffer`, `Uint8Array`, `ArrayBuffer` and the typed arrays (`Float32Array`, `Float64Array`, `Int32Array`, ...) travel as raw bytes next to the JSON, anywhere in the arguments or in the result. No base64, no JSON array of numbers, and the bytes are not copied when the frame is built.

```js
const image = await fs.promises.readFile('photo.jpg');
const result = await fusion.python('vision.resize', { image, width: 256 });   // result.image is a Buffer
```

```python
def resize(data):
    picture = Image.open(io.BytesIO(data['image']))      # data['image'] is bytes
    ...
    return { 'image': output.getvalue() }                  # bytes -> Buffer

def normalize(data):
    values = np.frombuffer(data['values'], dtype=np.float32)   # Float32Array -> memoryview, no copy
    return (values - values.mean()) / values.std()             # numpy array -> Float32Array
```

| JavaScript | Python |
|---|---|
| `Buffer`, `Uint8Array`, `ArrayBuffer` | `bytes` |
| `Int8Array`, `Int16Array`, `Uint16Array`, `Int32Array`, `Uint32Array`, `Float32Array`, `Float64Array`, `BigInt64Array`, `BigUint64Array` | `memoryview` of the matching type (read-only, no copy) |

From Python, `bytes`, `bytearray`, `memoryview`, `array.array` and anything with the buffer protocol (NumPy arrays included) arrive as a `Buffer` (bytes) or the matching typed array. Notes:

- Arrays are sent **flat**: the shape of a multi-dimensional NumPy array is not transmitted. Send it as another field (`{ data, shape }`) if you need it.
- Typed arrays are little-endian, like every platform Node.js and CPython run on (x64 and ARM64). Big-endian buffers coming from Python (NumPy `>f4`) are converted for you.
- Types without a JavaScript typed array (`float16`, complex numbers) arrive as raw bytes in a `Buffer`, as do boolean arrays.
- Non-contiguous NumPy arrays (slices with a step, transposes) are sent in C order.
- `"$bin"` is a reserved key and cannot be used in your data.
- A frame can carry up to 512 MB in total, of which at most 64 MB can be JSON.
- Measured against sending the same bytes as base64 inside JSON: 1 MB in 0.5 ms instead of 4.4 ms, 32 MB in 14 ms instead of 145 ms, and a 100 MB buffer (133 MB as base64, over the JSON limit) in 43 ms.

### Streaming

A Python function that **yields** is a stream: each `yield` reaches Node.js as soon as it happens. Generators can be `def` or `async def`.

```python
# python/llm.py
def generate(data):
    for token in model.generate(data['prompt']):
        yield token
```

```js
for await (const token of fusion.python.stream('llm.generate', { prompt: 'Hello' })) {
    process.stdout.write(token);
}
```

`fusion.stream('python', fn, args, options)` and `fusion.python.stream(fn, args, options)` return an async iterable; `.toArray()` collects everything.

- **Backpressure.** The worker may run ahead of the consumer by `highWaterMark` chunks (16 by default). Each chunk you read gives it one more. A slow consumer slows the generator down instead of filling memory: with `highWaterMark: 4`, after reading 2 chunks an endless generator had advanced only to its 6th, and with no limit it kept running.
- **Cancellation.** Leaving the loop (`break`, `return`, an exception) or aborting the `AbortSignal` stops the generator in Python and frees the worker. An `async def` generator is interrupted where it waits; a `def` generator stops between two chunks, and one that blocks without yielding is killed after `cancelGrace`, like any synchronous function.
- **Timeout.** For a stream `timeout` is the longest time **without progress**: no chunk produced and none read. A stream can last as long as it needs while it keeps moving.
- **Errors.** The chunks that were produced before a failure are delivered first, then the error with its Python traceback.
- A generator called with `fusion.python()` fails with `STREAMING_FUNCTION`, and a normal function called with `stream()` is a stream of one chunk.
- Chunks can carry binary data like any other value.

Measured with a real model (DistilGPT2 on CPU, 40 tokens): the first token arrives after 61 ms and a new one every 7 ms. Cutting the stream after 5 tokens of a 500-token request stopped the generation in 43 ms.

#### Server-Sent Events from a Total.js route

```js
ROUTE('GET /generate/', function($) {
    fusion.sse($, fusion.python.stream('llm.generate', { prompt: $.query.prompt }));
});
```

`fusion.sse($, stream)` sends every chunk as `data: <json>`, the end as `event: end` and a failure as `event: error`. If the browser disconnects, the generator is cancelled, so a model does not keep generating for nobody. As in the actions, only the message of a `ValueError` reaches the client.

### Several calls at the same time

By default a worker runs **one call at a time** and the work is spread over the processes. With `concurrency: N` each worker runs up to N calls at once, which is what you want when a call spends most of its time waiting, and for Rust, where every call runs in its own thread.

```js
fusion.configure({ python: { workers: 1, concurrency: 64 } });   // 64 calls waiting for an API at once
fusion.configure({ rust: { binary, workers: 1, concurrency: 8 } });   // 8 threads in one process
```

| Scenario | Configuration | Time | Processes / memory |
|---|---|---|---|
| Python, 64 calls that wait 0.2 s | 4 workers, `concurrency: 1` | 3.23 s | 4 / 94 MB |
| | 4 workers, `concurrency: 16` | 0.21 s | 4 / 93 MB |
| | 1 worker, `concurrency: 64` | 0.21 s | 1 / 24 MB |
| Rust, 8 CPU jobs of 0.33 s (8 cores) | 1 worker, `concurrency: 1` | 2.68 s | 1 |
| | 4 workers, `concurrency: 1` | 0.74 s | 4 |
| | 8 workers, `concurrency: 1` | 0.60 s | 8 |
| | 1 worker, `concurrency: 8` | 0.49 s | 1 |

- **The next call goes to the least loaded worker**, and a new worker is started only when the room of the existing ones is not enough.
- **Python:** `async def` functions overlap, and `def` functions run in threads. Because of the GIL, pure-Python computation does not speed up that way (use more `workers` for it); waiting for a network, a disk or a library that releases the GIL does. Calls that overlap in a worker **share its module state**: a global that a function modifies is not safe unless you protect it.
- **Rust:** the handlers must be `Send + Sync`, which the compiler checks. The calls of a worker share its memory, so one loaded model serves all of them.
- **A call that cannot be cancelled costs the worker.** After a timeout the worker is asked to cancel the call; if it cannot (a `def` function in Python that does not return, a Rust function that never looks at `is_cancelled()`), the worker is killed after `cancelGrace` and **the calls that were running next to it fail** with `WORKER_CRASHED`. A crash does the same. Async functions in Python and functions that check `is_cancelled()` in Rust are cancelled alone.
- **A stream keeps its slot until it ends.** A consumer that stops reading does not block the other calls of the worker, but it does hold one slot until the stream times out or is cancelled.
- **Recycling and the health check wait for the calls in progress:** a worker that reaches `maxCalls` leaves when the last of its calls ends, and only workers with nothing running are pinged.
- `fusion.stats()` shows `running` (calls in progress) for the pool and for every worker.

### Keeping workers healthy

Libraries for machine learning tend to leak memory, and a process can get stuck. Two mechanisms keep the pool in shape, and neither makes a call fail.

**Recycling.** A worker is replaced after `maxCalls` calls or as soon as it uses more than `maxMemory` (`512`, `'512mb'`, `'1.5gb'`). The replacement **starts first**; the old worker keeps serving until the replacement is ready, then it leaves as soon as it is idle (its `@shutdown` hooks run). With a single worker and a model that takes seconds to load, nobody waits for the restart. The limits are therefore soft: the old worker may serve a few more calls while the replacement loads, and for a moment two workers exist, so allow for that memory. If the replacement cannot start, the old worker stays and no new attempt is made for a minute.

With the DistilBERT worker of 1.35 GB and `maxCalls: 100`, 450 calls were served with two replacements: the slowest call took 32 ms (no stall while a new worker loaded the model), the pool peaked at 2.7 GB with both workers alive and went back to 1.35 GB. The median rose from 5-7 ms to 16 ms while a worker was loading, because both compete for the CPU.

Memory is the resident size on Linux, the physical footprint on macOS (the value Activity Monitor shows, compressed memory included) and the private bytes on Windows (not verified there). On other systems it is not reported, `maxMemory` has no effect and Node.js emits a warning.

**Health check.** Every `healthInterval` (10 s by default) idle workers get a ping. One that does not answer within `healthTimeout` (10 s) is killed and replaced at once, so the next call does not wait for a model to load. Only idle workers are checked: a busy worker is protected by the `timeout` of its call, and a long computation that holds the GIL is never mistaken for a dead worker.

`fusion.stats()` shows what is going on:

```js
fusion.stats().python
// { workers: 1, ready: 1, busy: 0, running: 0, queued: 0,
//   recycled: { calls: 2, memory: 0, reload: 0 }, unresponsive: 0,
//   details: [{ pid: 67025, ready: true, busy: false, running: 0, calls: 32, memory: 1417674752, age: 6120, recycling: false }] }
```

### Observing the workers

`fusion` is an `EventEmitter`. Use it for logs and metrics; every event carries the `runtime` it is about.

```js
fusion.on('worker:exit', e => log.warn('worker', e.pid, 'ended:', e.reason));
```

| Event | When | Data |
|---|---|---|
| `worker:ready` | A worker is ready to take calls. | `pid`, `startedIn` (ms) |
| `worker:exit` | A worker ended. | `pid`, `code`, `signal`, `running` (calls it had), `calls`, and `reason`: `crash`, `recycled` (replaced on purpose), `unresponsive`, `start-failed` or `shutdown` |
| `worker:recycle` | A worker is going to be replaced. | `pid`, `reason` (`calls`, `memory` or `reload`), `memory`, `calls` |
| `worker:unresponsive` | An idle worker did not answer the health check. | `pid`, `timeout` |
| `call:retry` | A call that was declared idempotent is going to run again. | `fn`, `attempt`, `retries`, `pid` of the worker that died |
| `reload` | The code changed and the workers are being replaced. | `files`, `replaced` |

A listener that throws does not break the pool: Node.js emits a warning.

### Retrying a call that can be repeated

A call is **never repeated by itself**: if its worker dies it may have done part of its work, and repeating it could do it twice. If you know it is harmless to run it again (a calculation, a query, a conversion), say so and a worker that dies does not fail the call:

```js
await fusion.python('prices.convert', data, { idempotent: true });                 // one more try
await fusion.python('prices.convert', data, { idempotent: true, retries: 3 });
```

```python
@action(summary='Converts a price', input='*amount:Number', idempotent=True)       # in the contract: Total.js does it for every call
```

In Rust, `.idempotent(true)` after the function. The call runs again on another worker, first in the queue, up to `retries` times (default 1); then it fails with `WORKER_CRASHED` as usual. This is what saves the calls that were running next to a call that had to be killed (see [Several calls at the same time](#several-calls-at-the-same-time)). It does **not** repeat a call that timed out, one that failed with an error of its own, a stream, or anything while the pool shuts down, and a function that kills its worker every time costs `retries + 1` workers, no more. The timeout counts for every attempt.

### Errors

Every error is a `FusionError` with a stable `code`.

| Code | Meaning |
|---|---|
| `REMOTE_ERROR` | The function in the worker raised (Python) or returned an error (Rust). `err.remote` has `name`, `message` and, in Python, `traceback`, which is also appended to `err.stack`. A function can give its error a `code` of its own. |
| `TIMEOUT` / `ABORTED` | The call exceeded its timeout or its `AbortSignal` fired. |
| `STREAMING_FUNCTION` | A generator was called with `fusion.python()`: use `fusion.stream()`. |
| `CANCELLED` | The stream was cancelled by its consumer. |
| `WORKER_CRASHED` | The worker died during the call. The call is **not** retried, because it may have had side effects, unless it was declared idempotent. The worker is replaced. |
| `QUEUE_FULL` | The bounded queue is full: backpressure instead of unbounded memory growth. |
| `NOT_FOUND` | Unknown module or function (or not exposed). |
| `NOT_SERIALIZABLE` / `ENCODE_ERROR` | The result / the arguments are not valid JSON. |
| `SPAWN_FAILED` / `START_FAILED` / `START_TIMEOUT` | The interpreter or the worker was not found, cannot start, or did not become ready in `startTimeout`. `err.hint` says how to install a missing library. |
| `PROTOCOL_MISMATCH` | The worker speaks another version of the protocol (a Rust worker built with another version of the crate). |
| `INVALID_CONFIG` / `ALREADY_STARTED` | An option is wrong, or `configure()` was called after the pool started. |
| `CLOSED` | The pool was shut down while the call was pending. |

### Cancellation

`async def` functions are cancelled for real (`asyncio` cancellation). Synchronous functions cannot be interrupted: after a timeout the caller is rejected immediately, and if the function does not finish within `cancelGrace` (2 s) the worker is killed and replaced.

## Rust

Write the functions in Rust, build a binary, and call it like the Python ones. A Rust worker is an **isolated process** that speaks the same protocol, so everything in this README applies to it as well: the pool, timeouts, cancellation, [binary data](#binary-data), [streaming](#streaming), [recycling and health checks](#keeping-workers-healthy), Total.js actions, MCP tools and the `doctor`.

```rust
// rust/src/main.rs
use totalfusion::{object, App, Call, Error};

fn main() {
    App::new()
        .function("collatz.longest", |call: &Call| {
            let limit = call.args["limit"].as_i64().ok_or_else(|| Error::invalid("limit must be a number"))?;
            Ok(object! { "number" => limit })   // the real work goes here
        })
        .summary("Finds the number with the longest Collatz chain")
        .input("*limit:Number")
        .mcp(true)
        .run();
}
```

The crate is not on crates.io: the npm package ships its sources, so the `Cargo.toml` of your worker points to them:

```toml
[dependencies]
totalfusion = { path = "../node_modules/totalfusion/rust" }
```

```bash
cargo build --release
```

```js
fusion.configure({ rust: { binary: './rust/target/release/worker', workers: 4 } });

const result = await fusion.rust('collatz.longest', { limit: 3000000 });

for await (const chunk of fusion.rust.stream('count.up', { n: 10 })) { /* a function registered with .stream() */ }

// Total.js: the functions that declare their contract become actions
await fusion.register({ runtime: 'rust', rust: { binary: './rust/target/release/worker' } });
```

The guide of the crate, with the whole API, is in [rust/README.md](rust/README.md). A complete example is in [examples/rust](examples/rust).

- **Nothing is compiled for you.** `binary` is the path of a worker you built (or got precompiled), so the people who only run the application do not need Rust. `fusion.doctor('rust')` and `npx totalfusion doctor --binary ./worker` check that the file exists, can be executed, answers, speaks the same protocol version and is not a debug build.
- **A panic fails one call, not the worker.** A crash of the process is a `WORKER_CRASHED` error and the worker is replaced; Node.js never goes down.
- **Same options as Python:** `workers`, `concurrency`, `timeout`, `maxQueue`, `maxCalls`, `maxMemory`, `healthInterval`, `cancelGrace`... plus `args`, `env` and `cwd` for the process. Every call of a worker runs in its own thread, so `concurrency` makes one process use all the cores (see [Several calls at the same time](#several-calls-at-the-same-time)).
- **Contracts are declared in code**, with the same names as `@action` in Python (`summary`, `input`, `output`, `query`, `params`, `permissions`, `mcp`...). The binary prints them with `--describe`.
- **Where Rust pays off.** Heavy CPU work that should not block Node.js and that can use several cores. For the longest Collatz chain below 3 million (the same algorithm in each language, eight cores): optimized JavaScript takes 1.2 s and Rust 0.33 s (3.6x; the naive JavaScript most people write is 14x slower than Rust), and pure Python is 48x slower than Rust. Eight of those jobs take 9.1 s in JavaScript, **blocking the event loop the whole time**, and 0.7 s on four Rust workers, which leave the event loop free (1 ms of delay). A call that does nothing costs 0.03 ms. For light work on small data, JavaScript in the same process wins: it pays no transfer.
- **Windows:** the SDK points the standard output of the process to the error output, as it does on Unix, so `println!` is harmless. That code compiles for Windows but has not been run there.

## Development: reload when the code changes

```js
fusion.watch('python');   // replaces the workers when a .py file changes
fusion.watch('rust');     // ... when the worker is built again (cargo build)

// Total.js: the same, and the contracts are read again, so a new, changed or removed function is an action without restarting
await fusion.register({ python: { path: PATH.root('python') }, watch: DEBUG });
```

Save a file and the next call runs the new code. The new workers start first and the old ones leave when they are idle, so **no call is lost** while you edit. Options of `fusion.watch(runtime, options)`: `debounce` (milliseconds of quiet after the last change, default 200), `log` (a line in the console for every reload, default true) and `onreload({ runtime, files, replaced })`. It returns `{ close() }`, and `fusion.shutdown()` closes every watcher.

- **What counts.** Python: the `.py` files of the components (not hidden folders, `__pycache__` or `node_modules`). Rust: the binary. Many writes in a row are one reload.
- **Changes are checked, not trusted.** The events of the system are only a hint (macOS repeats the recent ones, and an editor can save twice): the files are compared with how they were, so a save that changes nothing does not reload.
- **A mistake does not take the application down.** A Python file with a syntax error makes the calls to that module fail with `SyntaxError` while the rest keeps working, and fixing it recovers. If a new worker cannot start (for example a `preload` module with an error) the old one keeps serving and a warning says so; the next edit tries again at once.
- **In Total.js** an error in a file removes no action until it is fixed, and `onreload` of `register` receives the `errors`. A new module with `@startup` or a change in `preload` needs a restart of the application.
- **Only for development.** Use `watch: DEBUG` (or `false` in production): it keeps a watcher on your code and replaces workers.

## Checking your setup

Before running anything, ask TotalFusion what is wrong:

```bash
npx totalfusion doctor --path ./python --venv ./.venv
```

```
TotalFusion doctor: python

[ok]    Interpreter  Python 3.12.15 (/project/.venv/bin/python, chosen by the venv option)
[ok]    Environment  Virtual environment /project/.venv
[ok]    Components   3 modules in /project/python, 2 actions (1 streaming)
[error] Libraries    Not installed: sklearn (pip: scikit-learn) used by classifier; torch used by sentiment
                     Fix: /project/.venv/bin/python -m pip install scikit-learn torch

1 problem to fix
```

The same from code: `const report = await fusion.doctor('python')` gives `report.ok`, `report.checks` (each with `status`, `name`, `message` and, when there is something to do, `fix`) and `report.text`. The command exits with `0` when everything is in order (warnings are advice), `1` when something has to be fixed and `2` for a wrong usage; `--json` prints the report as JSON. Options: `--runtime python|rust`, `--path`, `--venv`, `--python`, `--requirements`, `--preload a,b`, `--binary` (Rust) and `--max-memory 2gb`.

It looks at the interpreter (version, where it was chosen from, virtual environment or system Python), the components (syntax errors, contracts that cannot be read, `preload` modules that do not exist), the libraries they import and `requirements.txt`. **Nothing is imported, run or installed**: the components are read as text, so a module that loads a model on import is no problem. Imports inside functions are found too, and an import guarded by `try/except ImportError` is only a warning. The libraries are looked up with the same interpreter that will run the workers, which is the point: installing a library in another Python is the most common mistake. For `requirements.txt` (next to the components, in the folder above, or the `requirements` option) it checks what is installed and the version specifiers (`==`, `>=`, `<`, ...); lines with environment markers, URLs and options such as `-r` are not checked.

The same hint reaches the errors at run time. A call that fails with `ModuleNotFoundError`, or a worker that cannot start because of a missing library, carries `err.hint` (and it is appended to the stack): `"numpy" is not installed in the Python that runs the workers (/project/.venv/bin/python). Install it with: /project/.venv/bin/python -m pip install numpy`. Names that differ from the package (`sklearn` is `scikit-learn`, `cv2` is `opencv-python`, `PIL` is `Pillow`, ...) are translated.

## How it works

Each worker is a process (Python, or a Rust binary) that talks to Node.js over stdin/stdout with length-prefixed frames (protocol version 2: JSON for the structure plus raw binary parts, see [lib/protocol.js](lib/protocol.js)). Calls carry an id, so responses never mix under concurrency. Workers start on demand, are replaced when they crash, exit when the parent dies and do not keep your Node.js process alive while idle.

Measured on one machine (Python 3.15, Node 24, macOS arm64), warm workers, JSON payloads:

| Scenario | p50 | p99 |
|---|---|---|
| `child_process` spawn per call | 17.6 ms | 19.8 ms |
| TotalFusion, small call | 0.07 ms | 0.12 ms |
| TotalFusion, 1 MB string in JSON, round trip | 3.0 ms | 4.4 ms |
| TotalFusion, 1 MB `Buffer`, round trip | 0.5 ms | - |
| TotalFusion, 32 MB `Buffer`, round trip | 14 ms | - |
| TotalFusion, 100 MB `Buffer`, round trip | 43 ms | - |
| TotalFusion, 40 MB `Float32Array`, round trip | 18 ms | - |

With a real library (NumPy in a virtual environment, nearest neighbours over 50,000 vectors of 128 dimensions, see [examples/components/vectors.py](examples/components/vectors.py)): the worker starts and builds the index once (about 145 ms with a warm disk cache), then every call takes about 3 ms (p50), against about 98 ms when a process is spawned per call.

Throughput with 4 workers and trivial calls: about 23,000 calls/s. These numbers are a starting point, not a benchmark suite. Binary data does not go through JSON (see [Binary data](#binary-data)).

## Security

Workers are ordinary child processes. They run your Python or Rust code with your user's permissions and inherit the environment (pass `env` to restrict it). **A worker is not a sandbox**: only run components you trust. In Python, function names are restricted to your components directory, but that is a guard against mistakes, not a security boundary. Rust is memory safe, which protects the worker from its own bugs, not the machine from the worker. Nothing is downloaded, compiled or installed for you, and an action is only visible to agents when its function says `mcp`.

## Tests

```bash
npm test
```

The suite builds the Rust test worker with `cargo` if it finds it (otherwise the Rust tests are not run), and it needs Total.js 5 for the integration tests: it looks in `TOTAL5_PATH`, in the `total5` package and in a sibling `../framework5`. The NumPy tests are skipped unless you point them to a Python that has NumPy: `TOTALFUSION_TEST_NUMPY=/path/to/python npm test`. `TOTALFUSION_PYTHON` chooses the Python of the whole suite. The crate has its own tests: `cargo test --manifest-path rust/Cargo.toml`.

## License

MIT
