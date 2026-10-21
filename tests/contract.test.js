'use strict';

const { test, describe, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const Path = require('path');
const Fs = require('fs');
const Os = require('os');
const { Fusion } = require('..');

const PATH = Path.join(__dirname, 'components');
const instances = [];

function create(options) {
	const fusion = new Fusion({ python: Object.assign({ path: PATH, forwardStderr: false }, options) });
	instances.push(fusion);
	return fusion;
}

afterEach(async function() {
	await Promise.all(instances.splice(0).map(fusion => fusion.shutdown()));
});

describe('describe', function() {

	test('reads the contracts declared with @action', async function() {
		const found = await create().describe('python');
		const count = found.actions.find(item => item.fn === 'contract.count');
		assert.deepEqual(count.meta, { summary: 'Counts the words', input: '*text:String // Text to analyze', output: 'words:Number', mcp: true, timeout: 5000 });
		assert.equal(count.doc, 'Counts the words of a text.');
		assert.equal(found.actions.find(item => item.fn === 'contract.double').async, true);
		assert.deepEqual(found.actions.find(item => item.fn === 'contract.bare').meta, {});
	});

	test('functions without @action are not described, private ones neither', async function() {
		const names = (await create().describe('python')).actions.map(item => item.fn);
		assert.ok(!names.includes('contract.undecorated'));
		assert.ok(!names.some(name => name.startsWith('sample.')));
	});

	test('finds the modules with a @startup hook', async function() {
		assert.deepEqual((await create().describe('python')).startups, ['contract']);
	});

	test('never imports the components', async function() {
		const found = await create({ path: Path.join(__dirname, 'static') }).describe('python');
		assert.deepEqual(found.actions.map(item => item.fn), ['heavy.classify']);
		assert.deepEqual(found.startups, ['heavy']);
	});

	test('arguments that are not literals are reported, not guessed', async function() {
		const found = await create({ path: Path.join(__dirname, 'static') }).describe('python');
		assert.equal(found.errors.length, 1);
		assert.equal(found.errors[0].function, 'not_literal');
	});

	test('a missing interpreter gives a clear error', async function() {
		await assert.rejects(() => create({ python: '/nonexistent/python' }).describe('python'), { code: 'SPAWN_FAILED' });
	});

});

describe('hooks', function() {

	test('@startup runs once per worker, not once per call', async function() {
		const fusion = create();
		await fusion.python('contract.count', { text: 'a b' });
		await fusion.python('contract.count', { text: 'a b' });
		const state = await fusion.python('contract.loaded');
		assert.equal(state.loaded, 1);
	});

	test('every worker runs its own @startup', async function() {
		const fusion = create({ workers: 2 });
		const pids = new Set((await Promise.all(Array.from({ length: 20 }, () => fusion.python('contract.loaded').then(state => (state.loaded === 1 ? state.pid : -1))))).filter(pid => pid > 0));
		assert.ok(pids.size >= 1);
	});

	test('preload loads the module before the worker is ready', async function() {
		const fusion = create({ preload: ['contract'] });
		const state = await fusion.python('contract.loaded');
		assert.equal(state.loaded, 1);
		assert.ok(state.pid > 0);
	});

	test('a component that cannot be preloaded fails to start with the real reason', async function() {
		const fusion = create({ preload: ['does_not_exist'] });
		await assert.rejects(() => fusion.python('sample.add', { a: 1, b: 1 }), function(err) {
			assert.equal(err.code, 'START_FAILED');
			assert.match(err.stderr, /cannot preload "does_not_exist"/);
			return true;
		});
	});

	test('@shutdown runs when the pool is shut down', async function() {
		const file = Path.join(Os.tmpdir(), 'totalfusion-shutdown-' + process.pid);
		Fs.rmSync(file, { force: true });
		const fusion = create({ env: Object.assign({}, process.env, { FUSION_TEST_SHUTDOWN_FILE: file }) });
		await fusion.python('contract.count', { text: 'a' });
		await fusion.shutdown();
		assert.equal(Fs.readFileSync(file, 'utf8'), 'bye');
		Fs.rmSync(file, { force: true });
	});

});
