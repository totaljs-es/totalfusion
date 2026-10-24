# AGENTS.md: the tests

How the tests of TotalFusion are organised. The rest of the project is in `../AGENTS.md`.

## Layout

- `*.test.js` use `node:test`: one file for each area (`python`, `rust`, `go`, `wasm`, `stream`, `binary`, `lifecycle`, `watch`, `doctor`, `flow`, `tutorials`, `docs`, `agents`, `package`...). Run one with `node --test tests/go.test.js`.
- The workers and modules that they run: `components/` (Python), `rust/`, `go/`, `wasm/`, and `wasm-fixtures.js`, which assembles by hand the WebAssembly modules that no compiler would produce.
- `*-build.js` find a compiler, build the worker once and return its path. **Without the compiler the tests that need it are skipped, not failed.** `locate-total5.js` finds Total.js 5 (`TOTAL5_PATH`, the `total5` package or a sibling `../framework5`).
- `*-script.js` run in a process of their own (Total.js globals, an application, the harness of Flow) and print a JSON report that the test reads.

## Rules

- **A test must be able to fail.** Break the code on purpose, see it fail, put it back.
- **Wait for a condition, never for a fixed time:** a loop with a limit that checks the behaviour. Fixed sleeps fail on a loaded machine.
- **Clean up:** end the workers (`shutdown()`), remove the temporary folders and built files, and leave nothing running.
- A test that starts an application spawns it with an IPC channel (`stdio: [..., 'ipc']`); otherwise Total.js starts its debug watcher and the process cannot be stopped cleanly. `spawnSync` blocks the process of the test, so wait a moment before you read what a child printed.
- Run the Python tests with `PYTHONDONTWRITEBYTECODE` unset. Text files of the repository can have CRLF line endings on Windows: split with `/\r?\n/`.
- A test of the documentation (`docs.test.js`, `agents.test.js`) fails when a link, a path, a generated file or a schema is out of date: run `npm run generate`.
