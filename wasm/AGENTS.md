# AGENTS.md: WebAssembly

The sandbox of TotalFusion: `host.js` is the Node.js process that runs a `.wasm` module and speaks the protocol with the pool, and `index.js` is the adapter (`create`, `describe`, `doctor`, `watchTarget`). The ABI and what the sandbox does and does not protect are in `../docs/webassembly.md`; the rest of the project is in `../AGENTS.md`.

## The invariants of the sandbox

Each one has a test that fails if it breaks (`../tests/wasm.test.js`). Do not weaken them:

- **WASI gets nothing:** no preopened directories, an empty environment, no arguments. Its standard output goes to the error output, and its standard input is `/dev/null`.
- **The module can import only `wasi_snapshot_preview1`.** Any other import is refused with the name of the import.
- **It is a reactor, not a command:** a module that exports `_start` is refused.
- **A trap, an exit or a failed call gives the next call a new instance** (`fresh()` in `host.js`): the state of a module that failed cannot be trusted.
- **A function that never returns is killed by the pool** after the timeout and `cancelGrace`: a call is synchronous inside the host.
- A module is single threaded: one call at a time in a worker, no streams (a function called as a stream is a stream of one chunk).
- NaN and infinity are not JSON and are an error, as in the other runtimes.

## The ABI (version 1)

The module exports `memory`, `tf_abi`, `tf_alloc`, `tf_free`, `tf_call` and, optionally, `tf_describe`. A buffer that the module returns is a pointer to its length (`uint32`, little endian) and then the bytes. The body of a call is a frame of the protocol without its first four bytes (`encodeBody` and `decodeBody` in `../lib/protocol.js`). The module side for Go is `../go/wasm.go` and `../go/wasm_wasip1.go`.

## Check a change

```bash
node --test tests/wasm.test.js tests/tutorials.test.js
```

`../tests/wasm-fixtures.js` assembles by hand the modules that no compiler would produce (a trap, a foreign import, a command, a bad ABI). The module of the tests (`../tests/wasm`) needs Go 1.24 or newer; without it those tests are skipped. After a change in the sandbox, **break it on purpose** (give WASI a directory) and see the tests fail.
