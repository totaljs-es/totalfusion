'use strict';

// Runs in its own process (see total5.test.js): Total.js 5 defines globals and timers
// that should not live inside the test runner. Prints a JSON report.

const Path = require('path');

process.env.FUSION_TEST_SHUTDOWN_FILE = process.argv[3];
require(process.argv[2]);

const fusion = require('..');

CONF.$imprint = false;
F.console = NOOP;

// options.user: the user of the call (default an administrator, null = nobody), options.query, options.params
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

	const report = {};

	report.registered = await fusion.register({ python: { path: Path.join(__dirname, 'components'), forwardStderr: false, env: process.env }, onerror: err => report.logged = err.code });

	report.count = await run('contract/count', { text: 'one two three four' });
	report.invalid = await run('contract/count', {});
	report.double = await run('contract/double', { value: 21 });
	report.explode = await run('contract/explode', { value: 1 });
	report.reject = await run('contract/reject', { value: 1 });
	report.bare = await run('contract/bare', null);
	report.loaded = await fusion.python('contract.loaded');

	// query and params reach Python validated by the contract
	const id = UID();
	report.sections = { id, result: await run('contract/sections', { a: '5' }, { query: { page: '2', term: 'x' }, params: { id } }) };
	report.sectionsInvalid = await run('contract/sections', { a: '5' }, { query: { page: 'abc' }, params: { id } });
	report.sectionsMissing = await run('contract/sections', { a: '5' }, { query: {}, params: { id } });
	report.sectionsBadId = await run('contract/sections', { a: '5' }, { query: { page: '1' }, params: { id: 'not an id' } });
	report.onlyQuery = await run('contract/only_query', null, { query: { limit: '10' } });

	// idempotent=True in the contract: the call is repeated when the worker dies
	const marker = require('path').join(require('os').tmpdir(), 'totalfusion-t5-flaky-' + process.pid);
	require('fs').rmSync(marker, { force: true });
	report.flaky = await run('flaky/contract_flaky', { marker });
	report.flakyAttempts = require('fs').statSync(marker).size;
	require('fs').rmSync(marker, { force: true });

	// who may call: the framework checks it before Python is reached
	report.restricted = {
		reader: await run('contract/restricted', { x: 1 }, { user: { permissions: ['reader'] } }),
		editor: await run('contract/restricted', { x: 1 }, { user: { permissions: ['editor'] } }),
		admin: await run('contract/restricted', { x: 1 }, { user: { permissions: ['admin'] } }),
		superadmin: await run('contract/restricted', { x: 1 }, { user: { sa: true } }),
		nobody: await run('contract/restricted', { x: 1 }, { user: null })
	};

	report.members = { nobody: await run('contract/members', null, { user: null }), user: await run('contract/members', null, { user: { id: 1 } }) };

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
