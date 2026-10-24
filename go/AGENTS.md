# AGENTS.md: the Go module

The Go side of TotalFusion: the module `github.com/totaljs-es/totalfusion/go` (package `totalfusion`) that a Go worker imports, and the adapter `index.js` that starts it from Node.js. The whole API is in `README.md`; the rest of the project is in `../AGENTS.md`.

## Rules of this module

- **Standard library only, and no cgo.** That is what lets a worker be built for any system from any system (`GOOS=linux GOARCH=amd64 go build`). `go.mod` says Go 1.21; the WebAssembly exports (`wasm_wasip1.go`) need Go 1.24.
- **The standard output carries the protocol.** `stdout_unix.go`, `stdout_windows.go` and `stdout_other.go` move what a program prints to the error output and keep the real output for the frames.
- **On Windows keep the original file of the standard output** (`protocolFile`): a second `os.File` for the same handle is closed by its finalizer at the first garbage collection, and the protocol then fails with "The handle is invalid".
- **Read and write in pieces** (`ioChunk` in `wire.go`, 1 MB), never a whole payload in one call.
- **A failure is loud:** a read or a write that fails prints why to the error output and exits with code 1. Never exit in silence.
- **Memory** is per system: `/proc` on Linux, the private bytes on Windows, the runtime on the others (`memory_*.go`).

## Files

`app.go` (the `App` builder, `Run` and the messages), `call.go` (`Call`, `Emit` with credit), `value.go` (`Value` and the typed arrays that travel as bytes), `wire.go` (the frames), `errors.go`, `wasm.go` and `wasm_wasip1.go` (the ABI of WebAssembly, see `../docs/webassembly.md`).

## Check a change

```bash
cd go && go vet ./... && go test -race ./...
GOOS=windows go vet ./... && GOOS=wasip1 GOARCH=wasm go vet ./...
```

The worker that the JavaScript tests run is `../tests/go`, and its tests are `../tests/go.test.js`. A code that depends on the system is only verified on that system: Windows and Linux run in the continuous integration.
