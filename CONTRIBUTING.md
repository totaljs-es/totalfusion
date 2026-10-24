# Contributing

`npm run check` runs the fast tests (documentation, files for agents, package) and `npm run generate` rebuilds the files that are generated from the pages. The conventions and the lessons of the project, written for AI coding agents and useful to anyone, are in [AGENTS.md](AGENTS.md).

## Running the tests

```bash
npm test                                          # needs Node.js 20 or newer and Python 3.9 or newer
cargo test --manifest-path rust/Cargo.toml        # the crate
(cd go && go test -race ./...)                    # the Go module
```

- Rust: if `cargo` is found, `npm test` builds the worker in `tests/rust` and runs its tests; without it they are not run.
- Go: if `go` is found (or `GO=/path/to/go`), `npm test` builds the worker in `tests/go` and runs its tests; without it they are not run. The Go module needs Go 1.21 or newer.
- WebAssembly: `npm test` builds the module of `tests/wasm` for `GOOS=wasip1`, which needs Go 1.24 or newer (the first with `//go:wasmexport`); without it those tests are not run. The host (`wasm/host.js`) needs the `node:wasi` of Node.js.
- Total.js 5: the integration tests look in `TOTAL5_PATH`, in the `total5` package and in a sibling `../framework5`; without it they are skipped.
- `TOTALFUSION_PYTHON=/path/to/python npm test` runs the suite with another Python. `TOTALFUSION_TEST_NUMPY=/path/to/python` enables the NumPy tests.

Run the tests with `PYTHONDONTWRITEBYTECODE` **unset** as well (`env -u PYTHONDONTWRITEBYTECODE npm test`): some environments set it, and then Python never writes the bytecode that every CI runner does write. A bug of that kind hid from us for a long time.

To enable NumPy locally, create a virtual environment and run:

```bash
python3 -m venv .venv
.venv/bin/python -m pip install -r examples/totaljs-numerics/requirements.txt
TOTALFUSION_TEST_NUMPY="$PWD/.venv/bin/python" npm test
```

CI installs NumPy for each Python version and enables these tests too.

The documentation is tested too (`tests/docs.test.js` checks that every link and anchor leads somewhere and that every page is reachable from `docs/README.md`), so change it together with the code.

After a change in a component of Flow (`total5/flow/*.html`) run `node scripts/flow-db.js --write` to update `total5/flow/db.json`; a test fails if it is out of date. The icons have to be in the icon font of Flow, not any icon of Tabler.

A tutorial is a page in `docs/tutorials` and an application in `examples/tutorials` with the same name and a `verify.js` that checks what the page says; `tests/tutorials.test.js` starts it for real. Write the commands and the answers of the page from what the application printed, not from memory.

A change should come with tests. When you fix something, check that the test fails without the fix.

## How it is organised

| | |
|---|---|
| `index.js`, `lib/` | The engine: the pool of workers, the protocol (`lib/protocol.js`), streams, the doctor and the watcher. It knows nothing about a language. |
| `python/` | The Python adapter and its worker (`worker.py`, standard library only) and SDK (`sdk/totalfusion.py`). |
| `rust/` | The Rust adapter (`index.js`) and the `totalfusion` crate (`src/`). |
| `go/` | The Go adapter (`index.js`) and the `totalfusion` module (`*.go`). |
| `wasm/` | The WebAssembly adapter (`index.js`) and the host process that runs a module in a sandbox (`host.js`). The SDK of Go for it is `go/wasm*.go`. |
| `total5/` | The integration with Total.js 5: actions, MCP, Server-Sent Events and the components of Flow (`flow/*.html`, with their logic in `flow.js`). |
| `tests/` | The tests, and the components and workers they run. |

## Adding a runtime

A runtime is an adapter plus a worker that speaks the protocol of `lib/protocol.js` over its standard input and output (`ready`, `call`, `chunk`, `res`, `credit`, `cancel`, `ping`/`pong`, `bye`). The adapter exports `create(config)` (returns a `Pool`), `describe(config)`, `doctor(config)` and `watchTarget(config)`, and is added to `ADAPTERS` in `index.js`. The Rust and the Go adapters are the shortest examples. A worker must answer a `pong` with its memory and must not use its standard output for anything else.

## Style

Plain JavaScript in the style of Total.js: tabs, `'use strict'`, no dependencies, no TypeScript. Rust follows `rustfmt` and Go follows `gofmt`. Keep the documentation honest: say what was measured and where, and what was not verified.
