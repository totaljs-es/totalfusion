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

async function collect(stream) {
	const items = [];
	for await (const item of stream)
		items.push(item);
	return items;
}

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

afterEach(async function() {
	await Promise.all(instances.splice(0).map(fusion => fusion.shutdown()));
});

describe('streams', function() {

	test('a sync generator becomes an async iterable', async function() {
		const fusion = create();
		assert.deepEqual(await collect(fusion.stream('python', 'streams.numbers', { n: 5 })), [0, 1, 2, 3, 4]);
	});

	test('chunks arrive while the generator is still running', async function() {
		const fusion = create();
		const arrivals = [];
		const started = Date.now();
		for await (const chunk of fusion.stream('python', 'streams.ticks', { n: 4, delay: 0.15 }))
			arrivals.push([chunk.tick, Date.now() - started]);
		assert.deepEqual(arrivals.map(item => item[0]), [0, 1, 2, 3]);
		// the first one is there long before the last one: nothing waits for the end
		assert.ok(arrivals[3][1] - arrivals[0][1] >= 350);
	});

	test('chunks can carry binary data', async function() {
		const fusion = create();
		const items = await collect(fusion.stream('python', 'streams.blobs', { n: 3 }));
		assert.equal(items.length, 3);
		items.forEach((item, i) => assert.ok(item.blob.equals(Buffer.alloc(1000, i))));
	});

	test('an empty generator ends at once and a return value is ignored', async function() {
		const fusion = create();
		assert.deepEqual(await collect(fusion.stream('python', 'streams.empty')), []);
		assert.deepEqual(await collect(fusion.stream('python', 'streams.with_return_value')), [1]);
	});

	test('a normal function called as a stream is a stream of one chunk', async function() {
		const fusion = create();
		assert.deepEqual(await collect(fusion.stream('python', 'streams.single')), ['single']);
	});

	test('python.stream() and toArray() are shortcuts', async function() {
		const fusion = create();
		assert.deepEqual(await fusion.python.stream('streams.numbers', { n: 3 }).toArray(), [0, 1, 2]);
	});

	test('a generator called without stream() says how to call it', async function() {
		const fusion = create();
		await assert.rejects(() => fusion.python('streams.numbers', { n: 3 }), { code: 'STREAMING_FUNCTION' });
		assert.deepEqual(await collect(fusion.stream('python', 'streams.numbers', { n: 2 })), [0, 1]);
	});

	test('three streams at the same time do not mix', async function() {
		const fusion = create({ workers: 3 });
		const results = await Promise.all([0, 100, 200].map(start => collect(fusion.stream('python', 'streams.numbers', { n: 5, start }))));
		assert.deepEqual(results, [[0, 1, 2, 3, 4], [100, 101, 102, 103, 104], [200, 201, 202, 203, 204]]);
	});

	test('with one worker the streams take turns', async function() {
		const fusion = create({ workers: 1 });
		const results = await Promise.all([0, 100].map(start => collect(fusion.stream('python', 'streams.numbers', { n: 3, start }))));
		assert.deepEqual(results, [[0, 1, 2], [100, 101, 102]]);
	});

});

describe('errors', function() {

	test('chunks before an error are delivered, then the error with its traceback', async function() {
		const fusion = create();
		const items = [];
		await assert.rejects(async () => {
			for await (const item of fusion.stream('python', 'streams.fails_midway'))
				items.push(item);
		}, function(err) {
			assert.equal(err.remote.name, 'ValueError');
			assert.match(err.stack, /streams\.py/);
			return true;
		});
		assert.deepEqual(items, [1, 2]);
		assert.deepEqual(await collect(fusion.stream('python', 'streams.numbers', { n: 2 })), [0, 1]);
	});

	test('a chunk that is not JSON is NOT_SERIALIZABLE and the worker survives', async function() {
		const fusion = create();
		const items = [];
		await assert.rejects(async () => {
			for await (const item of fusion.stream('python', 'streams.not_serializable_chunk'))
				items.push(item);
		}, { code: 'NOT_SERIALIZABLE' });
		assert.deepEqual(items, [1]);
		assert.deepEqual(await collect(fusion.stream('python', 'streams.numbers', { n: 2 })), [0, 1]);
	});

	test('a crash in the middle rejects the stream and the worker is replaced', async function() {
		const fusion = create();
		const before = await fusion.python('streams.pid');
		const items = [];
		await assert.rejects(async () => {
			for await (const item of fusion.stream('python', 'streams.crash_midway'))
				items.push(item);
		}, { code: 'WORKER_CRASHED' });
		assert.deepEqual(items, ['first']);
		assert.notEqual(await fusion.python('streams.pid'), before);
	});

	test('an unknown function and a closed pool fail on the first read', async function() {
		const fusion = create();
		await assert.rejects(() => collect(fusion.stream('python', 'streams.nope')), { code: 'NOT_FOUND' });
		await assert.rejects(() => collect(fusion.stream('cobol', 'a.b')), { code: 'NOT_FOUND' });
	});

	test('shutdown rejects the streams that are running', async function() {
		const fusion = create();
		const reading = assert.rejects(() => collect(fusion.stream('python', 'streams.endless_async')), { code: 'CLOSED' });
		await wait(200);
		await fusion.shutdown();
		await reading;
	});

});

describe('cancellation', function() {

	test('leaving the loop stops an async generator and frees the worker', async function() {
		const fusion = create();
		const before = await fusion.python('streams.pid');
		let count = 0;
		for await (const item of fusion.stream('python', 'streams.endless_async')) {
			if (++count === 3)
				break;
		}
		assert.equal(await fusion.python('streams.pid'), before);
		assert.equal(await fusion.python('streams.closed'), true);
	});

	test('leaving the loop stops a sync generator between two chunks', async function() {
		const fusion = create();
		const before = await fusion.python('streams.pid');
		let count = 0;
		for await (const item of fusion.stream('python', 'streams.endless_sync')) {
			if (++count === 3)
				break;
		}
		assert.equal(await fusion.python('streams.pid'), before);
		assert.equal(await fusion.python('streams.closed'), true);
	});

	test('a sync generator that blocks cannot be stopped: the worker is replaced after the grace period', async function() {
		const fusion = create({ cancelGrace: 200 });
		const before = await fusion.python('streams.pid');
		for await (const item of fusion.stream('python', 'streams.stuck_after_first')) {
			assert.equal(item, 'first');
			break;
		}
		assert.notEqual(await fusion.python('streams.pid'), before);
	});

	test('an AbortSignal rejects the stream', async function() {
		const fusion = create();
		const controller = new AbortController();
		const stream = fusion.stream('python', 'streams.endless_async', null, { signal: controller.signal });
		await stream.next();
		controller.abort();
		await assert.rejects(async () => {
			for await (const item of stream) {}
		}, { code: 'ABORTED' });
		assert.equal(await fusion.python('streams.closed'), true);
	});

	test('cancel() on a stream that waits in the queue never runs it', async function() {
		const fusion = create({ workers: 1 });
		const first = fusion.python('sample.sleep_async', { seconds: 0.3 });
		const queued = fusion.stream('python', 'streams.numbers', { n: 3 });
		queued.cancel();
		assert.deepEqual(await collect(queued), []);
		await first;
		assert.equal(fusion.stats().python.queued, 0);
	});

	test('a worker that is not reading does not keep the call alive forever: no progress means TIMEOUT', async function() {
		const fusion = create();
		const items = [];
		await assert.rejects(async () => {
			for await (const item of fusion.stream('python', 'streams.burst_then_silence', null, { timeout: 250 }))
				items.push(item);
		}, { code: 'TIMEOUT' });
		assert.deepEqual(items, ['first']);
	});

	test('a slow consumer that keeps reading is not timed out', async function() {
		const fusion = create();
		const items = [];
		for await (const item of fusion.stream('python', 'streams.numbers', { n: 6 }, { timeout: 400, highWaterMark: 2 })) {
			items.push(item);
			await wait(120);
		}
		assert.deepEqual(items, [0, 1, 2, 3, 4, 5]);
	});

});

describe('backpressure', function() {

	test('the generator only runs ahead of the consumer by the high water mark', async function() {

		const fusion = create();
		const file = Path.join(Os.tmpdir(), 'totalfusion-progress-' + process.pid);
		Fs.rmSync(file, { force: true });

		const stream = fusion.stream('python', 'streams.endless', { file }, { highWaterMark: 4, timeout: 0 });
		const iterator = stream[Symbol.asyncIterator]();

		await iterator.next();
		await iterator.next();
		await wait(400);

		// 2 read + 4 credits: without backpressure this would be hundreds of thousands
		const produced = Number(Fs.readFileSync(file, 'utf8'));
		assert.ok(produced >= 3, 'the generator did not run ahead at all: ' + produced);
		assert.ok(produced <= 7, 'the generator ran too far ahead: ' + produced);

		// Reading again lets it continue
		for (let i = 0; i < 10; i++)
			await iterator.next();

		await wait(200);
		assert.ok(Number(Fs.readFileSync(file, 'utf8')) > produced);

		stream.cancel();
		Fs.rmSync(file, { force: true });
	});

});
