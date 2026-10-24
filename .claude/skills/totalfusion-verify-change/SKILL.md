---
name: totalfusion-verify-change
description: Use when you finish a change to TotalFusion (code, documentation, a component of Flow, a tutorial, a schema) and have to check it before you say that it works.
---

# Verify a change

Say that something works only after you have **run** it. In this order, from the cheapest:

1. **Regenerate what is generated:** `npm run generate` (`llms.txt`, `llms-full.txt` and `total5/flow/db.json`). If `git status` shows changes in those files, they were out of date: they are part of the change.
2. **The fast checks:** `npm run check` runs the tests of the documentation, of the files for agents and of the package (links, anchors, paths that a text mentions, the schemas, what goes into the npm package). It takes seconds.
3. **The area that you touched:** `node --test tests/<area>.test.js`. Python: `tests/python.test.js`, `binary`, `stream`, `contract`. Rust: `npm run test:rust` and `tests/rust.test.js`. Go: `npm run test:go` (with `-race`) and `tests/go.test.js`. WebAssembly: `tests/wasm.test.js`. Total.js and Flow: `tests/total5.test.js`, `tests/flow.test.js`. A tutorial: `tests/tutorials.test.js`.
4. **Other systems:** a change in Go that depends on the system must still compile for them: `GOOS=windows go vet ./...` and `GOOS=wasip1 GOARCH=wasm go vet ./...` in `go/`. Windows and Linux run in the continuous integration, so a path or a line ending that you only tried on one system is not verified.
5. **Make the test able to fail.** Break the code on purpose (open the sandbox, remove the `fresh()` of a trap, drop an option from a schema) and see the test fail, then put it back. A test that you never saw fail may test nothing.
6. **The whole suite:** `npm test`. Report the numbers as they are: how many passed, failed and were skipped, and why (NumPy, a missing compiler).
7. **The package:** `npm pack --dry-run --json` has no tests, examples, built workers or `__pycache__`, and does not grow by surprise.

If something fails only in CI, read the lines after "worker stopped during the call" in the log: the error output of the worker is there.
