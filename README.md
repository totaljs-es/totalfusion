# TotalFusion

**Extends Total.js with other runtimes.** Call functions written in Python and Rust from Total.js and Node.js as plain `async` functions, and use them as Actions, API endpoints and MCP tools for AI agents, without leaving JavaScript. Go is planned.

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

- **Python and Rust workers** that Node.js supervises: a pool of long-lived processes, correlated calls, timeouts, cancellation and real errors (with the traceback in Python). A crash in a worker never takes your application down. → [Python](docs/python.md), [Rust](docs/rust.md)
- **Total.js integration**: the functions that declare a contract become actions with validated `input`, `query` and `params`, permissions, API routes, MCP tools, Server-Sent Events and a FlowStream component. → [Total.js 5](docs/total5.md)
- **Binary data without base64**: `Buffer` and typed arrays travel as raw bytes in both directions, NumPy arrays included. A 100 MB buffer makes the round trip in 43 ms. → [Binary data](docs/binary-data.md)
- **Streaming** with backpressure and cancellation: a generator in Python or a stream function in Rust is an async iterable. → [Streaming](docs/streaming.md)
- **Several calls at once** in one worker, for calls that wait and for the threads of a Rust worker. → [Working with the workers](docs/workers.md)
- **Workers that stay healthy**: replaced after a number of calls or when they use too much memory, with no call lost, and checked while idle. Events for your logs. Optional retry of calls that you declare idempotent. → [Working with the workers](docs/workers.md)
- **Development reload**: save a file and the next call runs the new code. → [Development](docs/development.md)
- **A `doctor`** that tells you what is missing, and the exact command to fix it, before anything runs. → [Development](docs/development.md#checking-your-setup)

## Runtimes

| | | |
|---|---|---|
| [Python](docs/python.md) | Available | Machine learning, scientific computing, any Python library. Python 3.9 or newer. |
| [Rust](docs/rust.md) | Available | Speed, many threads, a small footprint. You build a binary; running it does not need Rust. |
| [Go](docs/go.md) | Planned, not started | The plan is written down: what it would be and what is needed. |

## Why not just `child_process`?

A process per call costs about 17.6 ms to start. A worker that is already running answers a small call in 0.07 ms (Python) or 0.03 ms (Rust), and keeps your model in memory. Beyond speed you get what you would otherwise write yourself: a pool, a bounded queue, timeouts, cancellation, restart of workers that die, memory limits, streaming, binary transfer and the contracts that make a function an action. [Use cases](docs/use-cases.md) has the cases with their numbers, and [Where it does not fit](docs/use-cases.md#where-it-does-not-fit) says when not to use it.

## Install

TotalFusion is **not on npm yet**. From a clone of the repository:

```bash
npm install ../totalfusion
```

Once published it will be `npm install totalfusion`. It needs Node.js 20 or newer, and Python 3.9 or newer for the Python runtime. Rust is needed only to build a Rust worker. **TotalFusion never installs, downloads or compiles anything for you.** → [Getting started](docs/getting-started.md)

## Documentation

| | |
|---|---|
| [Getting started](docs/getting-started.md) | Install it, call your first function, make it an action. |
| [Use cases](docs/use-cases.md) | What it is good for, with the numbers that were measured. |
| [Python](docs/python.md) · [Rust](docs/rust.md) · [Go](docs/go.md) | One page per runtime. |
| [Total.js 5](docs/total5.md) | Actions, validation, permissions, MCP, SSE, FlowStream. |
| [Binary data](docs/binary-data.md) · [Streaming](docs/streaming.md) | The two big features of the transfer. |
| [Working with the workers](docs/workers.md) | Concurrency, recycling, health check, events, retrying. |
| [Errors and cancellation](docs/errors.md) | The error codes. |
| [Development and diagnosis](docs/development.md) | Reload on change and the `doctor`. |
| [How it works](docs/how-it-works.md) | The pool, the workers and the protocol. |
| [Security](docs/security.md) | What it protects and what it does not. |
| [Reference](docs/reference.md) | Every option, method and command. |

The index of the documentation is [docs/README.md](docs/README.md).

## Examples

All of them run from a clone of the repository:

| | |
|---|---|
| [examples/totaljs-app](examples/totaljs-app) | A Total.js 5 application with Python: actions, an API route, Server-Sent Events and reload on edit. `npm install && npm start`. |
| [examples/basic.js](examples/basic.js) | `fusion.python()` in any Node.js program. |
| [examples/streaming.js](examples/streaming.js) | A Python generator as an async iterable, and cancelling it. |
| [examples/rust.js](examples/rust.js) | The Rust worker of [examples/rust](examples/rust) (build it first with `cargo build --release`). |
| [examples/components](examples/components) | Components that use scikit-learn, NumPy and PyTorch (they need those libraries in your Python). |

## Status

Version 0.1.0, not published. The whole test suite (more than 240 tests, more than 180 of them without Rust) **passes in GitHub Actions on Linux, macOS and Windows**, and it was run locally on macOS as well:

| | Where it has run |
|---|---|
| Linux | GitHub Actions on Ubuntu: Node.js 20, 22 and 24 with Python 3.9 to 3.14 |
| macOS | GitHub Actions (Node.js 24, Python 3.12) and locally on Apple silicon (Node.js 20, 22 and 24, Python 3.9 to 3.15) |
| Windows | GitHub Actions (Node.js 24, Python 3.12): the whole suite, including the binary pipes, the memory of a worker and the Rust workers |
| Rust | The stable toolchain of the runners, and 1.99 locally (the `totalfusion` crate and its worker) |
| Total.js | `total5` from npm in GitHub Actions, and also the 0.0.20 development version locally |

Python 3.15 and the combinations that are not in the matrix of [.github/workflows/test.yml](.github/workflows/test.yml) were run only locally.

Not verified: the FlowStream component inside the Flow designer (it was run with the test harness of Total.js), and Go, which does not exist.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for how to run the tests and how the project is organised, and [CHANGELOG.md](CHANGELOG.md) for what each version contains.

## License

MIT
