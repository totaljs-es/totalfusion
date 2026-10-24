# AGENTS.md

Guidance for AI coding agents. The first part is for an agent that **uses** TotalFusion in an application; the second is for one that **works on** this repository.

## Project

TotalFusion extends Total.js 5 with other runtimes: functions written in **Python, Rust, Go and WebAssembly** are called from Node.js as `async` functions, and become Total.js actions, API routes, MCP tools, Server-Sent Events and nodes of Flow. Each runtime is a pool of worker processes that Node.js supervises; a crash in a worker never takes the application down. The engine (`require('totalfusion')`) does not depend on Total.js; `fusion.register()`, `fusion.sse()` and `fusion.flow()` do.

Package name: `totalfusion` (version 0.1.1)
Node.js: 20 or newer. No dependencies. Plain JavaScript, no TypeScript (Total.js does not support it: never add types or `.d.ts`).
License: MIT

## Using it

Install it with `npm install totalfusion`. The documentation is in `docs/` (start with `docs/getting-started.md`, the tutorials in `docs/tutorials/`, the options in `docs/reference.md`).

```js
const fusion = require('totalfusion');   // in a Total.js definition: REQUIRE('totalfusion')

fusion.configure({
	python: { path: './python', workers: 2 },        // a folder of .py files
	rust: { binary: './worker/target/release/worker' },
	go: { binary: './worker/worker' },
	wasm: { module: './module.wasm' }                // one module for each Fusion
});

await fusion.python('module.function', args);       // also fusion.rust(), fusion.go(), fusion.wasm()
for await (const chunk of fusion.python.stream('module.generator', args)) { }
```

- **Total.js:** `await fusion.register({ python: { path: PATH.root('python') }, watch: DEBUG })` turns every function that declares a contract into an action (`module/function`). Then `ROUTE('API /api/ +module_function --> module/function')`. Do not `require('totalfusion/total5')`: Total.js does not accept that form; everything is on the main package.
- **Contracts** are the schema syntax of Total.js: Python `@action(summary=..., input='*text:String', output=..., mcp=True)`; Rust `.summary().input().mcp(true)`; Go `.Summary().Input().MCP(true)`. A function without a contract is callable from JavaScript but is **not** an action. `*` means required.
- **Errors:** `ValueError` (Python), `Error::invalid` (Rust) and `Invalid` (Go) are mistakes of the caller: Total.js sends their message to the client. Every other failure answers "The action failed" and the detail goes to the log.
- **MCP:** only functions that say `mcp` become tools, and the endpoint (`$mcp : true` in `config`) has **no authentication** unless you add one. Never turn it on in an application that listens on a public address without authentication.
- **A worker's standard output carries the protocol.** In Python, Rust and Go the SDK redirects `print` and `fmt.Println` to the error output, but write to the error output on purpose.
- **WebAssembly** modules run in a sandbox (no files, no network, no environment) and are WASI reactors with a small ABI (`docs/webassembly.md`). A runtime has one module: use one `new Fusion({ wasm: ... })` for each module. The SDK is in Go (`app.Wasm()` in `init`, Go 1.24 or newer).
- **A route with a dot in a segment** (`/x/discount.apply/`) looks like a file to Total.js and gets an empty reply: split the function name across segments.
- **Nothing is downloaded, compiled or installed for you.** Workers are built by the user (`cargo build --release`, `go build`).
- **Check the setup first:** `npx totalfusion doctor --path ./python` (also `--runtime rust|go|wasm` with `--binary` or `--module`). For Python it reads the components without importing them; for Rust and Go it executes the worker with `--describe`, and for WebAssembly it runs the host to read the module contract. Use trusted native workers. It says what to fix; with `--json` it prints `{ ok, checks: [{ status, name, message, fix }] }` and the exit code is `0`, `1` (something to fix) or `2` (wrong usage). Run the command of `fix` instead of guessing.
- **Flow:** seven components (Python, Rust, Go, WebAssembly, Stream, Events, Stats) in `total5/flow/`, listed in `total5/flow/db.json`; see `docs/flow.md`.
- **More for models:** `llms.txt` (an index of the documentation), `llms-full.txt` (all of it in one file), `schemas/configure.schema.json` (the options of `fusion.configure()` and of a call) and `schemas/contract.schema.json` (a contract and what `--describe` prints). `docs/ai.md` explains them.

## Repository layout

Each area (`go/`, `rust/`, `python/`, `wasm/`, `total5/`, `tests/`) has its own `AGENTS.md` with the rules of that area: read it before you change files there.

- `index.js` is the `Fusion` class and the entry point. `lib/` is the engine: `pool.js` (workers, queue, timeouts, recycling, health check, retries), `protocol.js` (frames), `stream.js`, `watch.js`, `doctor.js`, `options.js`, `errors.js`.
- `python/`, `rust/`, `go/`, `wasm/` are the runtimes: each has an adapter (`index.js`) and its worker or SDK (`worker.py` and `sdk/`; the `totalfusion` crate in `rust/src`; the Go module in `go/*.go`; `wasm/host.js`).
- `total5/` is the Total.js integration: `index.js` (`register`, `sse`), `flow.js` and `flow/*.html` (the components of Flow).
- `bin/totalfusion.js` is the `doctor` command. `scripts/flow-db.js` builds `total5/flow/db.json`; `scripts/llms.js` builds `llms.txt` and `llms-full.txt`.
- For Codex: this file is the native entry point; no separate Codex instructions file is needed. Start the chat in the TotalFusion repository so instructions and repo-local skills are discovered. The four entries in `.agents/skills/` reuse the shared checklists in `.claude/skills/`; read their linked checklist when a workflow applies. See `docs/ai.md`.
- For agents: this file, `CLAUDE.md` and `GEMINI.md` (they import it), `.github/copilot-instructions.md`, `.claude/skills/` (four checklists: add a function, diagnose a worker, add a tutorial, verify a change) and `.claude/settings.json` (the commands that are safe to run without asking), `schemas/` and `llms.txt`.
- `tests/` has the tests and the workers they run (`tests/go`, `tests/rust`, `tests/wasm`, `tests/components`). `examples/` has the examples (`examples/README.md` lists them, and `tests/examples.test.js` runs them) and the applications of the tutorials (`examples/tutorials`). `docs/` is the documentation, and it is tested.
- `.github/workflows/test.yml` runs the suite on Linux (Node.js 20, 22, 24), macOS and Windows. A change that only touches documentation (`docs/`, `*.md`, `llms*.txt`) runs only the checks of the texts; a release always runs everything.

## Commands

```bash
npm test                                  # the whole suite (node --test)
npm run check                             # the fast checks: documentation, files for agents, package
npm run generate                          # llms.txt, llms-full.txt and total5/flow/db.json
node --test tests/go.test.js              # one file
npm run test:rust                         # cargo test of the crate
npm run test:go                           # go test of the module
node scripts/flow-db.js --write           # only the list of components of Flow
node scripts/llms.js --write              # only llms.txt and llms-full.txt
npx totalfusion doctor --path tests/components
npm pack --dry-run                        # what goes into the package
```

`npm test` needs Python 3.9 or newer. The tests of Rust run if `cargo` is found, the ones of Go if `go` is found (`GO=/path/to/go`), the ones of WebAssembly and the tutorial 2 if that Go is 1.24 or newer, and the ones of Total.js and Flow if Total.js 5 is found (`TOTAL5_PATH`, the `total5` package or a sibling `../framework5`). Without them those tests are skipped, not failed. See `CONTRIBUTING.md`.

## Conventions

- Plain JavaScript in the style of Total.js: tabs, `'use strict'`, no dependencies. Rust follows `rustfmt`, Go follows `gofmt`.
- The protocol is version 2 (`lib/protocol.js`): the Python worker, the Rust crate, the Go module and the host of WebAssembly all speak it. A change in one is a change in all.
- A change comes with tests, and a test must be able to fail: **break the code on purpose and see the test fail** before you trust it.
- The documentation is part of the product and is tested (`tests/docs.test.js`: links, anchors, titles, reachability). A new page goes in `docs/README.md` and in `PAGES` of `scripts/llms.js`; `tests/agents.test.js` fails if it is missing. Say what was measured and where, what was verified and what was not. Do not write numbers from memory: run it.
- A tutorial is a page in `docs/tutorials` and an application in `examples/tutorials` with the same name and a `verify.js`; `tests/tutorials.test.js` runs it. Write the outputs of the page from what the application printed.
- Every replacement that a script does must assert that its pattern matched: a silent no-op looks like success.

## Pitfalls

- **Windows:** an executable that is running cannot be replaced (the Rust and Go workers run from a copy: `shadowCopy`). In Go, never make a second `os.File` for a handle that another `os.File` owns: the finalizer of the first closes it at the first garbage collection (`go/stdout_windows.go`). Checkouts have CRLF line endings: split text with `/\r?\n/`.
- **Python:** run the tests with `PYTHONDONTWRITEBYTECODE` unset (`env -u PYTHONDONTWRITEBYTECODE npm test`); the components are loaded from source, never from bytecode (`stale.test.js`).
- **Make failures loud.** A worker that exits silently hides its cause: print the reason to the error output and exit non-zero.
- **Processes:** a script that waits for workers or watchers needs its own keep-alive timer, because idle workers are `unref`'d. Tests that start an application must spawn it with an IPC channel (`stdio: [..., 'ipc']`), or Total.js starts its debug watcher and the process cannot be stopped cleanly.
- **Flow:** the icon font of Flow is not Tabler: use names from the icon list of Flow (public/icons-db.html in its repository) or nothing shows.
- **Do not commit** built workers or modules (`target/`, `plugins/*.wasm`, `__pycache__`, `*.js.map`), and leave no files in the temporary directory after the tests.
