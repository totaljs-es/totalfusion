# Contributing

## Running the tests

```bash
npm test                                          # needs Node.js 20 or newer and Python 3.9 or newer
cargo test --manifest-path rust/Cargo.toml        # the crate
```

- Rust: if `cargo` is found, `npm test` builds the worker in `tests/rust` and runs its tests; without it they are not run.
- Total.js 5: the integration tests look in `TOTAL5_PATH`, in the `total5` package and in a sibling `../framework5`; without it they are skipped.
- `TOTALFUSION_PYTHON=/path/to/python npm test` runs the suite with another Python. `TOTALFUSION_TEST_NUMPY=/path/to/python` enables the NumPy tests.

Run the tests with `PYTHONDONTWRITEBYTECODE` **unset** as well (`env -u PYTHONDONTWRITEBYTECODE npm test`): some environments set it, and then Python never writes the bytecode that every CI runner does write. A bug of that kind hid from us for a long time.

The documentation is tested too (`tests/docs.test.js` checks that every link and anchor leads somewhere and that every page is reachable from `docs/README.md`), so change it together with the code.

A change should come with tests. When you fix something, check that the test fails without the fix.

## How it is organised

| | |
|---|---|
| `index.js`, `lib/` | The engine: the pool of workers, the protocol (`lib/protocol.js`), streams, the doctor and the watcher. It knows nothing about a language. |
| `python/` | The Python adapter and its worker (`worker.py`, standard library only) and SDK (`sdk/totalfusion.py`). |
| `rust/` | The Rust adapter (`index.js`) and the `totalfusion` crate (`src/`). |
| `total5/` | The integration with Total.js 5: actions, MCP, Server-Sent Events and the FlowStream component. |
| `tests/` | The tests, and the components and workers they run. |

## Adding a runtime

A runtime is an adapter plus a worker that speaks the protocol of `lib/protocol.js` over its standard input and output (`ready`, `call`, `chunk`, `res`, `credit`, `cancel`, `ping`/`pong`, `bye`). The adapter exports `create(config)` (returns a `Pool`), `describe(config)`, `doctor(config)` and `watchTarget(config)`, and is added to `ADAPTERS` in `index.js`. The Rust adapter is the shortest example. A worker must answer a `pong` with its memory and must not use its standard output for anything else.

## Style

Plain JavaScript in the style of Total.js: tabs, `'use strict'`, no dependencies, no TypeScript. Rust follows `rustfmt`. Keep the documentation honest: say what was measured and where, and what was not verified.
