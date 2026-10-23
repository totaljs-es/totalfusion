'use strict';

// Runs in its own process (see go.test.js): the functions of a Go worker as Total.js actions and MCP tools.

require(process.argv[2]);

const fusion = require('..');

CONF.$imprint = false;
F.console = NOOP;

function run(id, input, options) {

	if (!options)
		options = {};

	const builder = ACTION(id, input);

	if (options.user !== null)
		builder.user(options.user === undefined ? { sa: true, name: 'test' } : options.user);

	if (options.query)
		builder.query(options.query);

	if (options.params)
		builder.params(options.params);

	let errors = null;
	builder.options.error = err => errors = err.output();
	return builder.promise().then(output => ({ ok: true, output }), () => ({ ok: false, errors }));
}

(async function() {

	const report = { logged: [] };

	report.registered = await fusion.register({ runtime: 'go', go: { binary: process.argv[3], forwardStderr: false }, onerror: err => report.logged.push(err.code) });

	report.add = await run('math/add', { a: 2, b: 3 });
	report.addInvalid = await run('math/add', { a: 2 });
	report.length = await run('text/length', { text: 'héllo' });
	report.single = await run('single', null);

	// a failure of the worker: only the message of totalfusion.Invalid reaches the client
	report.fails = await run('actions/fails', null);
	report.rejects = await run('actions/rejects', null);

	const id = UID();
	report.sections = { id, result: await run('sections', { a: '5' }, { query: { page: '2' }, params: { id } }) };
	report.sectionsInvalid = await run('sections', { a: '5' }, { query: {}, params: { id } });

	report.restricted = {
		reader: await run('restricted', null, { user: { permissions: ['reader'] } }),
		editor: await run('restricted', null, { user: { permissions: ['editor'] } }),
		nobody: await run('restricted', null, { user: null })
	};

	await new Promise(resolve => setTimeout(resolve, 400));
	report.tools = Total.mcp ? Total.mcp.tools.map(tool => ({ name: tool.name, description: tool.description, inputSchema: tool.inputSchema })) : null;

	await fusion.shutdown();
	console.log(JSON.stringify(report));
	process.exit(0);

})().catch(function(err) {
	console.error(err);
	process.exit(1);
});
