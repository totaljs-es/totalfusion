---
name: totalfusion-add-tutorial
description: Use when asked to write a new tutorial for TotalFusion or to change an existing one.
---

# Add a tutorial

A tutorial is **a page and an application that a test runs**, so what the page says works.

1. **The application:** `examples/tutorials/NN-name/` with `package.json` (`total5` and `"totalfusion": "file:../../.."`), `index.js` that reads `process.env.PORT` and listens on `127.0.0.1`, `config`, `definitions/`, the worker code, and a `verify.js` that makes every call of the page and compares the answers. Use only ASCII in the code. Keep what it builds out of git (`plugins/*.wasm` is ignored).
2. **Run it for real** and **copy the outputs of the page from what it printed**, not from memory. Capture the real `curl` answers and the real log lines.
3. **The page:** `docs/tutorials/NN-name.md` with the same name. What you will build, what you need, steps with the real commands and answers, a "check it yourself" section that runs the script `verify` of the package.json of the tutorial, what the reader learned and where to go next. Say what the sandbox or the feature does **not** do. Link it from `docs/tutorials/README.md` and add it to `scripts/llms.js`, then `node scripts/llms.js --write`.
4. **The test:** add a `describe` to `tests/tutorials.test.js`: `copy('NN-name')` makes a temporary copy with `node_modules` linked, `start()` spawns it with an IPC channel (otherwise Total.js starts its debug watcher and it cannot be stopped), `verify()` runs `verify.js`. A tutorial that needs a compiler is skipped when it is missing. `spawnSync` blocks the test process: wait a moment before reading what the application printed.
5. **Break it on purpose** (change the answer of a function, open the sandbox) and see the test fail.
6. **Run** `node --test tests/tutorials.test.js tests/docs.test.js tests/agents.test.js`, then `npm test`.

Gotchas: a dot in a route (`/x/a.b/`) looks like a file and gets an empty reply; tools of MCP register a moment after the actions, so `verify.js` must wait for them; the application starts slowly in debug mode, so poll until it answers.
