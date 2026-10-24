'use strict';

// Runs in its own process (see wasm.test.js): the functions of a WebAssembly module as Total.js actions and MCP tools.

require(process.argv[2]);

const fusion = require('..');

CONF.$imprint = false;
F.console = NOOP;

function run(id, input) {
	const builder = ACTION(id, input).user({ sa: true, name: 'test' });
	let errors = null;
	builder.options.error = err => errors = err.output();
	return builder.promise().then(output => ({ ok: true, output }), () => ({ ok: false, errors }));
}

(async function() {

	const report = { logged: [] };

	report.registered = await fusion.register({ runtime: 'wasm', wasm: { module: process.argv[3], forwardStderr: false }, onerror: err => report.logged.push(err.code) });

	report.add = await run('math/add', { a: 2, b: 3 });
	report.addInvalid = await run('math/add', { a: 2 });
	report.length = await run('text/length', { text: 'héllo' });
	report.single = await run('single', null);

	await new Promise(resolve => setTimeout(resolve, 400));
	report.tools = Total.mcp ? Total.mcp.tools.map(tool => ({ name: tool.name, description: tool.description })) : null;

	await fusion.shutdown();
	console.log(JSON.stringify(report));
	process.exit(0);

})().catch(function(err) {
	console.error(err);
	process.exit(1);
});
