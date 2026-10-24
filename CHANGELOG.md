# Changelog

## 0.1.0

The first version.

- **Documentation:** a short README and a `docs/` folder with a guide, one page per runtime (Python, Rust and Go), use cases with their measured numbers, a reference and the security notes.
- **Runtimes:** Python (3.9 or newer), Rust and Go (1.21 or newer), as pools of worker processes that Node.js supervises. They speak the same protocol (version 2), so every feature below works with all of them. The Go module is pure Go (no `cgo`), so a worker builds for any system from any system.
- **Calls:** correlated by id, with timeouts, `AbortSignal` cancellation, a bounded queue, and real tracebacks (Python) or errors with a name and a code (Rust and Go) in the JavaScript error. A call is never retried by itself: it may have had side effects.
- **Contracts:** `@action(...)` in Python, `.summary().input().output()...` in Rust and `.Summary().Input().Output()...` in Go declare what a function takes and returns, in the schema syntax of Total.js. They are read without running any code.
- **WebAssembly:** a module (`.wasm`, a WASI reactor that exports a small ABI) runs in a sandbox in a process of its own: no files, no network, no environment, only WASI as imports, a trap or an exit fails the call and starts a new instance. The Go SDK (`app.Wasm()`, Go 1.24 or newer) builds one; the ABI is documented for other languages. Streams and concurrency inside a worker are not supported.
- **Total.js 5:** `fusion.register()` turns the functions that declare a contract into `NEWACTION()`s, with `input`, `query`, `params` and access options (`permissions`, `user`, `sa`, `su`) validated by the framework, and into MCP tools when the function says `mcp`. Server-Sent Events (`fusion.sse`) are included.
- **Flow:** seven components for Total.js Flow (group *TotalFusion*): one for each runtime that calls a function with the data of each message, **Stream** (every chunk is a message, with `Stop` and cancellation when the flow stops), **Events** (the events of the workers as messages) and **Stats**. A list for the catalog of the designer (`total5/flow/db.json`) and `fusion.flow()` for the logic. They were run in the designer of Flow 11.1.
- **Tutorials:** step by step pages (`docs/tutorials`), each with an application in `examples/tutorials` that a test of the project starts and checks on every change. The first one: a Python function as an API and as a tool for an AI agent, with live reload.
- **Binary data** without base64: `Buffer` and typed arrays travel as raw bytes in both directions (NumPy arrays included). A 100 MB buffer makes the round trip in 43 ms.
- **Streaming:** generators in Python and stream functions in Rust and Go become async iterables, with backpressure and cancellation.
- **Several calls at the same time** in a worker (`concurrency`), for async functions in Python for the threads of a Rust worker and for the goroutines of a Go one.
- **Keeping workers healthy:** recycling by number of calls and by memory with no call lost (the replacement starts first), a health check of the idle workers, `warmup`, `preload` and `@startup`/`@shutdown` hooks.
- **Events:** `fusion` is an `EventEmitter` that reports when workers are ready, end, are replaced or stop answering, when a call is repeated and when the code is reloaded.
- **Retrying:** a call that is declared idempotent (`{ idempotent: true }`, `@action(idempotent=True)` or `.idempotent(true)` in Rust, `.Idempotent(true)` in Go) is repeated on another worker if its worker dies. Nothing is repeated otherwise.
- **Rust and Go on Windows:** the worker runs from a copy, so `cargo build` or `go build` can replace the binary while it is in use and the reload picks the new build up (`shadowCopy`).
- **Fresh code:** the components of a Python worker are loaded from their source every time, never from bytecode (a file saved twice within a second with the same size is never missed), and no `__pycache__` is left next to them.
- **Development:** `fusion.watch()` replaces the workers when the code changes, and with Total.js the contracts are read again.
- **Diagnosis:** `fusion.doctor()` and `npx totalfusion doctor` check the interpreter (or the Rust or Go binary), the components, the libraries and `requirements.txt` without importing or installing anything, and the errors at run time say how to install a missing library.

Verified in GitHub Actions on Linux (Ubuntu with Node.js 20, 22 and 24 and Python 3.9 to 3.14), macOS and Windows: the whole suite, with the Python, Rust, Go and WebAssembly workers and the components for Flow. Also locally on macOS (Apple silicon) with Node.js 20, 22, 24 and 26, Python 3.9 to 3.15, Rust 1.99 and Go 1.21 and 1.27, and by hand in the designer of Flow 11.1. Not verified: a specific AI client against the MCP endpoint, and Flow in the cloud service of Total.js.
