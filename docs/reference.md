# Reference

## Options

The options of `fusion.configure({ python: {...} })`, `fusion.configure({ rust: {...} })` and `fusion.configure({ go: {...} })` and `fusion.configure({ wasm: {...} })`:

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
| `binary` | Rust, Go | | The path of the worker you built. |
| `module` | WebAssembly | | The path of the `.wasm` file. See [WebAssembly](webassembly.md). |
| `args` | Rust, Go | none | Arguments for the worker. |
| `cwd` | Rust, Go, WebAssembly | folder of the binary or module | Working directory of the worker. |
| `shadowCopy` | Rust, Go | `true` on Windows | Run the worker from a copy, see [Rust](rust.md) and [Go](go.md). |

Options of a single call (`fusion.python(fn, args, options)`): `timeout`, `signal` (an `AbortSignal`), `idempotent` and `retries` (see [Retrying](workers.md#retrying-a-call-that-can-be-repeated)), and for a stream `highWaterMark`.

The methods: `fusion.python(fn, args, options)`, `fusion.rust(...)` and `fusion.go(...)` and `fusion.wasm(...)` (or `fusion.call(runtime, fn, args, options)`), `fusion.stream(...)` and `fusion.python.stream(...)` / `fusion.rust.stream(...)` / `fusion.go.stream(...)` / `fusion.wasm.stream(...)`, `fusion.describe(runtime)`, `fusion.warmup(runtime)`, `fusion.watch(runtime)`, `fusion.doctor(runtime)`, `fusion.register(options)` and `fusion.sse($, stream)` for Total.js, `fusion.stats()` and `fusion.shutdown()`.

## Per-call options

`fusion.python(fn, args, options)`, `fusion.rust(...)`, `fusion.go(...)`, `fusion.wasm(...)` and `fusion.call(runtime, fn, args, options)` accept:

| Option | |
|---|---|
| `timeout` | Milliseconds for this call. In a stream, the longest time without progress. `0` disables it. |
| `signal` | An `AbortSignal`: aborting it cancels the call. |
| `idempotent` | The call can be repeated on another worker if its worker dies. See [Retrying](workers.md#retrying-a-call-that-can-be-repeated). |
| `retries` | How many times (default 1 when idempotent). |
| `highWaterMark` | In a stream, how many chunks the worker may run ahead of the consumer (default 16). |

## Methods

| | |
|---|---|
| `fusion.configure({ python: {...}, rust: {...}, go: {...}, wasm: {...} })` | Sets the options. It must run before the first call. |
| `fusion.python(fn, args, options)` / `fusion.rust(...)` / `fusion.go(...)` / `fusion.wasm(...)` | Calls a function. Returns a promise. |
| `fusion.call(runtime, fn, args, options)` | The same, with the runtime as an argument. |
| `fusion.stream(runtime, fn, args, options)` / `fusion.python.stream(...)` / `fusion.rust.stream(...)` / `fusion.go.stream(...)` / `fusion.wasm.stream(...)` | Calls a function that sends chunks. Returns an async iterable with `.toArray()` and `.cancel()`. See [Streaming](streaming.md). |
| `fusion.describe(runtime)` | The contracts of the functions, read without running them. |
| `fusion.warmup(runtime)` | Starts all the workers and waits until they are ready. |
| `fusion.watch(runtime, options)` | Replaces the workers when the code changes. See [Development](development.md). |
| `fusion.doctor(runtime)` | Checks the environment. Returns `{ ok, checks, text }`. |
| `fusion.register(options)` | Total.js: registers the functions with a contract as actions. See [Total.js 5](total5.md). |
| `fusion.sse($, stream)` | Total.js: sends a stream to the browser as Server-Sent Events. |
| `fusion.flow(kind, runtime)` | Total.js Flow: the function `make` of a component (`call`, `stream`, `events` or `stats`). The components of [Flow](flow.md) use it. |
| `fusion.stats()` | What every pool is doing. See [Working with the workers](workers.md). |
| `fusion.on(event, fn)` | The events of the workers. See [Observing the workers](workers.md#observing-the-workers). |
| `fusion.shutdown()` | Stops the workers. They also end by themselves if the process exits. |

## The command

```
npx totalfusion doctor [--runtime python|rust|go|wasm] [--path DIR] [--venv DIR] [--python COMMAND]
                       [--requirements FILE] [--preload a,b] [--binary FILE] [--module FILE] [--max-memory 2gb] [--json]
```

It exits with `0` when everything is in order (warnings are advice), `1` when something has to be fixed and `2` for a wrong usage.

## Error codes

See [Errors and cancellation](errors.md).
