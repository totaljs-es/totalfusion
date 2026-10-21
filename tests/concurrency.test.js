'use strict';

const { test, describe, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const Path = require('path');
const { Fusion } = require('..');

const PATH = Path.join(__dirname, 'components');
const instances = [];

function create(options) {
	const fusion = new Fusion({ python: Object.assign({ path: PATH, forwardStderr: false }, options) });
	instances.push(fusion);
	return fusion;
}

async function collect(stream) {
	const items = [];
	for await (const item of stream)
		items.push(item);
	return items;
}

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

async function timed(fn) {
	const started = Date.now();
	const result = await fn();
	return [Date.now() - started, result];
}

afterEach(async function() {
	await Promise.all(instances.splice(0).map(fusion => fusion.shutdown()));
});

describe('calls at the same time in one worker', function() {

	test('by default a worker runs one call at a time', async function() {
		const fusion = create({ workers: 1 });
		await fusion.python('sample.pid');
		const [elapsed] = await timed(() => Promise.all([1, 2, 3].map(() => fusion.python('sample.sleep_async', { seconds: 0.2 }))));
		assert.ok(elapsed >= 550, 'they overlapped: ' + elapsed + ' ms');
	});

	test('async functions overlap', async function() {
		const fusion = create({ workers: 1, concurrency: 4 });
		await fusion.python('sample.pid');

		const calls = Promise.all(Array.from({ length: 4 }, () => fusion.python('sample.sleep_async', { seconds: 0.4 })));
		await wait(150);
		assert.equal(fusion.stats().python.running, 4);

		const started = Date.now();
		await calls;
		// serial: 1600 ms. They overlap if it is clearly less (150 ms were spent before)
		assert.ok(Date.now() - started + 150 < 1200, 'they did not overlap');
		assert.equal(fusion.stats().python.workers, 1);
		assert.equal(fusion.stats().python.running, 0);
	});

	test('sync functions overlap in threads', async function() {
		const fusion = create({ workers: 1, concurrency: 4 });
		await fusion.python('sample.pid');
		const [elapsed, pids] = await timed(() => Promise.all(Array.from({ length: 4 }, () => fusion.python('sample.slow_pid', { seconds: 0.4 }))));
		assert.ok(elapsed < 1200, 'they did not overlap: ' + elapsed + ' ms');
		assert.equal(new Set(pids).size, 1);
	});

	test('responses do not mix up', async function() {
		const fusion = create({ workers: 2, concurrency: 8 });
		const results = await Promise.all(Array.from({ length: 400 }, (_, i) => fusion.python('sample.echo', { i })));
		assert.deepEqual(results.map(item => item.i), Array.from({ length: 400 }, (_, i) => i));
	});

	test('the next call goes to the least loaded worker', async function() {
		const fusion = create({ workers: 3, concurrency: 2 });
		await fusion.warmup('python');
		const [elapsed, pids] = await timed(() => Promise.all(Array.from({ length: 6 }, () => fusion.python('sample.slow_pid', { seconds: 0.4 }))));
		assert.equal(new Set(pids).size, 3);
		// serial: 2400 ms
		assert.ok(elapsed < 1500, 'elapsed: ' + elapsed + ' ms');
		assert.deepEqual(fusion.stats().python.details.map(worker => worker.calls), [2, 2, 2]);
	});

	test('workers start only when the room of the existing ones is not enough', async function() {
		let fusion = create({ workers: 4, concurrency: 4 });
		await Promise.all(Array.from({ length: 4 }, () => fusion.python('sample.slow_pid', { seconds: 0.1 })));
		assert.equal(fusion.stats().python.workers, 1);

		fusion = create({ workers: 4, concurrency: 4 });
		await Promise.all(Array.from({ length: 5 }, () => fusion.python('sample.slow_pid', { seconds: 0.1 })));
		assert.equal(fusion.stats().python.workers, 2);
	});

	test('calls wait in the queue when every worker is full', async function() {
		const fusion = create({ workers: 1, concurrency: 2 });
		const [elapsed] = await timed(() => Promise.all(Array.from({ length: 4 }, () => fusion.python('sample.sleep_async', { seconds: 0.3 }))));
		// two at a time: at least two rounds of 300 ms. (Being fast is not what this proves, so there is no upper bound.)
		assert.ok(elapsed >= 550, 'elapsed: ' + elapsed + ' ms');
	});

});

describe('streams at the same time', function() {

	test('several streams share a worker and do not mix', async function() {
		const fusion = create({ workers: 1, concurrency: 4 });
		await fusion.python('sample.pid');
		const [elapsed, results] = await timed(() => Promise.all([0, 100, 200, 300].map(start => collect(fusion.stream('python', 'streams.numbers', { n: 5, start })))));
		assert.deepEqual(results, [[0, 1, 2, 3, 4], [100, 101, 102, 103, 104], [200, 201, 202, 203, 204], [300, 301, 302, 303, 304]]);
		assert.equal(fusion.stats().python.workers, 1);
	});

	test('streams that wait for their data overlap', async function() {
		const fusion = create({ workers: 1, concurrency: 4 });
		await fusion.python('sample.pid');
		const [elapsed, results] = await timed(() => Promise.all(Array.from({ length: 4 }, () => collect(fusion.stream('python', 'streams.ticks', { n: 3, delay: 0.15 })))));
		assert.ok(results.every(items => items.length === 3));
		// serial: 1800 ms
		assert.ok(elapsed < 1300, 'elapsed: ' + elapsed + ' ms');
	});

	test('a consumer that stops reading does not block the other calls of the worker', async function() {

		const fusion = create({ workers: 1, concurrency: 4 });

		// This one fills its window and waits for a reader that never comes
		const stalled = fusion.stream('python', 'streams.endless_async', null, { highWaterMark: 2, timeout: 0 });
		await stalled.next();
		await wait(200);

		assert.equal(await fusion.python('sample.add', { a: 1, b: 2 }), 3);
		assert.deepEqual(await collect(fusion.stream('python', 'streams.numbers', { n: 3 })), [0, 1, 2]);
		assert.equal(fusion.stats().python.running, 1);

		stalled.cancel();
	});

});

describe('timeouts and failures with several calls in a worker', function() {

	test('a call that can be cancelled does not hurt the ones next to it', async function() {

		const fusion = create({ workers: 1, concurrency: 3 });
		await fusion.python('sample.pid');
		const pid = fusion.stats().python.details[0].pid;

		const [slow, neighbour] = await Promise.allSettled([
			fusion.python('sample.sleep_async', { seconds: 5 }, { timeout: 150 }),
			fusion.python('sample.sleep_async', { seconds: 0.5 })
		]);

		assert.equal(slow.reason.code, 'TIMEOUT');
		assert.equal(neighbour.value, 'done');
		assert.equal(fusion.stats().python.details[0].pid, pid, 'the worker was replaced');
	});

	test('a call that cannot be cancelled costs the worker: the calls next to it fail', async function() {

		const fusion = create({ workers: 1, concurrency: 3, cancelGrace: 200 });
		await fusion.python('sample.pid');

		const [stuck, neighbour] = await Promise.allSettled([
			fusion.python('sample.sleep_sync', { seconds: 5 }, { timeout: 100 }),
			fusion.python('sample.sleep_sync', { seconds: 3 })
		]);

		assert.equal(stuck.reason.code, 'TIMEOUT');
		assert.equal(neighbour.reason.code, 'WORKER_CRASHED');

		// and the pool recovers
		assert.equal(await fusion.python('sample.add', { a: 1, b: 1 }), 2);
	});

	test('a crash rejects every call that the worker was running', async function() {
		const fusion = create({ workers: 1, concurrency: 3 });
		await fusion.python('sample.pid');
		const results = await Promise.allSettled([
			fusion.python('sample.sleep_async', { seconds: 2 }),
			fusion.python('sample.sleep_async', { seconds: 2 }),
			fusion.python('sample.crash')
		]);
		assert.deepEqual(results.map(result => result.reason.code), ['WORKER_CRASHED', 'WORKER_CRASHED', 'WORKER_CRASHED']);
		assert.equal(await fusion.python('sample.add', { a: 1, b: 1 }), 2);
	});

	test('a shutdown rejects every call that is running', async function() {
		const fusion = create({ workers: 1, concurrency: 3 });
		const calls = Promise.allSettled([1, 2, 3].map(() => fusion.python('sample.sleep_async', { seconds: 5 })));
		await wait(200);
		await fusion.shutdown();
		assert.deepEqual((await calls).map(result => result.reason.code), ['CLOSED', 'CLOSED', 'CLOSED']);
	});

});

describe('recycling with several calls in a worker', function() {

	test('a worker that is replaced finishes the calls it is running, and no call is lost', async function() {
		const fusion = create({ workers: 2, concurrency: 4, maxCalls: 7 });
		const results = await Promise.all(Array.from({ length: 300 }, (_, i) => fusion.python('sample.echo', { i })));
		assert.deepEqual(results.map(item => item.i), Array.from({ length: 300 }, (_, i) => i));
		assert.ok(fusion.stats().python.recycled.calls >= 1);
	});

	test('a worker waits for its slow call before it leaves', async function() {

		const fusion = create({ workers: 1, concurrency: 4, maxCalls: 3 });
		await fusion.python('sample.pid');

		// A slow call runs while the quick ones make the worker reach maxCalls
		const slow = fusion.python('sample.sleep_async', { seconds: 1 });
		for (let i = 0; i < 40; i++) {
			await fusion.python('sample.echo', { i });
			await wait(15);
		}

		assert.ok(fusion.stats().python.recycled.calls >= 1);
		assert.equal(await slow, 'done');
	});

});
