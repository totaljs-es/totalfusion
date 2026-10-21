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
		assert.equal(found.actions.find(item => item.fn === 'contract.count_up').stream, true);
		assert.equal(found.actions.find(item => item.fn === 'contract.count').stream, false);
		assert.equal(found.actions.find(item => item.fn === 'contract.double').stream, false);
	});

	test('functions without @action are not described, private ones neither', async function() {
		const names = (await create().describe('python')).actions.map(item => item.fn);
		assert.ok(!names.includes('contract.undecorated'));
		assert.ok(!names.some(name => name.startsWith('sample.')));
	});

	test('finds the modules with a @startup hook', async function() {
		assert.deepEqual((await create().describe('python')).startups, ['contract', 'slow']);
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

describe('lint', function() {

	const { lint } = require('../total5');

	test('warns about a comma inside a // comment, which Total.js reads as a new field', function() {
		assert.equal(lint('a/b', { input: '*text:String // Text, up to 2000 chars' }).length, 1);
		assert.equal(lint('a/b', { output: 'x:Number // one\ny:Number // two, three' }).length, 1);
	});

	test('accepts parentheses, new lines and plain commas between fields', function() {
		assert.deepEqual(lint('a/b', { input: '*text:String // Text (up to 2000 chars)' }), []);
		assert.deepEqual(lint('a/b', { input: 'a:String // one\nb:Number // two' }), []);
		assert.deepEqual(lint('a/b', { input: 'a:String,b:Number' }), []);
		assert.deepEqual(lint('a/b', {}), []);
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

	test('without preload the model load counts against the first call, with preload it does not', async function() {

		const lazy = create({ timeout: 300 });
		await assert.rejects(() => lazy.python('slow.add_one', { a: 1 }), { code: 'TIMEOUT' });

		const preloaded = create({ timeout: 300, preload: ['slow'] });
		assert.equal(await preloaded.python('slow.add_one', { a: 1 }), 2);
	});

	test('warmup starts every worker and waits until the models are loaded', async function() {
		const fusion = create({ workers: 2, preload: ['slow'] });
		const started = Date.now();
		await fusion.warmup('python');
		assert.ok(Date.now() - started >= 700);
		assert.equal(fusion.stats().python.ready, 2);
		const call = Date.now();
		assert.equal(await fusion.python('slow.add_one', { a: 1 }), 2);
		// the model takes 800 ms to load: the call must not wait for it
		assert.ok(Date.now() - call < 600);
	});

	test('warmup rejects with the real reason when a worker cannot start', async function() {
		const fusion = create({ preload: ['does_not_exist'] });
		await assert.rejects(() => fusion.warmup('python'), { code: 'START_FAILED' });
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
