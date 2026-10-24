# totalfusion (Go)

Write functions in Go and call them from Node.js and Total.js as `async` functions. This module is the Go side of [TotalFusion](../README.md): your program registers its functions and TotalFusion starts it, keeps a pool of workers, and talks to it through the standard input and output.

A worker is a normal binary and an **isolated process**: a panic fails only the call that caused it, and even a crash of the whole process never takes Node.js down. Nothing is compiled by TotalFusion: you build the worker (`go build`) or you get it precompiled.

```go
package main

import (
	"unicode/utf8"

	totalfusion "github.com/totaljs-es/totalfusion/go"
)

func main() {
	app := totalfusion.New()

	app.Function("text.length", func(call *totalfusion.Call) (any, error) {
		text, ok := call.Args.Get("text").AsString()
		if !ok {
			return nil, totalfusion.Invalid("text must be a string")
		}
		return map[string]any{"length": utf8.RuneCountInString(text)}, nil
	}).Summary("Counts the characters of a text").Input("*text:String").Output("length:Number").MCP(true)

	app.Run()
}
```

```js
fusion.configure({ go: { binary: './worker/worker', workers: 4 } });

await fusion.go('text.length', { text: 'Hello' });   // { length: 5 }
```

The import path has a `go` at its end and the package is called `totalfusion`, so import it with that name, as above.

## Installing the module

The module is not on a registry: the npm package ships its sources, and the `go.mod` of your worker points to them.

```
module worker

go 1.21

require github.com/totaljs-es/totalfusion/go v0.0.0

replace github.com/totaljs-es/totalfusion/go => ../node_modules/totalfusion/go
```

It needs Go 1.21 or newer and has no dependencies at all (only the standard library, and no `cgo`).

## Functions

- `app.Function(name, func(call *Call) (any, error))` answers once.
- `app.Stream(name, func(call *Call) error)` sends many chunks with `call.Emit(value)`. In JavaScript: `for await (const chunk of fusion.go.stream(name, args))`. `Emit` waits when the consumer is slow (backpressure) and returns `ErrCancelled` when it stops reading, so `if err := call.Emit(x); err != nil { return err }` ends the stream.
- `call.Args` is a `Value`. `call.Args.Get("key")` never panics: a missing member is null.
- `call.Context()` is a `context.Context` that is cancelled when Node.js gave up (timeout, abort) or the worker is asked to stop. Pass it to what the function calls. `call.Cancelled()` is the same as a boolean. A function that never looks is killed after `cancelGrace` and the worker is replaced.
- `app.OnShutdown(func() { ... })` runs when the worker is asked to stop. What you do in `main` before `Run()` (load a model, open a connection) happens before the worker says it is ready.
- Every call runs in its own goroutine, so a function must be safe to run at the same time as itself when `concurrency` is more than 1.

## Values

`Value` holds everything JSON can, plus binary data that never goes through JSON. A function receives it as `call.Args`:

| JavaScript | Go (what you read) |
|---|---|
| string, boolean, `null` | `AsString()`, `AsBool()`, `IsNull()` |
| number | `AsFloat()` for any number, `AsInt()` for an integer (or a float with no decimals) |
| array, object | `At(i)`, `Get(key)`, `AsArray()`, `AsObject()` |
| `Buffer`, `Uint8Array`, `ArrayBuffer` | `AsBytes()` (`[]byte`) |
| `Float32Array`, `Float64Array`, `Int32Array` | `AsFloat32s()`, `AsFloat64s()`, `AsInt32s()` |
| `Int8Array`, `Int16Array`, `Uint16Array`, `Uint32Array`, `BigInt64Array`, `BigUint64Array` | `Raw()`, as `[]int8`, `[]int16`, `[]uint16`, `[]uint32`, `[]int64`, `[]uint64` |

Each `As` method returns the value and whether it was of that type. `Raw()` is the plain Go value (`nil`, `bool`, `int64`, `float64`, `string`, `[]any`, `map[string]any`, or a slice).

A function returns plain Go values: `nil`, booleans, any integer or float, strings, `[]any`, `map[string]any`, and the slices `[]byte` (a `Buffer`), `[]int8`, `[]int16`, `[]uint16`, `[]int32`, `[]uint32`, `[]int64`, `[]uint64`, `[]float32` (a `Float32Array`) and `[]float64`, which travel as raw bytes. Anything else (a struct with `json` tags, a `[]string`, a `map[string]int`) goes through `encoding/json`, which cannot carry binary data. `call.Args.Raw()` can be returned as it is, to echo what arrived.

NaN and infinity cannot be sent (JSON has no such numbers): the call fails with `NOT_SERIALIZABLE`.

## Errors

`totalfusion.NewError("...")` (or a plain Go `error`) is a failure of the function. `totalfusion.Invalid("...")` is a mistake of the caller (bad input): in Total.js its message is sent to the client, and the message of any other error stays in the log. `totalfusion.Named("DatabaseError", "...").WithCode("E_DB")` gives the error a name and a code of its own; it is found even when it is wrapped (`fmt.Errorf("...: %w", err)`). A panic becomes an error named `Panic`, and its stack goes to the error output. `Invalidf` and `Errorf` take a format.

## Total.js

The methods that describe a function apply to the function registered just before them: `Summary`, `Input`, `Output`, `Query`, `Params` (the schema syntax of Total.js, `*` means required), `Permissions`, `User`, `SA`, `SU`, `Timeout` (a `time.Duration`), `Idempotent` (the call may be repeated on another worker if this one dies), `ID` and `MCP`. A function that declares any of them, or calls `.Action()`, becomes an action of Total.js with `fusion.register({ runtime: 'go', go: { binary } })`; the others stay callable from JavaScript but private. `MCP(true)` also exposes it to AI agents.

`./worker --describe` prints the contracts as JSON. This is what `register()` and `fusion.doctor('go')` read: no function is called to learn them, but the program starts, so what your `main` does before `Run()` (loading a model, opening a connection) runs too.

## Do not print to the standard output

It carries the protocol. On Unix and on Windows the module redirects it to the error output for you, so `fmt.Println` is harmless, but use `fmt.Fprintln(os.Stderr, ...)` or the `log` package to be safe everywhere.

## Memory

`totalfusion.Memory()` is the memory of the process in bytes, and whether the system tells it. Every answer carries it, and it is what `maxMemory` looks at. Linux: resident set size. Windows: the private bytes of the process. Other systems, macOS included: the memory that the Go runtime holds, because asking for the footprint needs `cgo`.

## As a WebAssembly module

The same functions can run in the sandbox of [WebAssembly](../docs/webassembly.md): no files, no network, no environment. Call `app.Wasm()` in an `init` function (a module of this kind does not run `main`), build with Go 1.24 or newer, and call it with `fusion.wasm(...)`:

```go
func init() {
	app := totalfusion.New()
	app.Function("math.add", add).Input("*a:Number\n*b:Number")
	app.Wasm()
}

func main() {}
```

```bash
GOOS=wasip1 GOARCH=wasm go build -buildmode=c-shared -o module.wasm
```

A module answers once per call: `Emit` returns an error, and a function registered with `app.Stream` is refused. Nothing changes in the code of the other functions.

## Building for another system

```bash
GOOS=linux   GOARCH=amd64 go build -o worker-linux .
GOOS=windows GOARCH=amd64 go build -o worker.exe .
GOOS=darwin  GOARCH=arm64 go build -o worker-mac .
```

The module needs no `cgo` and no other tool, so this works from any system.

## Rebuilding while the application runs

Windows does not let anything overwrite an executable that is running, so on Windows TotalFusion runs your worker from a copy and the file `go build` writes stays free (`shadowCopy`, on by default there). With `fusion.watch('go')` the workers are replaced by the new build.

## Requirements

Go 1.21 or newer. Standard library only. Tested with Go 1.21 and 1.27 on macOS (Apple silicon), and in the continuous integration on Linux, macOS and Windows.
