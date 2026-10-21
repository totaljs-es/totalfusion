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

afterEach(async function() {
	await Promise.all(instances.splice(0).map(fusion => fusion.shutdown()));
});

describe('calls', function() {

	test('calls a Python function and returns the result', async function() {
		const fusion = create();
		assert.deepEqual(await fusion.python('sample.add', { a: 2, b: 3 }), 5);
		assert.deepEqual(await fusion.python('sample.text_length', { text: 'Hello' }), { success: true, result: 5 });
	});

	test('calls async functions', async function() {
		const fusion = create();
		assert.equal(await fusion.python('sample.sleep_async', { seconds: 0.01 }), 'done');
	});

	test('keeps responses apart under concurrency', async function() {
		const fusion = create({ workers: 3 });
		const results = await Promise.all(Array.from({ length: 200 }, (_, i) => fusion.python('sample.add', { a: i, b: 1000 })));
		assert.deepEqual(results, Array.from({ length: 200 }, (_, i) => i + 1000));
	});

	test('spreads work over the workers of the pool', async function() {
		// Each call keeps its worker busy, so three concurrent calls need three different workers
		const fusion = create({ workers: 3 });
		const pids = await Promise.all([1, 2, 3].map(() => fusion.python('sample.slow_pid', { seconds: 0.4 })));
		assert.equal(new Set(pids).size, 3);
		assert.equal(fusion.stats().python.workers, 3);
	});

	test('transfers a large payload', async function() {
		const fusion = create();
		const text = 'x'.repeat(8 * 1024 * 1024);
		const result = await fusion.python('sample.echo', text);
		assert.equal(result.length, text.length);
	});

	test('print and writes to fd 1 do not corrupt the protocol', async function() {
		const fusion = create();
		assert.equal(await fusion.python('sample.printer'), 'ok');
		assert.equal(await fusion.python('sample.add', { a: 1, b: 1 }), 2);
	});

	test('the generic call() works', async function() {
		const fusion = create();
		assert.equal(await fusion.call('python', 'sample.add', { a: 1, b: 2 }), 3);
	});

});

describe('errors', function() {

	test('propagates Python exceptions with the traceback', async function() {
		const fusion = create();
		await assert.rejects(() => fusion.python('sample.boom'), function(err) {
			assert.equal(err.code, 'REMOTE_ERROR');
			assert.equal(err.remote.name, 'ValueError');
			assert.match(err.message, /something went wrong/);
			assert.match(err.stack, /sample\.py/);
			return true;
		});
	});

	test('the worker survives a Python exception', async function() {
		const fusion = create();
		await assert.rejects(() => fusion.python('sample.boom'));
		assert.equal(await fusion.python('sample.add', { a: 1, b: 1 }), 2);
	});

	test('unknown module, unknown function, private and imported names are NOT_FOUND', async function() {
		const fusion = create();
		for (const name of ['nope.add', 'sample.nope', 'sample._private', 'sample.getcwd', 'sample.os', 'os.getcwd', 'subprocess.run', '../x.y', 'add'])
			await assert.rejects(() => fusion.python(name), { code: 'NOT_FOUND' }, name);
	});

	test('a result that is not JSON is NOT_SERIALIZABLE', async function() {
		const fusion = create();
		await assert.rejects(() => fusion.python('sample.not_serializable'), { code: 'NOT_SERIALIZABLE' });
	});

	test('arguments that are not JSON are rejected before sending', async function() {
		const fusion = create();
		const circular = {};
		circular.self = circular;
		await assert.rejects(() => fusion.python('sample.echo', circular), { code: 'ENCODE_ERROR' });
		assert.equal(await fusion.python('sample.add', { a: 1, b: 1 }), 2);
	});

	test('a missing interpreter gives a clear error', async function() {
		const fusion = create({ python: '/nonexistent/python' });
		await assert.rejects(() => fusion.python('sample.add', { a: 1, b: 1 }), function(err) {
			assert.equal(err.code, 'SPAWN_FAILED');
			assert.match(err.message, /Install Python/);
			return true;
		});
	});

	test('a missing components directory gives a clear error', async function() {
		const fusion = create({ path: Path.join(__dirname, 'missing') });
		await assert.rejects(() => fusion.python('sample.add'), { code: 'NOT_FOUND' });
	});

	test('unknown runtimes are rejected', async function() {
		const fusion = create();
		await assert.rejects(() => fusion.call('cobol', 'a.b'), { code: 'NOT_FOUND' });
		assert.throws(() => fusion.configure({ cobol: {} }), { code: 'NOT_FOUND' });
	});

	test('configure() after the first call is refused', async function() {
		const fusion = create();
		await fusion.python('sample.add', { a: 1, b: 1 });
		assert.throws(() => fusion.configure({ python: { workers: 5 } }), { code: 'ALREADY_STARTED' });
	});

});

describe('lifecycle', function() {

	test('a timeout cancels an async function and the worker keeps working', async function() {
		const fusion = create();
		const before = await fusion.python('sample.pid');
		await assert.rejects(() => fusion.python('sample.sleep_async', { seconds: 5 }, { timeout: 100 }), { code: 'TIMEOUT' });
		assert.equal(await fusion.python('sample.pid'), before);
	});

	test('a timeout on sync code replaces the worker after the grace period', async function() {
		const fusion = create({ cancelGrace: 200 });
		const before = await fusion.python('sample.pid');
		await assert.rejects(() => fusion.python('sample.sleep_sync', { seconds: 5 }, { timeout: 100 }), { code: 'TIMEOUT' });
		assert.notEqual(await fusion.python('sample.pid'), before);
	});

	test('a crashed worker rejects the call, is replaced and the call is not retried', async function() {
		const fusion = create();
		const before = await fusion.python('sample.pid');
		await assert.rejects(() => fusion.python('sample.crash'), { code: 'WORKER_CRASHED', exitCode: 3 });
		assert.notEqual(await fusion.python('sample.pid'), before);
	});

	test('the queue is bounded', async function() {
		const fusion = create({ maxQueue: 2 });
		await fusion.python('sample.add', { a: 1, b: 1 });
		const slow = [1, 2, 3].map(() => fusion.python('sample.sleep_async', { seconds: 0.2 }));
		await assert.rejects(() => fusion.python('sample.add', { a: 1, b: 1 }), { code: 'QUEUE_FULL' });
		await Promise.all(slow);
	});

	test('an AbortSignal rejects a queued call and a running call', async function() {
		const fusion = create();
		const running = new AbortController();
		const queued = new AbortController();
		const first = fusion.python('sample.sleep_async', { seconds: 5 }, { signal: running.signal });
		const second = fusion.python('sample.add', { a: 1, b: 1 }, { signal: queued.signal });
		queued.abort();
		await assert.rejects(() => second, { code: 'ABORTED' });
		running.abort();
		await assert.rejects(() => first, { code: 'ABORTED' });
		assert.equal(await fusion.python('sample.add', { a: 1, b: 1 }), 2);
	});

	test('an already aborted signal rejects immediately', async function() {
		const fusion = create();
		await assert.rejects(() => fusion.python('sample.add', null, { signal: AbortSignal.abort() }), { code: 'ABORTED' });
	});

	test('workers start lazily, on demand, up to the pool size', async function() {
		const fusion = create({ workers: 3 });
		assert.deepEqual(fusion.stats(), {});
		await fusion.python('sample.add', { a: 1, b: 1 });
		assert.equal(fusion.stats().python.workers, 1);
	});

	test('shutdown rejects pending calls and a later call starts a fresh pool', async function() {
		const fusion = create();
		const pending = assert.rejects(fusion.python('sample.sleep_async', { seconds: 5 }), { code: 'CLOSED' });
		await new Promise(resolve => setTimeout(resolve, 100));
		await fusion.shutdown();
		await pending;
		assert.equal(await fusion.python('sample.add', { a: 1, b: 1 }), 2);
	});

	test('workers do not outlive their parent', async function() {

		const { spawn } = require('child_process');
		const script = 'const f = require(' + JSON.stringify(Path.join(__dirname, '..')) + '); f.configure({ python: { path: ' + JSON.stringify(PATH) + ' } }); f.python("sample.pid").then(pid => { console.log(pid); process.exit(0); });';
		const child = spawn(process.execPath, ['-e', script]);

		let output = '';
		child.stdout.on('data', chunk => output += chunk);
		await new Promise(resolve => child.on('close', resolve));

		const pid = Number(output.trim());
		assert.ok(pid > 0);
		await new Promise(resolve => setTimeout(resolve, 500));
		assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' });
	});

	test('idle workers do not keep the process alive', async function() {

		const { spawnSync } = require('child_process');
		const script = 'const f = require(' + JSON.stringify(Path.join(__dirname, '..')) + '); f.configure({ python: { path: ' + JSON.stringify(PATH) + ' } }); f.python("sample.add", { a: 1, b: 2 }).then(r => console.log(r));';
		const result = spawnSync(process.execPath, ['-e', script], { timeout: 10000 });

		assert.equal(result.status, 0);
		assert.equal(result.stdout.toString().trim(), '3');
	});

});
