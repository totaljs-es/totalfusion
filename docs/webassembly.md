# WebAssembly

Call functions that were compiled to WebAssembly, from Node.js and Total.js, like any other runtime. What sets it apart is that **a WebAssembly module runs in a sandbox**: it cannot read or write files, it cannot open a connection and it cannot see your environment. The other runtimes run your code with your permissions; a module runs with none that you did not give it, and you do not give it any. It is also **one `.wasm` file that runs on any system**.

A module runs in a process of its own (a small Node.js host that TotalFusion starts), so everything in this documentation applies to it as well: the pool, timeouts, [binary data](binary-data.md), [recycling and health checks](workers.md#keeping-workers-healthy), Total.js actions, MCP tools and the `doctor`. A function that never returns is killed after the timeout, like in any other runtime.

## Write a module

The Go module of TotalFusion has the SDK (Go 1.24 or newer is needed, the first that can export functions to WebAssembly). The functions are registered in an `init` function, because a module of this kind does not run `main`:

```go
// module/main.go
package main

import (
	totalfusion "github.com/totaljs-es/totalfusion/go"
)

func init() {
	app := totalfusion.New()

	app.Function("math.add", func(call *totalfusion.Call) (any, error) {
		a, okA := call.Args.Get("a").AsFloat()
		b, okB := call.Args.Get("b").AsFloat()

		if !okA || !okB {
			return nil, totalfusion.Invalid("a and b must be numbers")
		}

		return map[string]any{"sum": a + b}, nil
	}).Summary("Adds two numbers").Input("*a:Number\n*b:Number").Output("sum:Number").MCP(true)

	app.Wasm() // this app is the module
}

func main() {}
```

The `go.mod` of the module points to the sources that the npm package ships, as in [Go](go.md#build-it-and-call-it). Build it for WebAssembly, as a reactor:

```bash
cd module && GOOS=wasip1 GOARCH=wasm go build -buildmode=c-shared -o module.wasm
```

```js
fusion.configure({ wasm: { module: './module/module.wasm', workers: 2 } });

const result = await fusion.wasm('math.add', { a: 2, b: 3 });   // { sum: 5 }

// Total.js: the functions that declare their contract become actions
await fusion.register({ runtime: 'wasm', wasm: { module: './module/module.wasm' } });
```

A complete example is in [examples/wasm](../examples/wasm) and [examples/wasm.js](../examples/wasm.js).

## What the sandbox does

These are tested with a module that tries to get out ([tests/wasm.test.js](../tests/wasm.test.js)):

| | |
|---|---|
| **Files** | None. The module is given no directories, so it cannot read a file (it tried `/etc/hosts` and a file of the test suite) nor write one (the file did not exist afterwards). |
| **Environment** | None. The process has your environment, the module sees no variable and no argument. |
| **Network** | None. The WASI of Node.js has no function to open a connection, and the module cannot import anything else. |
| **Imports** | Only WASI. A module that imports anything else (for example a function of the host) is refused, and the `doctor` says which one. |
| **What it prints** | Goes to the error output, never to the protocol. |
| **A function that does not return** | Is killed after `timeout` (and `cancelGrace`) and the worker is replaced. |
| **A trap** (`unreachable`, an out of bounds access) | Fails that call with an error of code `WASM_TRAP`, and the module starts again with a new instance, so a failure never leaves broken state behind. The same when the module calls `exit` (`WASM_EXIT`). |

What it does not do, so you do not count on it:

- **It is not a guarantee against a bug of the engine.** The sandbox is the one of WebAssembly in V8 and of WASI in Node.js. The host is a normal Node.js process with your permissions: if the engine had a flaw that lets a module escape, it would be as free as that process. For untrusted code, add what the system gives you (a container, a user without privileges).
- **Time and random numbers are available** (WASI gives them), so a module is not deterministic.
- **The memory is not capped during a call.** A module can grow up to the limit that it declares (and WebAssembly never goes beyond 4 GiB). `maxMemory` looks at the memory of the process after each call and replaces the worker that went over; a function that allocates without limit inside one call is stopped by the timeout, not by the memory.

## Good to know

- **A worker runs one call at a time.** A module is single threaded: use `workers` to run calls in parallel. `concurrency` does not make a worker run calls at once: they wait inside the process.
- **No streams.** A module answers once per call. A function called with `fusion.wasm.stream()` is a stream of one chunk, and a function registered as a stream in the SDK is refused (`STREAMING_FUNCTION`).
- **The state lives as long as the instance.** A global variable of the module keeps its value between calls, and it is lost when the worker is replaced, after a trap or when the module is built again.
- **Binary data** travels as in every runtime, without base64: a 20 MB buffer reaches the module in 10 ms (measured).
- **Reload:** `fusion.watch('wasm')` replaces the workers when the `.wasm` file is built again.
- **Contracts** are declared with the same methods as in Go (`Summary`, `Input`, `Output`, `MCP`...). A module that does not export `tf_describe` can still be called from JavaScript, but none of its functions becomes an action.
- **Requirements:** the host uses `node:wasi`. The tests run with Node.js 20, 22 and 24 in the continuous integration of the project, and with Node.js 26 locally.

## Measured

On one machine (Apple M3, eight cores, macOS, Node.js 26, a Go module of 5.8 MB), three runs each:

| | |
|---|---|
| The first call, which starts the worker and the module | 57 to 61 ms |
| A call that adds two numbers | 0.05 ms |
| A worker (the Node.js host and the Go runtime inside the module) | 113 MB |
| 20 MB sent to the module | 10 ms |
| The longest Collatz chain below 3 million | 1.41 to 1.46 s |
| Eight of those jobs on four workers | 2.5 to 2.6 s, with up to 6 ms of delay in the event loop |

**WebAssembly is not the way to speed.** The same loop takes 0.49 s in a native Go worker, 0.36 s in a Rust one and 0.95 s in optimized JavaScript on the same machine, so a Go program compiled to WebAssembly is about three times slower than native Go, and slower than JavaScript for this loop. Other compilers can produce faster code; only Go was tried. Use WebAssembly for what it gives you: the sandbox and one file for every system.

## The ABI

A module is a **reactor** (a library, not a program: it must not export `_start`) that imports nothing but `wasi_snapshot_preview1`, and exports:

| Export | |
|---|---|
| `memory` | Its memory. |
| `tf_abi() -> i32` | The version of this ABI: `1`. |
| `tf_alloc(size: i32) -> i32` | A buffer of `size` bytes in its memory, for the host to fill. |
| `tf_free(pointer: i32, size: i32)` | Frees a buffer, the ones that it returned too. |
| `tf_describe() -> i32` | A buffer with the contracts (optional). |
| `tf_call(name_pointer, name_length, body_pointer, body_length: i32) -> i32` | Runs the function and returns a buffer with the answer. |

- A **buffer that the module returns** is a pointer to its length (a `uint32`, little endian) followed by the bytes. The host copies it and frees it with `tf_free(pointer, length + 4)`. The buffers that the host gives are freed by the host after the call.
- The **body of a call** is a frame of the [protocol](how-it-works.md#the-protocol) without its first four bytes: `json length | json | count | length of each part | the parts`, all integers big endian, with the arguments as the JSON and the binary data as parts (`{ "$bin": 0, "type": "Float32Array" }`). The **answer** has the same format, with `{ "ok": true, "data": ... }` or `{ "ok": false, "error": { "name": "...", "message": "...", "code": null } }`.
- `tf_describe` returns plain JSON, the same that `--describe` prints in the other runtimes: `{ "actions": [{ "fn", "module", "name", "stream", "meta": { "summary", "input", ... } }], "functions": n, "errors": [] }`.
- The module is started by calling `_initialize` (a Go reactor has it), then `tf_abi` is checked.

The implementation of reference is [go/wasm_wasip1.go](../go/wasm_wasip1.go) for the module and [wasm/host.js](../wasm/host.js) for the host. Any language that can build a WASI reactor with these exports can be a module; only Go has an SDK, and it is the only one that was tested.

## WebAssembly, Go or Rust

| | WebAssembly | Go or Rust |
|---|---|---|
| What it is for | Code that you do not fully trust, or that you want to ship as one file | Speed and the whole of the system |
| Access to the system | None | All, with your permissions |
| Speed | About 3 times slower than native Go in the measured loop | Native |
| What you ship | One `.wasm` that runs on any system | One binary for each system |
| Calls at once in a worker | One | Many (threads or goroutines) |
| Streams | No | Yes |
| Cancel a running call | By killing the process after the timeout | The function looks at the cancellation |
| Memory of a worker | 113 MB in the measurement | 11 MB (Go), 1 MB (Rust) |

They can be used in the same application: each runtime has its own pool.
