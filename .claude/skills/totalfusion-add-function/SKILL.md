---
name: totalfusion-add-function
description: Use when asked to add, change or expose a function written in Python, Rust, Go or WebAssembly in an application that uses TotalFusion, as an action, an API route, an MCP tool, a stream or a Flow node.
---

# Add a function to an application that uses TotalFusion

1. **Pick the runtime.** Python for libraries and models (`docs/python.md`), Rust or Go for CPU work and many calls at once (`docs/rust.md`, `docs/go.md`), WebAssembly for code that must run in a sandbox (`docs/webassembly.md`).
2. **Write the function with its contract.** The contract is what makes it an action; without one it is callable from JavaScript but private.
   - Python: `@action(summary='...', input='*text:String // The text', output='label:String', mcp=True)` on `def name(data)`; the folder is `python/`.
   - Rust: `.function("module.name", |call| ...)` followed by `.summary().input().output().mcp(true)`.
   - Go: `app.Function("module.name", func(call *totalfusion.Call) (any, error) {...}).Summary().Input().MCP(true)`.
   - Input and output use the schema syntax of Total.js: `*` is required. **Never put a comma inside a `// comment`** of a schema: Total.js splits the fields on commas and declares a field that does not exist (`register()` warns).
3. **Errors.** A mistake of the caller is `ValueError` (Python), `Error::invalid` (Rust) or `Invalid` (Go): its message reaches the client. Any other failure answers "The action failed" and the detail goes to the log.
4. **Register it.** In a Total.js definition: `await REQUIRE('totalfusion').register({ python: { path: PATH.root('python') }, watch: DEBUG })`, then `ROUTE('API /api/ +module_name --> module/name')`. For Rust, Go and WebAssembly pass `runtime: 'go', go: { binary }` (or `wasm: { module }`). Outside Total.js: `fusion.configure({...})` and `await fusion.python('module.name', args)`.
5. **A stream** is a generator (Python) or a stream function (Rust, Go): read it with `fusion.stream()` or send it to the browser with `fusion.sse($, stream)`. It is not an action.
6. **MCP tools** only for the functions that say `mcp`, and only after deciding who can reach `/$mcp/`: it has no authentication by default.
7. **Routes:** a dot in a segment of the route looks like a file to Total.js and gets an empty reply: use `/x/module/name/`.
8. **The standard output of a worker carries the protocol.** Write to the error output.
9. **Check it:** `npx totalfusion doctor --path ./python` (or `--runtime rust|go|wasm` with `--binary` or `--module`), then make a real call and read the answer. Add a test that makes the call; before you trust it, break the function on purpose and see the test fail.

The same steps, with the real answers, are in `docs/tutorials/01-python-action-and-mcp.md`.
