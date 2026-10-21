'use strict';

const { test, describe, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const Path = require('path');
const Fs = require('fs');
const Os = require('os');
const build = require('./rust-build');
const { Fusion } = require('..');

const PATH = Path.join(__dirname, 'components');
const instances = [];
let counter = 0;

function marker() {
	const file = Path.join(Os.tmpdir(), 'totalfusion-retry-' + process.pid + '-' + (++counter));
	Fs.rmSync(file, { force: true });
	return file;
}

function create(options) {
	const fusion = new Fusion({ python: Object.assign({ path: PATH, forwardStderr: false }, options) });
	instances.push(fusion);
	return fusion;
}

const attempts = file => Fs.existsSync(file) ? Fs.statSync(file).size : 0;
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

afterEach(async function() {
	await Promise.all(instances.splice(0).map(fusion => fusion.shutdown()));
});

describe('a call is never repeated unless it is declared idempotent', function() {

	test('by default a worker that dies fails the call, which ran once', async function() {
		const fusion = create();
		const file = marker();
		await assert.rejects(() => fusion.python('flaky.crash_first', { marker: file }), { code: 'WORKER_CRASHED' });
		assert.equal(attempts(file), 1);
	});

	test('idempotent: the call is repeated on another worker and succeeds', async function() {
		const fusion = create();
		const file = marker();
		const retries = [];
		fusion.on('call:retry', data => retries.push(data));

		assert.equal(await fusion.python('flaky.crash_first', { marker: file }, { idempotent: true }), 'ok');
		assert.equal(attempts(file), 2);
		assert.equal(retries.length, 1);
		assert.deepEqual([retries[0].runtime, retries[0].fn, retries[0].attempt, retries[0].retries], ['python', 'flaky.crash_first', 1, 1]);
	});

	test('it is repeated as many times as asked and then fails', async function() {
		const fusion = create();
		const file = marker();
		await assert.rejects(() => fusion.python('flaky.crash_always', { marker: file }, { idempotent: true, retries: 2 }), { code: 'WORKER_CRASHED' });
		assert.equal(attempts(file), 3);
	});

	test('retries: 0 turns it off', async function() {
		const fusion = create();
		const file = marker();
		await assert.rejects(() => fusion.python('flaky.crash_always', { marker: file }, { idempotent: true, retries: 0 }), { code: 'WORKER_CRASHED' });
		assert.equal(attempts(file), 1);
	});

	test('an error of the function itself is not repeated', async function() {
		const fusion = create();
		const file = marker();
		await assert.rejects(() => fusion.python('flaky.fails', { marker: file }, { idempotent: true }), { code: 'REMOTE_ERROR' });
		assert.equal(attempts(file), 1);
	});

	test('a call that timed out is not repeated', async function() {
		const fusion = create({ cancelGrace: 200 });
		const file = marker();
		await assert.rejects(() => fusion.python('flaky.hangs', { marker: file }, { idempotent: true, timeout: 150 }), { code: 'TIMEOUT' });
		await wait(500);
		assert.equal(attempts(file), 1);
	});

	test('a stream is never repeated', async function() {
		const fusion = create();
		await assert.rejects(async () => {
			for await (const item of fusion.stream('python', 'streams.crash_midway', null, { idempotent: true })) {}
		}, { code: 'WORKER_CRASHED' });
	});

	test('the neighbours of a worker that had to be killed are repeated, if they allow it', async function() {

		// One worker: the three calls share the process that is going to be killed
		const fusion = create({ workers: 1, concurrency: 3, cancelGrace: 200 });
		await fusion.warmup('python');
		const pid = fusion.stats().python.details[0].pid;

		// The first one cannot be cancelled and takes the worker with it. The two next to it were running on that worker.
		const stuck = fusion.python('sample.sleep_sync', { seconds: 5 }, { timeout: 100 });
		const careful = fusion.python('sample.slow_pid', { seconds: 0.6 }, { idempotent: true });
		const plain = fusion.python('sample.slow_pid', { seconds: 0.6 });

		const [a, b, c] = await Promise.allSettled([stuck, careful, plain]);
		assert.equal(a.reason.code, 'TIMEOUT');
		assert.equal(c.reason && c.reason.code, 'WORKER_CRASHED');
		assert.equal(b.status, 'fulfilled', 'the idempotent call was not repeated');

		// and it ran again on a worker that is not the one that was killed
		assert.notEqual(b.value, pid);
	});

	test('a pool that closes does not repeat anything', async function() {
		const fusion = create();
		const file = marker();
		const outcome = assert.rejects(fusion.python('flaky.hangs', { marker: file }, { idempotent: true, timeout: 0 }), { code: 'CLOSED' });
		await wait(300);
		await fusion.shutdown();
		await outcome;
		assert.equal(attempts(file), 1);
	});

});

describe('rust', { skip: build.skip() }, function() {

	test('an idempotent call is repeated when the worker dies', async function() {
		const fusion = new Fusion({ rust: { binary: build(), forwardStderr: false } });
		instances.push(fusion);
		const file = marker();

		await assert.rejects(() => fusion.rust('flaky.crash_first', { marker: file }), { code: 'WORKER_CRASHED' });
		Fs.rmSync(file, { force: true });

		assert.equal(await fusion.rust('flaky.crash_first', { marker: file }, { idempotent: true }), 'ok');
		assert.equal(attempts(file), 2);
		assert.equal(await fusion.rust('flaky.counted', { marker: file }), 2);
	});

});
