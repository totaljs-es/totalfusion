# Go

Write the functions in Go, build a binary, and call it like the Python and the Rust ones. A Go worker is an **isolated process** that speaks the same protocol, so everything in this documentation applies to it as well: the pool, timeouts, cancellation, [binary data](binary-data.md), [streaming](streaming.md), [recycling and health checks](workers.md#keeping-workers-healthy), Total.js actions, MCP tools and the `doctor`.

## Write a worker

```go
// worker/main.go
package main

import (
	totalfusion "github.com/totaljs-es/totalfusion/go"
)

func main() {
	app := totalfusion.New()

	app.Function("net.check", func(call *totalfusion.Call) (any, error) {
		host, ok := call.Args.Get("host").AsString()
		if !ok {
			return nil, totalfusion.Invalid("host must be a string")
		}
		return map[string]any{"host": host, "up": true}, nil // the real work goes here
	}).Summary("Checks if a host answers").Input("*host:String").MCP(true)

	app.Run()
}
```

## Build it and call it

The module is not on a registry: the npm package ships its sources, so the `go.mod` of your worker points to them:

```
module worker

go 1.21

require github.com/totaljs-es/totalfusion/go v0.0.0

replace github.com/totaljs-es/totalfusion/go => ../node_modules/totalfusion/go
```

```bash
cd worker && go build -o worker
```

```js
fusion.configure({ go: { binary: './worker/worker', workers: 4 } });

const result = await fusion.go('net.check', { host: 'example.com' });

for await (const chunk of fusion.go.stream('count.up', { n: 10 })) { /* a function registered with app.Stream() */ }

// Total.js: the functions that declare their contract become actions
await fusion.register({ runtime: 'go', go: { binary: './worker/worker' } });
```

The guide of the module, with the whole API, is in [go/README.md](../go/README.md). A complete example is in [examples/go](../examples/go).

## Good to know

- **Nothing is compiled for you.** `binary` is the path of a worker you built (or got precompiled), so the people who only run the application do not need Go. `fusion.doctor('go')` and `npx totalfusion doctor --runtime go --binary ./worker` check that the file exists, can be executed, answers and speaks the same protocol version.
- **It compiles for any system from any system.** The module is pure Go (no `cgo`), so `GOOS=linux GOARCH=amd64 go build` produces a Linux worker on your Mac, with no extra toolchain. The module was compiled and checked with `go vet` for Linux, Windows and FreeBSD from macOS. A binary built for another system is the most common mistake: when the worker does not start, the `doctor` asks whether it is built for this system and tells you to cross compile it with `GOOS` and `GOARCH`.
- **A panic fails one call, not the worker.** The stack goes to the error output (which Node.js shows) and the call fails with an error named `Panic`. A crash of the process is a `WORKER_CRASHED` error and the worker is replaced; Node.js never goes down.
- **Same options as the other runtimes:** `workers`, `concurrency`, `timeout`, `maxQueue`, `maxCalls`, `maxMemory`, `healthInterval`, `cancelGrace`... plus `args`, `env` and `cwd` for the process. Every call of a worker runs in its own goroutine, so `concurrency` makes one process use all the cores (see [Several calls at the same time](workers.md#several-calls-at-the-same-time)).
- **Cancellation is a `context.Context`.** `call.Context()` is cancelled when Node.js gives up on the call (a timeout, an `AbortSignal`, a consumer that leaves a stream), so you can pass it to a database or an HTTP request and the work stops. `call.Cancelled()` is the same as a boolean.
- **Contracts are declared in code**, with the same names as `@action` in Python (`Summary`, `Input`, `Output`, `Query`, `Params`, `Permissions`, `MCP`...). The binary prints them with `--describe`.
- **Where Go pays off.** Heavy CPU work that should not block Node.js and that can use several cores, and the code that Go is good at: network tools, scanners, pipelines, anything with a Go library. For the longest Collatz chain below 3 million (the same algorithm in each language, eight cores, macOS, three alternating runs on the same day): optimized JavaScript takes 0.95 s, Go 0.48 to 0.50 s (1.9x faster than JavaScript) and [Rust](rust.md) 0.36 s, so for this loop Rust is about 1.35 times faster than Go. Eight of those jobs take 7.5 s in JavaScript, **blocking the event loop the whole time**, and 1.0 to 1.1 s on four Go workers (0.75 to 0.84 s on four Rust workers), which leave the event loop free (0.4 to 4.9 ms of delay in the three Go runs). A call that does nothing costs 0.03 ms. For light work on small data, JavaScript in the same process wins: it pays no transfer.
- **The memory of a worker.** A minimal Go worker uses about 11 MB (the worker of the tests, measured with `ps`), because the Go runtime brings its own. `Memory()` reports the resident memory on Linux and the private bytes on Windows. On macOS, where asking the system for the footprint needs `cgo`, it reports the memory that the Go runtime holds, which is what a worker written in Go uses and agrees with `ps` within a megabyte in the measurement; memory that a C library allocates would not be counted there, and `maxMemory` would not see it.
- **Windows:** the SDK points the standard output of the process to the error output, as it does on Unix, so `fmt.Println` is harmless. (On Unix the redirection is done on the file descriptor, on Windows on the handle and on `os.Stdout`.) Windows does not let anything overwrite an executable that is running, so on Windows the worker runs from a **copy** (in the temporary folder, named after the time and size of your build) and the file you build stays free: `go build` can replace it while the workers are running, and `fusion.watch('go')` picks the new build up. The copies of old builds are removed. `shadowCopy: true` does the same on any system, `shadowCopy: false` turns it off.

## Go, Rust or Python

| | Python | Rust | Go |
|---|---|---|---|
| What it is for | The ecosystem: machine learning, scientific computing, any Python library | Speed, many threads, a small footprint | Network and infrastructure code, many calls at once, easy to build for any system |
| Work per call | Calls overlap in the event loop or in threads, and the GIL limits pure-Python computation | Every call runs in its own thread | Every call runs in its own goroutine |
| Memory of a minimal worker | 24 MB (measured with the components of the tests) | 1 MB (measured with the example worker) | 11 MB (measured with the worker of the tests) |
| What you ship | Your `.py` files, and Python with its libraries on the machine | One binary. The machine does not need Rust | One binary. The machine does not need Go |
| Build for another system | Nothing to build | The target has to be installed, and usually a linker for it | `GOOS` and `GOARCH`, nothing else |
| Change it while the app runs | Save the file | Build again: `fusion.watch('rust')` | Build again (`go build`): `fusion.watch('go')` replaces the workers |
| Contracts | `@action(...)` | `.summary().input().output()...` in code | `.Summary().Input().Output()...` in code |

They can be used in the same application: each runtime has its own pool, and `fusion.python(...)`, `fusion.rust(...)` and `fusion.go(...)` are independent.

## The API of the module

The whole API, with every method, is in [go/README.md](../go/README.md). In short:

- `totalfusion.New().Function(name, func(call *Call) (any, error))` registers a function that answers once, and `.Stream(name, func(call *Call) error)` one that sends chunks with `call.Emit(value)`, which returns an error when the consumer is gone: return it and the stream ends.
- `call.Args` is the argument as a `Value`; `call.Args.Get("key")` never panics, and `.AsString()`, `.AsFloat()`, `.AsInt()`, `.AsBytes()`, `.AsFloat32s()`... tell you whether the value is what you expected.
- `totalfusion.Invalid("...")` is a mistake of the caller (Total.js sends its message to the client); any other error (`totalfusion.NewError("...")` or a plain Go `error`) is a failure that stays in the log. `totalfusion.Named("DatabaseError", "...").WithCode("E_DB")` gives the error a name and a code of its own.
- `.OnShutdown(func() { ... })` runs when the worker is asked to stop. What you do in `main` before `Run()` happens before the worker says it is ready.
- The metadata methods apply to the function registered just before them: `Summary`, `Input`, `Output`, `Query`, `Params`, `Permissions`, `User`, `SA`, `SU`, `Idempotent`, `Timeout`, `ID`, `MCP` and `Action`.
