'use strict';

const { test, describe, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const Path = require('path');
const { spawnSync } = require('child_process');
const { Fusion } = require('..');

const PATH = Path.join(__dirname, 'components');
const instances = [];

function create(options) {
	const fusion = new Fusion({ python: Object.assign({ path: PATH, forwardStderr: false }, options) });
	instances.push(fusion);
	return fusion;
}

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

async function until(check, ms) {
	const limit = Date.now() + ms;
	while (Date.now() < limit) {
		const value = await check();
		if (value)
			return value;
		await wait(25);
	}
	return false;
}

function alive(pid) {
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
}

afterEach(async function() {
	await Promise.all(instances.splice(0).map(fusion => fusion.shutdown()));
});

describe('recycling by calls', function() {

	test('a worker is replaced after maxCalls and nothing fails', async function() {

		const fusion = create({ maxCalls: 5 });
		const pids = new Set();

		for (let i = 0; i < 60; i++) {
			pids.add(await fusion.python('health.pid'));
			await wait(10);
		}

		assert.ok(pids.size >= 2, 'the worker was never replaced');
		assert.ok(fusion.stats().python.recycled.calls >= 1);
	});

	test('the old worker leaves and its process ends', async function() {
		const fusion = create({ maxCalls: 3 });
		const first = await fusion.python('health.pid');
		for (let i = 0; i < 40; i++) {
			await fusion.python('health.pid');
			await wait(10);
		}
		assert.ok(await until(() => !alive(first), 5000), 'the old worker is still running');
	});

	test('no call is lost while workers are being replaced', async function() {
		const fusion = create({ workers: 2, maxCalls: 7 });
		const results = await Promise.all(Array.from({ length: 300 }, (_, i) => fusion.python('health.echo', { i })));
		assert.deepEqual(results.map(item => item.i), Array.from({ length: 300 }, (_, i) => i));
		assert.ok(fusion.stats().python.recycled.calls >= 1);
	});

	test('the old worker keeps serving until the replacement is ready: a slow model load is not felt', async function() {

		// slow.py loads for 0.8 s in @startup. The calls must never wait for it.
		const fusion = create({ maxCalls: 3, preload: ['slow'], startTimeout: 10000 });
		await fusion.warmup('python');

		const first = fusion.stats().python.details[0].pid;
		let slowest = 0;
		const deadline = Date.now() + 2500;

		while (Date.now() < deadline) {
			const started = Date.now();
			assert.equal(await fusion.python('slow.add_one', { a: 1 }), 2);
			slowest = Math.max(slowest, Date.now() - started);
			await wait(20);
		}

		// the replacement takes 800 ms to load its model: no call may wait for that
		assert.ok(slowest < 600, 'a call waited ' + slowest + ' ms');
		assert.ok(fusion.stats().python.recycled.calls >= 1);

		// The first worker was replaced and is gone
		assert.ok(!fusion.stats().python.details.some(worker => worker.pid === first), 'the first worker is still in the pool');
		assert.ok(await until(() => !alive(first), 3000));
	});

	test('a replacement that cannot start does not break the worker it replaces', async function() {

		// The first worker starts. The next ones cannot (the interpreter no longer exists).
		const fusion = create({ workers: 1, maxCalls: 2 });
		const pid = await fusion.python('health.pid');
		fusion.pools.get('python').spawn = () => require('child_process').spawn('/nonexistent/python', []);

		// With calls waiting in the queue: none of them may fail because the replacement did
		for (let round = 0; round < 3; round++) {
			const results = await Promise.all(Array.from({ length: 10 }, () => fusion.python('health.pid')));
			assert.deepEqual(new Set(results), new Set([pid]));
		}

		const details = fusion.stats().python.details;
		assert.equal(details.length, 1);
		assert.equal(details[0].pid, pid);
		assert.equal(details[0].recycling, false);
	});

});

describe('recycling by memory', function() {

	test('a worker that grows over maxMemory is replaced', async function() {

		const fusion = create({ maxMemory: '150mb' });
		const first = await fusion.python('health.pid');

		assert.equal(await fusion.python('health.leak', { mb: 200 }), 1);

		const changed = await until(async () => await fusion.python('health.pid') !== first, 8000);
		assert.ok(changed, 'the worker was not replaced');
		assert.equal(fusion.stats().python.recycled.memory, 1);

		// The new worker starts clean
		assert.equal(await fusion.python('health.held'), 0);
	});

	test('the memory of every worker is reported', { skip: ['darwin', 'linux', 'win32'].includes(process.platform) ? false : 'memory is not reported on this platform' }, async function() {
		const fusion = create();
		await fusion.python('health.pid');
		const worker = fusion.stats().python.details[0];
		assert.ok(worker.pid > 0);
		assert.equal(worker.calls, 1);
		assert.ok(worker.memory > 1024 * 1024, 'memory: ' + worker.memory);
	});

	test('maxMemory warns once when the platform cannot report memory', async function() {

		const fusion = create({ maxMemory: '1gb' });
		await fusion.python('health.pid');

		const warnings = [];
		const listener = warning => warnings.push(warning);
		process.on('warning', listener);

		// What a worker on such a platform answers: memory null
		const pool = fusion.pools.get('python');
		const worker = pool.workers[0];
		pool.measure(worker, null);
		pool.measure(worker, null);
		await wait(50);
		process.off('warning', listener);

		assert.equal(warnings.filter(warning => warning.name === 'TotalFusionWarning').length, 1);
		assert.equal(fusion.stats().python.recycled.memory, 0);
	});

	test('an invalid size is a clear error', async function() {
		await assert.rejects(() => create({ maxMemory: 'lots' }).python('health.pid'), { code: 'INVALID_CONFIG' });
	});

	test('sizes can be written with units', async function() {
		for (const value of ['512mb', '1gb', '1.5GB', 2048, '100 kb'])
			assert.ok(await create({ maxMemory: value }).python('health.pid') > 0);
	});

});

describe('health', function() {

	test('an idle worker that stops answering is replaced', async function() {

		const fusion = create({ healthInterval: 150, healthTimeout: 300 });
		const wedged = await fusion.python('health.pid');

		assert.equal(await fusion.python('health.wedge'), 'ok');
		assert.ok(await until(() => fusion.stats().python.unresponsive >= 1, 4000), 'it was not detected');
		assert.ok(await until(() => !alive(wedged), 3000), 'the process is still running');

		const started = Date.now();
		const pid = await fusion.python('health.pid');
		assert.notEqual(pid, wedged);
		assert.ok(Date.now() - started < 3000);
	});

	test('a call is never given to a worker that was just killed, before its exit is noticed', async function() {

		const fusion = create({ healthInterval: 0 });
		const dying = await fusion.python('health.pid');
		const pool = fusion.pools.get('python');

		// What the health check does: the kill is sent and the exit arrives later, and on Windows later is a while
		pool.killWorker(pool.workers[0]);

		const pid = await fusion.python('health.pid');
		assert.notEqual(pid, dying);
	});

	test('a call waiting for the replacement of a killed idle worker keeps the process alive', function() {

		// Alone in a process: the test runner would keep it alive and hide the problem
		const result = spawnSync(process.execPath, [Path.join(__dirname, 'killed-script.js')], { encoding: 'utf8', timeout: 30000 });
		assert.equal(result.stdout.trim(), 'OK', result.stdout + result.stderr);
	});

	test('a healthy idle worker is left alone', async function() {
		const fusion = create({ healthInterval: 100, healthTimeout: 500 });
		const pid = await fusion.python('health.pid');
		await wait(1200);
		assert.equal(fusion.stats().python.unresponsive, 0);
		assert.equal(await fusion.python('health.pid'), pid);
	});

	test('a busy worker is never killed by the health check, even if it cannot answer', async function() {
		const fusion = create({ healthInterval: 100, healthTimeout: 200 });
		const pid = await fusion.python('health.pid');
		assert.equal(await fusion.python('health.block', { seconds: 1 }), 'done');
		assert.equal(await fusion.python('health.pid'), pid);
		assert.equal(fusion.stats().python.unresponsive, 0);
	});

	test('the health check can be turned off', async function() {
		const fusion = create({ healthInterval: 0 });
		const pid = await fusion.python('health.pid');
		await fusion.python('health.wedge');
		await wait(600);
		assert.equal(fusion.stats().python.unresponsive, 0);
		assert.ok(alive(pid));
	});

});
