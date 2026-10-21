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

	const events = [];
	for (const name of ['worker:ready', 'worker:exit', 'worker:recycle', 'worker:unresponsive', 'reload'])
		fusion.on(name, data => events.push([name, data]));

	events.of = name => events.filter(event => event[0] === name).map(event => event[1]);
	return [fusion, events];
}

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

async function until(check, ms) {
	const limit = Date.now() + ms;
	while (Date.now() < limit) {
		if (await check())
			return true;
		await wait(25);
	}
	return false;
}

afterEach(async function() {
	await Promise.all(instances.splice(0).map(fusion => fusion.shutdown()));
});

describe('events', function() {

	test('a worker that starts says so, with the runtime, its pid and how long it took', async function() {
		const [fusion, events] = create();
		await fusion.python('sample.pid');
		const ready = events.of('worker:ready');
		assert.equal(ready.length, 1);
		assert.equal(ready[0].runtime, 'python');
		assert.ok(ready[0].pid > 0);
		assert.ok(ready[0].startedIn >= 0);
	});

	test('a crash is an exit with the reason "crash"', async function() {
		const [fusion, events] = create();
		const pid = await fusion.python('sample.pid');
		await assert.rejects(() => fusion.python('sample.crash'), { code: 'WORKER_CRASHED' });
		assert.ok(await until(() => events.of('worker:exit').length === 1, 3000));
		const exit = events.of('worker:exit')[0];
		assert.equal(exit.pid, pid);
		assert.equal(exit.reason, 'crash');
		assert.equal(exit.code, 3);
		assert.equal(exit.running, 1);
	});

	test('a worker that is replaced says why, and leaves as "recycled"', async function() {
		const [fusion, events] = create({ maxCalls: 3 });
		for (let i = 0; i < 40; i++) {
			await fusion.python('sample.pid');
			await wait(10);
		}
		assert.ok(await until(() => events.of('worker:exit').some(exit => exit.reason === 'recycled'), 3000));
		const recycle = events.of('worker:recycle')[0];
		assert.equal(recycle.reason, 'calls');
		assert.ok(recycle.calls >= 3);
		assert.equal(events.of('worker:exit').find(exit => exit.reason === 'recycled').pid, recycle.pid);
	});

	test('a worker that does not answer: unresponsive, then an exit with that reason', async function() {
		const [fusion, events] = create({ healthInterval: 100, healthTimeout: 300 });
		await fusion.python('sample.pid');
		const pid = fusion.stats().python.details[0].pid;
		await fusion.python('health.wedge');
		assert.ok(await until(() => events.of('worker:exit').some(exit => exit.reason === 'unresponsive'), 5000));
		assert.equal(events.of('worker:unresponsive')[0].pid, pid);
	});

	test('closing the pool: every worker leaves as "shutdown"', async function() {
		const [fusion, events] = create({ workers: 2 });
		await fusion.warmup('python');
		await fusion.shutdown();
		const exits = events.of('worker:exit');
		assert.equal(exits.length, 2);
		assert.ok(exits.every(exit => exit.reason === 'shutdown'));
	});

	test('a worker that never starts leaves as "start-failed"', async function() {
		const [fusion, events] = create({ preload: ['does_not_exist'] });
		await assert.rejects(() => fusion.python('sample.add', { a: 1, b: 1 }), { code: 'START_FAILED' });
		assert.ok(events.of('worker:exit').length >= 3);
		assert.ok(events.of('worker:exit').every(exit => exit.reason === 'start-failed'));
		assert.equal(events.of('worker:ready').length, 0);
	});

	test('a reload of the code is an event', async function() {
		const directory = Fs.mkdtempSync(Path.join(Os.tmpdir(), 'totalfusion-events-'));
		Fs.writeFileSync(Path.join(directory, 'thing.py'), 'def value(data):\n    return 1\n');
		const [fusion, events] = create({ path: directory });
		const handle = fusion.watch('python', { debounce: 50, log: false });
		await fusion.python('thing.value');
		Fs.writeFileSync(Path.join(directory, 'thing.py'), 'def value(data):\n    return 22\n');
		assert.ok(await until(() => events.of('reload').length === 1, 4000));
		assert.deepEqual(events.of('reload')[0], { runtime: 'python', files: ['thing.py'], replaced: 1 });
		assert.ok(await until(() => events.of('worker:recycle').some(event => event.reason === 'reload'), 3000));
		handle.close();
	});

	test('a listener that throws does not break the pool', async function() {
		const [fusion] = create();
		fusion.on('worker:ready', () => {
			throw new Error('my listener is broken');
		});

		const warnings = [];
		const listener = warning => warnings.push(warning);
		process.on('warning', listener);

		assert.equal(await fusion.python('sample.add', { a: 1, b: 2 }), 3);
		await wait(50);
		process.off('warning', listener);

		assert.ok(warnings.some(warning => /my listener is broken/.test(warning.message)));
	});

	test('works for Rust workers too', { skip: require('./rust-build').skip() }, async function() {
		const build = require('./rust-build');
		const fusion = new Fusion({ rust: { binary: build(), forwardStderr: false } });
		instances.push(fusion);
		const events = [];
		fusion.on('worker:ready', data => events.push(['ready', data]));
		fusion.on('worker:exit', data => events.push(['exit', data]));

		await fusion.rust('pid');
		await assert.rejects(() => fusion.rust('crash'), { code: 'WORKER_CRASHED' });
		assert.ok(await until(() => events.some(event => event[0] === 'exit'), 3000));
		assert.equal(events[0][1].runtime, 'rust');
		assert.equal(events.find(event => event[0] === 'exit')[1].reason, 'crash');
	});

});
