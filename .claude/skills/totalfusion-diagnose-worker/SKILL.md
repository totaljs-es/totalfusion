---
name: totalfusion-diagnose-worker
description: Use when a TotalFusion worker fails to start, crashes, times out or exits, or a call fails with WORKER_CRASHED, START_FAILED, START_TIMEOUT, SPAWN_FAILED, TIMEOUT, PROTOCOL_MISMATCH, NOT_FOUND or INVALID_CONFIG.
---

# Diagnose a worker that fails

**Make the failure loud before you theorize.** The message of a `WORKER_CRASHED` or `START_FAILED` error already carries what the worker wrote to its error output: read it all, it is usually the cause. A worker that exits in silence hides it; fix that first (print the reason to the error output, exit non-zero). Guessing without it cost two rounds of CI once.

1. **Read the code of the error** (`docs/errors.md`): `SPAWN_FAILED` the interpreter or binary was not found; `START_FAILED` it started and died or printed something that is not the protocol; `START_TIMEOUT` it did not become ready in `startTimeout` (a big model: raise it); `WORKER_CRASHED` it died during a call (the exit code and the error output are in the message); `TIMEOUT` the call took too long; `PROTOCOL_MISMATCH` the worker was built with another version of the SDK; `NOT_FOUND` the function or the file is not there; `INVALID_CONFIG` an option is missing (`binary`, `module`).
2. **Run the doctor:** `npx totalfusion doctor --json` (add `--runtime`, `--path`, `--binary` or `--module`). Use the command in each `fix`. Python components are read without importing them; Rust and Go execute the worker with `--describe`, and WebAssembly runs its host to read the module contract. Use trusted native binaries. For a binary it says for which system it was built, and a worker for another system is the most common mistake.
3. **Run the worker by hand:** `./worker --describe` prints its contracts as JSON; if that fails, the problem is the worker, not TotalFusion.
4. **Watch what happens:** `fusion.on('worker:exit', console.log)` (also `worker:ready`, `worker:recycle`, `worker:unresponsive`, `call:retry`) and `fusion.stats()`.
5. **Platform pitfalls:**
   - Windows: a running executable cannot be replaced (workers run from a copy). In Go, two `os.File` for one handle: the finalizer of the first closes it at the first garbage collection ("The handle is invalid").
   - Python: run with `PYTHONDONTWRITEBYTECODE` unset; the components load from source.
   - Something printed to the standard output breaks the protocol (`START_FAILED` with garbage): write to the error output.
   - WebAssembly: a module that imports anything but WASI is refused; a `_start` export means it is a command, not a reactor.
6. **Reproduce it in a test**, with the smallest worker that fails, and see it fail before you fix it.
