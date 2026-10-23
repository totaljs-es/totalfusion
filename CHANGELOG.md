# Changelog

## 0.1.0

The first version.

- **Documentation:** a short README and a `docs/` folder with a guide, one page per runtime (Python, Rust and Go), use cases with their measured numbers, a reference and the security notes.
- **Runtimes:** Python (3.9 or newer), Rust and Go (1.21 or newer), as pools of worker processes that Node.js supervises. They speak the same protocol (version 2), so every feature below works with all of them. The Go module is pure Go (no `cgo`), so a worker builds for any system from any system.
- **Calls:** correlated by id, with timeouts, `AbortSignal` cancellation, a bounded queue, and real tracebacks (Python) or errors with a name and a code (Rust and Go) in the JavaScript error. A call is never retried by itself: it may have had side effects.
- **Contracts:** `@action(...)` in Python, `.summary().input().output()...` in Rust and `.Summary().Input().Output()...` in Go declare what a function takes and returns, in the schema syntax of Total.js. They are read without running any code.
- **Total.js 5:** `fusion.register()` turns the functions that declare a contract into `NEWACTION()`s, with `input`, `query`, `params` and access options (`permissions`, `user`, `sa`, `su`) validated by the framework, and into MCP tools when the function says `mcp`. A FlowStream component and Server-Sent Events (`fusion.sse`) are included.
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

Verified (before Go was added) in GitHub Actions on Linux (Ubuntu), macOS and Windows, and locally on macOS (Apple silicon) with Node.js 20, 22 and 24, Python 3.9 to 3.15 and Rust 1.99. Go was verified locally on macOS with Go 1.21 and 1.27, and compiled for Linux and Windows, but the Go suite has not run in GitHub Actions yet. Not verified: the FlowStream component inside the Flow designer.
