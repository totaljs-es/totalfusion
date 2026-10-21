'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const Path = require('path');
const Fs = require('fs');
const Os = require('os');
const { spawnSync } = require('child_process');

const locate = require('./locate-total5');

const total5 = locate();

test('registers @action functions as Total.js 5 actions and MCP tools', { skip: total5 ? false : 'Total.js 5 not found (set TOTAL5_PATH)' }, function() {

	const file = Path.join(Os.tmpdir(), 'totalfusion-t5-' + process.pid);
	Fs.rmSync(file, { force: true });

	const result = spawnSync(process.execPath, [Path.join(__dirname, 'total5-script.js'), total5, file], { timeout: 60000, cwd: Os.tmpdir() });
	assert.equal(result.status, 0, result.stderr.toString());

	const report = JSON.parse(result.stdout.toString().trim().split('\n').pop());

	assert.deepEqual(report.registered.ids.sort(), ['contract/bare', 'contract/count', 'contract/double', 'contract/explode', 'contract/members', 'contract/only_query', 'contract/reject', 'contract/restricted', 'contract/sections', 'slow/add_one']);
	assert.deepEqual(report.registered.errors, []);
	// A generator is a stream, not an action: it is skipped with a warning
	assert.equal(report.registered.warnings.length, 1);
	assert.equal(report.registered.warnings[0].id, 'contract/count_up');
	assert.match(report.registered.warnings[0].message, /fusion\.stream/);

	// Python runs behind the action and the result is returned as is
	assert.deepEqual(report.count, { ok: true, output: { words: 4 } });
	assert.deepEqual(report.double, { ok: true, output: 42 });
	assert.deepEqual(report.bare, { ok: true, output: 'bare' });

	// Total.js validates the input with the contract before Python is called
	assert.equal(report.invalid.ok, false);
	assert.equal(report.invalid.errors[0].path, 'text');

	// A ValueError is the caller's mistake and keeps its message. Anything else is hidden from the client but logged.
	assert.deepEqual(report.reject, { ok: false, errors: [{ error: 'value is not acceptable' }] });
	assert.deepEqual(report.explode, { ok: false, errors: [{ error: 'The action failed' }] });
	assert.equal(report.logged, 'REMOTE_ERROR');

	// query and params arrive in Python validated and converted by the contract, next to the input
	assert.deepEqual(report.sections.result, { ok: true, output: { input: { a: 5 }, query: { page: 2, term: 'x' }, params: { id: report.sections.id } } });
	assert.equal(report.sectionsInvalid.ok, false);
	assert.equal(report.sectionsInvalid.errors[0].name, 'query.page');
	assert.equal(report.sectionsMissing.errors[0].name, 'query.page');
	assert.equal(report.sectionsBadId.errors[0].name, 'params.id');

	// only what the contract declares is sent: no `input` key without an input
	assert.deepEqual(report.onlyQuery, { ok: true, output: { query: { limit: 10 } } });

	// permissions are checked by Total.js: any of the listed ones is enough, an administrator always passes
	assert.equal(report.restricted.reader.ok, false);
	assert.equal(report.restricted.nobody.ok, false);
	assert.deepEqual(report.restricted.editor, { ok: true, output: 'allowed' });
	assert.deepEqual(report.restricted.admin, { ok: true, output: 'allowed' });
	assert.deepEqual(report.restricted.superadmin, { ok: true, output: 'allowed' });

	// user=True: only a logged in user
	assert.equal(report.members.nobody.ok, false);
	assert.deepEqual(report.members.user, { ok: true, output: 'member' });

	// @startup ran once, in the worker
	assert.equal(report.loaded.loaded, 1);

	// Only functions with mcp=True are exposed to agents
	assert.equal(report.actions['contract/count'].mcp, true);
	assert.equal(report.actions['contract/double'].mcp, false);

	if (report.tools) {
		assert.deepEqual(report.tools.map(tool => tool.name).sort(), ['contract_count', 'contract_sections']);

		// the sections of the contract are announced to the agent
		const sections = report.tools.find(tool => tool.name === 'contract_sections').inputSchema;
		assert.deepEqual(Object.keys(sections.properties), ['input', 'query', 'params']);
		assert.deepEqual(sections.properties.query.required, ['page']);
		assert.equal(report.tools[0].description, 'Counts the words');
		assert.equal(report.tools[0].inputSchema.properties.input.properties.text.description, 'Text to analyze');
		assert.deepEqual(report.tools[0].inputSchema.properties.input.required, ['text']);
	}

	// @shutdown ran when the pool closed
	assert.equal(Fs.readFileSync(file, 'utf8'), 'bye');
	Fs.rmSync(file, { force: true });
});

test('streams Python generators to the browser as Server-Sent Events', { skip: total5 ? false : 'Total.js 5 not found (set TOTAL5_PATH)' }, function() {

	const port = 8300 + (process.pid % 500);
	const result = spawnSync(process.execPath, [Path.join(__dirname, 'sse-script.js'), total5, String(port)], { timeout: 60000, cwd: Os.tmpdir() });
	assert.equal(result.status, 0, result.stderr.toString());

	const report = JSON.parse(result.stdout.toString().trim().split('\n').pop());

	assert.match(report.ticks.type, /text\/event-stream/);
	assert.equal(report.ticks.cache, 'no-cache');
	assert.deepEqual(report.ticks.got.map(event => event.text), ['data: {"tick":0}', 'data: {"tick":1}', 'data: {"tick":2}', 'data: {"tick":3}', 'event: end\ndata: {}']);

	// they arrive while the generator runs, not all at the end
	assert.ok(report.ticks.got[3].at - report.ticks.got[0].at >= 300);

	// chunks before a failure, then an error event. Only a ValueError shows its message
	assert.deepEqual(report.fails.got.map(event => event.text), ['data: 1', 'data: 2', 'event: error\ndata: {"message":"boom after two chunks"}']);

	// A function that is not a generator is a stream of one chunk, and its RuntimeError stays hidden
	assert.deepEqual(report.secret.got.map(event => event.text), ['event: error\ndata: {"message":"The stream failed"}']);

	// The browser left after 3 events: the generator was cancelled in Python
	assert.equal(report.endless.got.length, 3);
	assert.equal(report.closed, true);
});

test('the Flow component calls a Python function with the message', { skip: total5 && Fs.existsSync(Path.join(total5, 'flow-test.js')) ? false : 'The test harness of Flow (flow-test.js) was not found' }, function() {

	const result = spawnSync(process.execPath, [Path.join(__dirname, 'flow-script.js'), total5], { timeout: 60000, cwd: Os.tmpdir() });
	assert.equal(result.status, 0, result.stderr.toString() + result.stdout.toString().slice(-500));

	const report = JSON.parse(result.stdout.toString().trim().split('\n').pop());

	// the data of the message is the argument, the result goes out through the first output
	assert.deepEqual(report.results[0], { words: 3 });

	// a failure of Python goes out through the error output, without the traceback
	assert.equal(report.results[1].code, 'REMOTE_ERROR');
	assert.match(report.results[1].message, /^RuntimeError: /);
	assert.ok(!report.results[1].message.includes('Traceback'));

	// no function configured
	assert.equal(report.results[2].code, 'NO_FUNCTION');
	assert.equal(report.results.length, 3);
});
