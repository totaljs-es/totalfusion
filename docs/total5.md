# Total.js 5

TotalFusion is an extension of Total.js: the functions of a worker are registered as **actions**, so everything Total.js does with an action (validation, permissions, API routes, FlowStream, MCP) works with them. Nothing in the framework is modified.

```js
// definitions/fusion.js
const fusion = REQUIRE('totalfusion');

exports.install = function() {
	fusion.register({ python: { path: PATH.root('python'), workers: 2 } }).then(function(result) {
		console.log('TotalFusion:', result.ids.join(', '));
	});
};
```

`register` is asynchronous (it reads the contracts with a short Python process) and resolves with `{ ids, errors, warnings }`. `require('totalfusion')` works the same as `REQUIRE('totalfusion')`.

Every function decorated with `@action` becomes a `NEWACTION()` named `<module>/<function>` (change it with `prefix` or `@action(id=...)`). Because they are normal actions they work with `ACTION()` and `API` routes (`ROUTE('API /v1/ +count --> contract/count')`). `register` also adds the modules with `@startup` to `preload` automatically.

- **Validation first.** Total.js validates `input` with the contract before Python runs, so invalid data never reaches your function. Fields marked with `*` are required; an optional field with an invalid value is dropped by Total.js, not reported.
- **Query and params.** Declare them in the contract like the input: `@action(input='a:Number', query='*page:Number', params='id:UID')`. Python then receives an object with the sections that were declared, already validated and converted: `{ 'input': {'a': 5}, 'query': {'page': 2}, 'params': {'id': '...'} }`. Without `query` and `params` it receives the input alone, as before. `ACTION('x', input).query({...}).params({...})`, the `API` routes and the MCP tools (`arguments: { input, query, params }`) all fill them.
- **Who may call.** `permissions` (`'admin,editor'`: any of them), `user=True` (only a logged in user), `sa` and `su` go to `NEWACTION()` as they are, so Total.js decides before Python is reached and answers `401` otherwise. An administrator (`user.sa` or `user.su`) always passes. Python does not see the user: if a function needs to know who calls, pass what it needs in the input.
- **MCP is opt-in.** Only functions with `mcp=True` are exposed to agents (`CONF.$mcp = true` enables the endpoint). Everything else stays internal.
- **Errors.** A Python `ValueError` is treated as the caller's mistake and its message reaches the client. Any other exception returns `The action failed`, and the real error goes to `onerror` (default: `console.error`), so paths, queries or secrets inside exception messages are not leaked.
- **Generators.** A function that yields is a stream, not an action: `register` skips it with a warning. Call it with `fusion.stream()` or `fusion.sse()`.
- **Boot.** `fusion.register({ warmup: true })` loads the models before it resolves, and `preload: false` leaves the modules with `@startup` to load on their first call.
- **Schemas.** Total.js splits the fields of a schema on commas **even inside a `// comment`**, so `'*text:String // Text, up to 2000 chars'` declares a second field called `up to 2000 chars`. `register` returns a `warnings` list for it: use parentheses or a new line.
- **MCP.** Exposing an action as a tool uses the MCP router of Total.js 5 (`CONF.$mcp = true`). Actions and API routes work without it.

## FlowStream

TotalFusion has seven components for **Flow**: one for each runtime (Python, Rust, Go and WebAssembly) that calls a function with the data of each message, a **Stream** whose chunks are messages, **Events** that sends the events of the workers, and **Stats**. They use the same pool of workers as the rest of the application, and they were run in the designer of Flow 11.1. How to install and use them is in [Flow](flow.md).

## Server-Sent Events

A stream reaches the browser with `fusion.sse($, stream)`. See [Streaming](streaming.md#server-sent-events-from-a-totaljs-route).

## Reload while you develop

`fusion.register({ ..., watch: DEBUG })` replaces the workers and reads the contracts again when the code changes. See [Development](development.md).

## An application to start from

[examples/totaljs-app](../examples/totaljs-app) is a complete Total.js 5 application with Python: an action, an API route, Server-Sent Events and reload on edit. It was run with a real `npm install` of `total5`.
