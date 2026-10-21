'use strict';

// Runs in its own process (see total5.test.js): Total.js 5 defines globals and timers
// that should not live inside the test runner. Prints a JSON report.

const Path = require('path');

process.env.FUSION_TEST_SHUTDOWN_FILE = process.argv[3];
require(process.argv[2]);

const fusion = require('..');

CONF.$imprint = false;
F.console = NOOP;

function run(id, input) {
	const builder = ACTION(id, input);
	builder.user({ sa: true, name: 'test' });
	let errors = null;
	builder.options.error = err => errors = err.output();
	return builder.promise().then(output => ({ ok: true, output }), () => ({ ok: false, errors }));
}

(async function() {

	const report = {};

	report.registered = await fusion.register({ python: { path: Path.join(__dirname, 'components'), forwardStderr: false, env: process.env }, onerror: err => report.logged = err.code });

	report.count = await run('contract/count', { text: 'one two three four' });
	report.invalid = await run('contract/count', {});
	report.double = await run('contract/double', { value: 21 });
	report.explode = await run('contract/explode', { value: 1 });
	report.reject = await run('contract/reject', { value: 1 });
	report.bare = await run('contract/bare', null);
	report.loaded = await fusion.python('contract.loaded');

	await new Promise(resolve => setTimeout(resolve, 400));

	report.actions = {};

	for (const id of ['contract/count', 'contract/double', 'contract/bare', 'contract/explode'])
		report.actions[id] = { mcp: F.actions[id].mcp, summary: F.actions[id].summary };

	report.tools = Total.mcp ? Total.mcp.tools.map(tool => ({ name: tool.name, description: tool.description, inputSchema: tool.inputSchema })) : null;

	await fusion.shutdown();
	console.log(JSON.stringify(report));
	process.exit(0);

})().catch(function(err) {
	console.error(err);
	process.exit(1);
});
