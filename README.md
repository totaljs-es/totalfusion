# TotalFusion

<p align="center">
  <a href="docs/python.md"><img src="docs/assets/python.svg" alt="Python" height="56"></a>&nbsp;&nbsp;&nbsp;&nbsp;
  <a href="docs/rust.md"><img src="docs/assets/rust.svg" alt="Rust" height="56"></a>&nbsp;&nbsp;&nbsp;&nbsp;
  <a href="docs/go.md"><img src="docs/assets/go.svg" alt="Go" height="56"></a>&nbsp;&nbsp;&nbsp;&nbsp;
  <a href="docs/webassembly.md"><img src="docs/assets/webassembly.svg" alt="WebAssembly" height="56"></a>
</p>

<p align="center"><sub>Python, Rust, Go and WebAssembly &middot; for Total.js and Node.js</sub></p>

**Extends Total.js with other runtimes.** Call functions written in Python, Rust and Go from Total.js and Node.js as plain `async` functions, and use them as Actions, API endpoints and MCP tools for AI agents, without leaving JavaScript. WebAssembly modules run in a sandbox.

```python
# python/sentiment.py
from totalfusion import action

@action(summary='Detects the sentiment of a text', input='*text:String', output='label:String', mcp=True)
def analyze(data):
    return { 'label': 'POSITIVE' if 'love' in data['text'] else 'NEGATIVE' }
```

```js
// Total.js application
const fusion = REQUIRE('totalfusion');

fusion.register({ python: { path: PATH.root('python') } });

// 'sentiment/analyze' is now a Total.js action: ACTION(), API routes and an MCP tool for AI agents
const result = await ACTION('sentiment/analyze', { text: 'I love it' }).promise();
```

Total.js validates the input against the contract before Python runs. The engine (`require('totalfusion')`) is plain Node.js and does not depend on Total.js, so `fusion.python('sentiment.analyze', data)` also works in any Node.js program.

## What you get

- **Python, Rust and Go workers** that Node.js supervises: a pool of long-lived processes, correlated calls, timeouts, cancellation and real errors (with the traceback in Python). A crash in a worker never takes your application down. → [Python](docs/python.md), [Rust](docs/rust.md), [Go](docs/go.md)
- **A sandbox**: a WebAssembly module runs without files, network or environment, in one file that works on any system. → [WebAssembly](docs/webassembly.md)
- **Total.js integration**: the functions that declare a contract become actions with validated `input`, `query` and `params`, permissions, API routes, MCP tools, and Server-Sent Events. → [Total.js 5](docs/total5.md)
- **Seven components for Flow**: call a function of any runtime from a node, stream chunks as messages, send the events of the workers to an alert and read the stats. They were run in the designer of Flow. → [Flow](docs/flow.md)
- **Binary data without base64**: `Buffer` and typed arrays travel as raw bytes in both directions, NumPy arrays included. A 100 MB buffer makes the round trip in 43 ms. → [Binary data](docs/binary-data.md)
- **Streaming** with backpressure and cancellation: a generator in Python or a stream function in Rust or Go is an async iterable. → [Streaming](docs/streaming.md)
- **Several calls at once** in one worker, for calls that wait, and for the threads of a Rust worker or the goroutines of a Go one. → [Working with the workers](docs/workers.md)
- **Workers that stay healthy**: replaced after a number of calls or when they use too much memory, with no call lost, and checked while idle. Events for your logs. Optional retry of calls that you declare idempotent. → [Working with the workers](docs/workers.md)
- **Development reload**: save a file and the next call runs the new code. → [Development](docs/development.md)
- **A `doctor`** that tells you what is missing, and the exact command to fix it, before anything runs. → [Development](docs/development.md#checking-your-setup)

## Runtimes

| | | |
|---|---|---|
| [Python](docs/python.md) | Available | Machine learning, scientific computing, any Python library. Python 3.9 or newer. |
| [Rust](docs/rust.md) | Available | Speed, many threads, a small footprint. You build a binary; running it does not need Rust. |
| [WebAssembly](docs/webassembly.md) | Available | Code in a sandbox, in one `.wasm` file for every system. Go is the language with an SDK today. |
| [Go](docs/go.md) | Available | Network and infrastructure code, many calls at once, one binary that you can build for any system. You build a binary; running it does not need Go. |

## Why not just `child_process`?

A process per call costs about 17.6 ms to start. A worker that is already running answers a small call in 0.07 ms (Python) or 0.03 ms (Rust and Go), and keeps your model in memory. Beyond speed you get what you would otherwise write yourself: a pool, a bounded queue, timeouts, cancellation, restart of workers that die, memory limits, streaming, binary transfer and the contracts that make a function an action. [Use cases](docs/use-cases.md) has the cases with their numbers, and [Where it does not fit](docs/use-cases.md#where-it-does-not-fit) says when not to use it.

## Install

TotalFusion is **not on npm yet**. From a clone of the repository:

```bash
npm install ../totalfusion
```

Once published it will be `npm install totalfusion`. It needs Node.js 20 or newer, and Python 3.9 or newer for the Python runtime. Rust and Go are needed only to build a worker in that language. **TotalFusion never installs, downloads or compiles anything for you.** → [Getting started](docs/getting-started.md)

## Documentation

| | |
|---|---|
| [Getting started](docs/getting-started.md) | Install it, call your first function, make it an action. |
| [Tutorials](docs/tutorials/README.md) | Step by step, each with an application that is tested on every change. |
| [Use cases](docs/use-cases.md) | What it is good for, with the numbers that were measured. |
| [Python](docs/python.md) · [Rust](docs/rust.md) · [Go](docs/go.md) | One page per runtime. |
| [Total.js 5](docs/total5.md) · [Flow](docs/flow.md) | Actions, validation, permissions, MCP, SSE. The components for Flow. |
| [Binary data](docs/binary-data.md) · [Streaming](docs/streaming.md) | The two big features of the transfer. |
| [Working with the workers](docs/workers.md) | Concurrency, recycling, health check, events, retrying. |
| [Errors and cancellation](docs/errors.md) | The error codes. |
| [Development and diagnosis](docs/development.md) | Reload on change and the `doctor`. |
| [AI assistants](docs/ai.md) | `AGENTS.md`, `llms.txt`, the schemas and your functions as tools for agents. |
| [How it works](docs/how-it-works.md) | The pool, the workers and the protocol. |
| [Security](docs/security.md) | What it protects and what it does not. |
| [Reference](docs/reference.md) | Every option, method and command. |

The index of the documentation is [docs/README.md](docs/README.md).

## Examples

All of them run from a clone of the repository:

| | |
|---|---|
| [examples/totaljs-app](examples/totaljs-app) | A Total.js 5 application with Python: actions, an API route, Server-Sent Events and reload on edit. `npm install && npm start`. |
| [examples/totaljs-numerics](examples/totaljs-numerics) | Total.js 5 with NumPy statistics, a Rust Action and binary typed arrays. |
| [examples/basic.js](examples/basic.js) | `fusion.python()` in any Node.js program. |
| [examples/streaming.js](examples/streaming.js) | A Python generator as an async iterable, and cancelling it. |
| [examples/rust.js](examples/rust.js) | The Rust worker of [examples/rust](examples/rust) (build it first with `cargo build --release`). |
| [examples/go.js](examples/go.js) | The Go worker of [examples/go](examples/go) (build it first with `go build -o worker`). |
| [examples/wasm.js](examples/wasm.js) | The WebAssembly module of [examples/wasm](examples/wasm) (build it first, see the file). |
| [examples/components](examples/components) | Components that use scikit-learn, NumPy and PyTorch (they need those libraries in your Python). |

## Status

Version 0.1.0, not published. The whole test suite (more than 410 tests: Python, Rust, Go, WebAssembly and the components for Flow) **passes in GitHub Actions on Linux, macOS and Windows**, and it was run locally on macOS as well:

| | Where it has run |
|---|---|
| Linux | GitHub Actions on Ubuntu: Node.js 20, 22 and 24 with Python 3.9 to 3.14 |
| macOS | GitHub Actions (Node.js 24, Python 3.12) and locally on Apple silicon (Node.js 20, 22 and 24, Python 3.9 to 3.15) |
| Windows | GitHub Actions (Node.js 24, Python 3.12): the whole suite, including the binary pipes, the memory of a worker and the Rust, Go and WebAssembly workers |
| Rust | The stable toolchain of the runners, and 1.99 locally (the `totalfusion` crate and its worker) |
| Go | The stable toolchain of the runners on the three systems, and locally with Go 1.21 and 1.27 (the module with the race detector, and the 62 tests of its worker) |
| WebAssembly | GitHub Actions on the three systems (Node.js 20, 22 and 24 on Linux), and locally with Node.js 26: the 50 tests of the module, including a module that tries to get out |
| Flow | The test harness of Total.js on the three systems, and by hand in the designer of Flow 11.1 on macOS |
| Total.js | `total5` from npm in GitHub Actions, and also the 0.0.20 development version locally |

Python 3.15 and the combinations that are not in the matrix of [.github/workflows/test.yml](.github/workflows/test.yml) were run only locally.

Not verified: connecting a specific AI client to the MCP endpoint, and the components for Flow in the cloud service of Total.js.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for how to run the tests and how the project is organised, and [CHANGELOG.md](CHANGELOG.md) for what each version contains. **AI coding agents:** [AGENTS.md](AGENTS.md) says how to use TotalFusion in an application and how to work on this repository; it is also in the package.

## Credits

The logos of Python, Rust, Go and WebAssembly in the header come from [Simple Icons](https://simpleicons.org) (version 16.35.0, CC0) and only identify the languages and the technology. Python is a trademark of the Python Software Foundation, Rust of the Rust Foundation and Go of Google, and WebAssembly is a standard of the W3C. TotalFusion is not affiliated with or endorsed by any of them. The files are in [docs/assets](docs/assets) and can be replaced by other versions of the logos.

## License

MIT
