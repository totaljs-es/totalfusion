# Go (planned)

**Status: not started.** There is no Go in the package, and nothing on this page works yet. It exists so that the plan is written down: what Go would give, how it would fit, what has to be built and how to help. There is no date.

## Why Go

These are properties of Go, not measurements of TotalFusion:

- **A single static binary.** A precompiled worker needs nothing installed on the machine that runs it, like a Rust worker.
- **Goroutines.** Many calls at once in one process is the normal way of working in Go, which fits `concurrency`.
- **Network and infrastructure code.** Servers, scanners, pipelines and tools for operations are what Go is mostly used for, and that code could then be called from Node.js and Total.js as functions.

## What it would look like

This is a **design sketch**. The API does not exist.

```go
// a worker written with the (future) totalfusion module for Go
package main

import "totalfusion"

func main() {
    app := totalfusion.New()

    app.Function("net.check", func(call *totalfusion.Call) (any, error) {
        host, _ := call.Args.String("host")
        // ... the real work
        return map[string]any{"host": host, "up": true}, nil
    }).Summary("Checks if a host answers").Input("*host:String").MCP(true)

    app.Run()
}
```

```js
fusion.configure({ go: { binary: './worker/worker' } });
const result = await fusion.go('net.check', { host: 'example.com' });
```

## How it would work

Exactly as Rust does. A Go worker is an **isolated process** that speaks the [protocol](how-it-works.md#the-protocol), so everything the engine already does would work with it without changes to the engine: the pool, timeouts, cancellation, [binary data](binary-data.md), [streaming](streaming.md), [concurrency](workers.md#several-calls-at-the-same-time), [recycling and health checks](workers.md#keeping-workers-healthy), [events](workers.md#observing-the-workers), [reload](development.md), the `doctor`, and the actions and MCP tools of [Total.js](total5.md).

## What has to be built

The Rust runtime is the measure, because it was written the same way:

1. **A Go module** that implements the protocol: the frames, calls, chunks with credit, cancellation, `ping` and `pong` with the memory of the process, the shutdown, and `--describe` to print the contracts. The Rust crate is about 1,300 lines (a good part of them unit tests).
2. **An adapter for Node.js** (`go/index.js`) with `create`, `describe`, `doctor` and `watchTarget`, and the entry in `ADAPTERS`. The one for Rust is about 200 lines.
3. **A worker for the tests and a test suite** in the style of `tests/rust.test.js` (calls, errors, binary data, streams, cancellation, concurrency, recycling, reload, Total.js). The Rust ones are about 900 lines.
4. **Documentation**, in the form of this folder.

The details of what an adapter must provide are in [CONTRIBUTING.md](../CONTRIBUTING.md#adding-a-runtime).

## What it would not be

- **Not in the Node.js process.** No `cgo` addon and no native binding: a crash or a leak in Go must never take the application down.
- **Not a translator.** TotalFusion does not turn JavaScript into Go. You write the function in Go.
- **Not a sandbox**, like the other runtimes.
- **Not a promise of a date.** It will be built when someone needs it enough to build it.

## Questions that are still open

- How a function learns that its call was cancelled in Go (a `context.Context` that the call carries is the natural answer).
- How to report the memory of the process on each system without a library.
- How the module is distributed, given that it is not on a registry the way an npm package is. The Rust crate solves it with a path into `node_modules`; Go has the `replace` directive for the same.
- On Windows the binary would run from a copy, as the Rust workers do, so that the build can replace it while it runs.

## How you can help

Open an issue before you start, so the work is not duplicated, and follow [CONTRIBUTING.md](../CONTRIBUTING.md). If you need Go today, the functions that must be fast and isolated can be written in [Rust](rust.md), and the ones that need a library can be written in [Python](python.md).
