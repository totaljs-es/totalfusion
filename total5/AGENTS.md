# AGENTS.md: the integration with Total.js 5

How the functions of a worker become part of a Total.js application: `index.js` (`register`, `sse`, `lint`), `flow.js` (the logic of the components of Flow) and `flow/*.html` (the components). The rest of the project is in `../AGENTS.md`.

## register and sse

- `fusion.register()` reads the contracts (`fusion.describe()`, without running anything) and creates a `NEWACTION()` for each function that declares one. `input`, `query`, `params`, `permissions`, `user`, `sa` and `su` are validated by the framework before the function runs; `mcp` makes it a tool of the MCP endpoint.
- **Total.js splits the fields of a schema on commas, even inside a `// comment`:** `lint()` warns about it. A field that is optional and arrives with an invalid value is dropped silently; use `*` to require it.
- Only the message of a `ValueError` (or `Invalid`, `Error::invalid`) reaches the client; any other failure is logged through `onerror` and answers "The action failed".
- `fusion.sse($, stream)` sends `data: <json>` for each chunk, `event: end` and `event: error`, and cancels the stream when the response closes.
- Everything is on the main package (`fusion.register`, `fusion.sse`, `fusion.flow`): Total.js does not accept `require('totalfusion/total5')`.

## The components of Flow

- `flow/*.html` are small: id (`fusion...`), name, icon, settings and `exports.make = require('totalfusion').flow(kind, runtime)`. The logic is in `flow.js` and is tested without Total.js in `../tests/flow-logic.test.js`.
- **Icons must exist in the icon font of Flow**, which is not Tabler: a name that it lacks shows nothing. The tests list the ones that work.
- After a change in a component run `npm run generate`: `flow/db.json` is the list that the catalog of the designer reads, and it is built from the files.
- A component is installed from the catalog of Flow; the FlowStream is a process of its own that loads the extensions file of the Flow application, which is where `fusion.configure()` goes. See `../docs/flow.md`.

## Check a change

```bash
node --test tests/flow.test.js tests/flow-logic.test.js tests/total5.test.js
```

These need Total.js 5 (`TOTAL5_PATH`, the `total5` package or a sibling `../framework5`) and its test harness of Flow (the file flow-test.js of the framework); without them they are skipped.
