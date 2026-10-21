# Errors and cancellation

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

## Cancellation

`async def` functions are cancelled for real (`asyncio` cancellation). Synchronous functions cannot be interrupted: after a timeout the caller is rejected immediately, and if the function does not finish within `cancelGrace` (2 s) the worker is killed and replaced.

Rust workers cancel cooperatively: the function looks at `call.is_cancelled()` from time to time and returns. One that never looks is killed after `cancelGrace`, like a synchronous function in Python.
