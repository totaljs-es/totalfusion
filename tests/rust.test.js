'use strict';

const { test, describe, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const Path = require('path');
const Fs = require('fs');
const Os = require('os');
const Crypto = require('crypto');
const { spawnSync } = require('child_process');
const build = require('./rust-build');
const total5 = require('./locate-total5')();
const BIN = Path.join(__dirname, '..', 'bin', 'totalfusion.js');
const { Fusion } = require('..');

const skip = build.skip();
const instances = [];

function create(options) {
	const fusion = new Fusion({ rust: Object.assign({ binary: build(), forwardStderr: false }, options) });
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

afterEach(async function() {
	await Promise.all(instances.splice(0).map(fusion => fusion.shutdown()));
});

describe('calls', { skip }, function() {

	test('calls a Rust function and returns the result', async function() {
		const fusion = create();
		assert.deepEqual(await fusion.rust('math.add', { a: 2, b: 3.5 }), { sum: 5.5 });
		assert.deepEqual(await fusion.rust('text.length', { text: 'héllo wörld' }), { length: 11 });
	});

	test('keeps responses apart under concurrency', async function() {
		const fusion = create({ workers: 3 });
		const results = await Promise.all(Array.from({ length: 200 }, (_, i) => fusion.rust('math.add', { a: i, b: 1000 })));
		assert.deepEqual(results.map(item => item.sum), Array.from({ length: 200 }, (_, i) => i + 1000));
	});

	test('a function without a module and one with a dotted name', async function() {
		const fusion = create();
		assert.equal(await fusion.rust('single'), 'single');
		assert.equal(await fusion.rust('echo', 'text'), 'text');
	});

	test('json values go and come back', async function() {
		const fusion = create();
		const value = { a: [1, 2, { b: null }], s: 'x', n: 1.5, t: true, nested: { deep: { deeper: [] } } };
		assert.deepEqual(await fusion.rust('echo', value), value);
	});

	test('what is printed does not break the protocol', async function() {
		const fusion = create();
		assert.equal(await fusion.rust('print'), 'ok');
		assert.equal((await fusion.rust('math.add', { a: 1, b: 1 })).sum, 2);
	});

	test('the memory of the worker is reported', async function() {
		const fusion = create();
		await fusion.rust('pid');
		const worker = fusion.stats().rust.details[0];
		assert.ok(worker.pid > 0);
		assert.equal(worker.calls, 1);

		if (['linux', 'darwin', 'win32'].includes(process.platform))
			assert.ok(worker.memory > 100 * 1024, 'memory: ' + worker.memory);
	});

});

describe('errors', { skip }, function() {

	test('an error of the function reaches JavaScript with its name', async function() {
		const fusion = create();
		await assert.rejects(() => fusion.rust('fail'), function(err) {
			assert.equal(err.code, 'REMOTE_ERROR');
			assert.equal(err.remote.name, 'Error');
			assert.match(err.message, /something failed/);
			return true;
		});
	});

	test('Error::invalid is a ValueError, the way the callers of Total.js tell their own mistakes', async function() {
		const fusion = create();
		await assert.rejects(() => fusion.rust('math.add', { a: 1 }), function(err) {
			assert.equal(err.remote.name, 'ValueError');
			assert.match(err.message, /b must be a number/);
			return true;
		});
	});

	test('an error can have a name and a code of its own', async function() {
		const fusion = create();
		await assert.rejects(() => fusion.rust('named'), { code: 'E_DB' });
	});

	test('a panic is a failure of that call: the worker lives on', async function() {
		const fusion = create();
		const before = await fusion.rust('pid');
		await assert.rejects(() => fusion.rust('boom'), function(err) {
			assert.equal(err.remote.name, 'Panic');
			assert.match(err.message, /kaboom/);
			return true;
		});
		assert.equal(await fusion.rust('pid'), before);
	});

	test('a crash of the process rejects the call and the worker is replaced; Node.js is fine', async function() {
		const fusion = create();
		const before = await fusion.rust('pid');
		await assert.rejects(() => fusion.rust('crash'), { code: 'WORKER_CRASHED', exitCode: 3 });
		assert.notEqual(await fusion.rust('pid'), before);
	});

	test('NaN cannot be sent', async function() {
		const fusion = create();
		await assert.rejects(() => fusion.rust('nan'), { code: 'NOT_SERIALIZABLE' });
		assert.equal((await fusion.rust('math.add', { a: 1, b: 1 })).sum, 2);
	});

	test('an unknown function and a stream called as a function', async function() {
		const fusion = create();
		await assert.rejects(() => fusion.rust('nope'), { code: 'NOT_FOUND' });
		await assert.rejects(() => fusion.rust('count.up', { n: 2 }), { code: 'STREAMING_FUNCTION' });
	});

	test('a worker that does not exist or an option that is missing is a clear error', async function() {
		await assert.rejects(() => create({ binary: Path.join(Os.tmpdir(), 'no-such-worker') }).rust('pid'), { code: 'NOT_FOUND' });
		await assert.rejects(() => create({ binary: null }).rust('pid'), { code: 'INVALID_CONFIG' });
	});

});

describe('timeouts and cancellation', { skip }, function() {

	test('a function that looks at is_cancelled() stops and the worker is free again', async function() {
		const fusion = create();
		const before = await fusion.rust('pid');
		await assert.rejects(() => fusion.rust('sleep', { ms: 5000 }, { timeout: 150 }), { code: 'TIMEOUT' });
		assert.equal(await fusion.rust('pid'), before);
	});

	test('a function that never looks is killed after the grace period and replaced', async function() {
		const fusion = create({ cancelGrace: 200 });
		const before = await fusion.rust('pid');
		await assert.rejects(() => fusion.rust('deaf', { ms: 60000 }, { timeout: 100 }), { code: 'TIMEOUT' });
		assert.notEqual(await fusion.rust('pid'), before);
	});

	test('the shutdown hook runs when the pool is closed', async function() {
		const file = Path.join(Os.tmpdir(), 'totalfusion-rust-shutdown-' + process.pid);
		Fs.rmSync(file, { force: true });
		const fusion = create({ env: Object.assign({}, process.env, { FUSION_TEST_SHUTDOWN_FILE: file }) });
		await fusion.rust('pid');
		await fusion.shutdown();
		assert.equal(Fs.readFileSync(file, 'utf8'), 'bye');
		Fs.rmSync(file, { force: true });
	});

});

describe('binary data', { skip }, function() {

	test('a Buffer arrives as bytes', async function() {
		const fusion = create();
		const blob = Crypto.randomBytes(1000);
		assert.equal(await fusion.rust('bytes.length', { blob }), 1000);
		assert.equal(await fusion.rust('bytes.sum', { blob }), blob.reduce((sum, byte) => sum + byte, 0));
	});

	test('a Float32Array arrives as f32 and comes back as a Float32Array', async function() {
		const fusion = create();
		assert.equal(await fusion.rust('floats.sum', { values: new Float32Array([1.5, 2.5, 3]) }), 7);
		const doubled = await fusion.rust('floats.double', { values: new Float32Array([1.5, 2.5]) });
		assert.ok(doubled instanceof Float32Array);
		assert.deepEqual([...doubled], [3, 5]);
	});

	test('every type of array comes back as the typed array of JavaScript', async function() {
		const fusion = create();
		const result = await fusion.rust('types');
		assert.deepEqual(result.i32, new Int32Array([-1, 2]));
		assert.deepEqual(result.f64, new Float64Array([0.5, 1.5]));
		assert.deepEqual(result.u16, new Uint16Array([65535]));
		assert.deepEqual(result.i64, new BigInt64Array([-(2n ** 63n)]));
		assert.ok(Buffer.isBuffer(result.bytes) || result.bytes instanceof Uint8Array);
		assert.deepEqual([...result.bytes], [1, 2, 3]);
		assert.deepEqual(result.nested.map(item => [...item]), [[1], [2, 3]]);
	});

	test('binary data nested in what is echoed keeps its type', async function() {
		const fusion = create();
		const result = await fusion.rust('echo', { a: [Buffer.from('hi')], f: new Float64Array([0.1, 0.2]), plain: 1 });
		assert.equal(Buffer.from(result.a[0]).toString(), 'hi');
		assert.deepEqual(result.f, new Float64Array([0.1, 0.2]));
		assert.equal(result.plain, 1);
	});

	test('50 MB go to Rust and 50 MB come back', async function() {
		const fusion = create();
		const blob = Crypto.randomBytes(50 * 1024 * 1024);
		assert.equal(await fusion.rust('bytes.length', { blob }), blob.length);
		const made = await fusion.rust('bytes.make', { n: 50 * 1024 * 1024 });
		assert.equal(made.length, 50 * 1024 * 1024);
		assert.equal(made[0], 7);
		assert.equal(made[made.length - 1], 7);
	});

	test('5 million floats make a round trip', async function() {
		const fusion = create();
		const values = new Float32Array(5_000_000).map((_, i) => Math.fround(Math.sin(i)));
		const echoed = await fusion.rust('echo', { values });
		assert.deepEqual(echoed.values, values);
	});

});

describe('streams', { skip }, function() {

	test('a stream function becomes an async iterable', async function() {
		const fusion = create();
		assert.deepEqual(await collect(fusion.rust.stream('count.up', { n: 5, start: 10 })), [10, 11, 12, 13, 14]);
	});

	test('chunks arrive while the function is still running', async function() {
		const fusion = create();
		const arrivals = [];
		const started = Date.now();
		for await (const chunk of fusion.rust.stream('ticks', { n: 4, delay: 150 }))
			arrivals.push([chunk.tick, Date.now() - started]);
		assert.deepEqual(arrivals.map(item => item[0]), [0, 1, 2, 3]);
		assert.ok(arrivals[3][1] - arrivals[0][1] >= 350);
	});

	test('chunks can carry binary data', async function() {
		const fusion = create();
		const items = await collect(fusion.rust.stream('blobs', { n: 3 }));
		items.forEach((item, i) => assert.ok(Buffer.from(item.blob).equals(Buffer.alloc(1000, i))));
	});

	test('a normal function called as a stream is a stream of one chunk', async function() {
		const fusion = create();
		assert.deepEqual(await collect(fusion.rust.stream('single')), ['single']);
	});

	test('chunks before an error are delivered, then the error', async function() {
		const fusion = create();
		const items = [];
		await assert.rejects(async () => {
			for await (const item of fusion.rust.stream('fails_midway'))
				items.push(item);
		}, function(err) {
			assert.equal(err.remote.name, 'ValueError');
			return true;
		});
		assert.deepEqual(items, [1, 2]);
	});

	test('a crash in the middle rejects the stream', async function() {
		const fusion = create();
		const items = [];
		await assert.rejects(async () => {
			for await (const item of fusion.rust.stream('crash_midway'))
				items.push(item);
		}, { code: 'WORKER_CRASHED' });
		assert.deepEqual(items, ['first']);
	});

	test('leaving the loop stops an endless stream and frees the worker', async function() {
		const fusion = create();
		const before = await fusion.rust('pid');
		let count = 0;
		for await (const item of fusion.rust.stream('endless', {})) {
			if (++count === 3)
				break;
		}
		assert.equal(await fusion.rust('pid'), before);
	});

	test('the function only runs ahead of the consumer by the high water mark', async function() {

		const fusion = create();
		const file = Path.join(Os.tmpdir(), 'totalfusion-rust-progress-' + process.pid);
		Fs.rmSync(file, { force: true });

		const stream = fusion.rust.stream('endless', { file }, { highWaterMark: 4, timeout: 0 });
		const iterator = stream[Symbol.asyncIterator]();

		await iterator.next();
		await iterator.next();
		await wait(400);

		const produced = Number(Fs.readFileSync(file, 'utf8'));
		assert.ok(produced >= 3 && produced <= 7, 'produced: ' + produced);

		for (let i = 0; i < 10; i++)
			await iterator.next();

		await wait(200);
		assert.ok(Number(Fs.readFileSync(file, 'utf8')) > produced);

		stream.cancel();
		Fs.rmSync(file, { force: true });
	});

});

describe('workers', { skip }, function() {

	test('work is spread over the workers of the pool', async function() {
		// Each call keeps its worker busy, so three concurrent calls need three different workers
		const fusion = create({ workers: 3 });
		const pids = await Promise.all([1, 2, 3].map(() => fusion.rust('slow_pid', { ms: 400 })));
		assert.equal(new Set(pids).size, 3);
		assert.equal(fusion.stats().rust.workers, 3);
	});

	test('a worker is replaced after maxCalls and nothing fails', async function() {
		const fusion = create({ maxCalls: 5 });
		const pids = new Set();
		for (let i = 0; i < 60; i++) {
			pids.add(await fusion.rust('pid'));
			await wait(10);
		}
		assert.ok(pids.size >= 2);
		assert.ok(fusion.stats().rust.recycled.calls >= 1);
	});

	test('a worker that grows over maxMemory is replaced', { skip: ['linux', 'darwin', 'win32'].includes(process.platform) ? false : 'memory is not reported here' }, async function() {
		const fusion = create({ maxMemory: '100mb' });
		const first = await fusion.rust('pid');
		assert.equal(await fusion.rust('leak', { mb: 150 }), 1);
		assert.ok(await until(async () => await fusion.rust('pid') !== first, 8000), 'the worker was not replaced');
		assert.equal(await fusion.rust('held'), 0);
	});

	test('idle workers answer the health check', async function() {
		const fusion = create({ healthInterval: 100, healthTimeout: 500 });
		const pid = await fusion.rust('pid');
		await wait(900);
		assert.equal(fusion.stats().rust.unresponsive, 0);
		assert.equal(await fusion.rust('pid'), pid);
	});

	test('warmup starts the workers', async function() {
		const fusion = create({ workers: 2 });
		await fusion.warmup('rust');
		assert.equal(fusion.stats().rust.ready, 2);
	});

});

describe('describe', { skip }, function() {

	test('the contracts are read from the binary', async function() {
		const found = await create().describe('rust');
		const add = found.actions.find(item => item.fn === 'math.add');
		assert.equal(add.module, 'math');
		assert.equal(add.name, 'add');
		assert.deepEqual(add.meta, { summary: 'Adds two numbers', input: '*a:Number\n*b:Number', output: 'sum:Number', mcp: true, timeout: 5000 });
		assert.equal(found.actions.find(item => item.fn === 'count.up').stream, true);
		assert.equal(found.actions.find(item => item.fn === 'single').module, '');
		assert.deepEqual(found.errors, []);

		// only the functions that declare a contract (or ask for it) are registered; the others are private
		const names = found.actions.map(item => item.fn);
		assert.ok(!names.includes('echo'));
		assert.ok(!names.includes('pid'));
		assert.ok(!names.includes('boom'));
		assert.ok(found.functions > names.length);
	});

});

describe('Total.js 5', { skip: skip || (total5 ? false : 'Total.js 5 not found (set TOTAL5_PATH)') }, function() {

	const result = {};

	test('the functions of the worker become actions', function() {

		const run = spawnSync(process.execPath, [Path.join(__dirname, 'rust-total5-script.js'), total5, build()], { timeout: 60000, cwd: Os.tmpdir() });
		assert.equal(run.status, 0, run.stderr.toString() + run.stdout.toString().slice(-500));

		const report = JSON.parse(run.stdout.toString().trim().split('\n').pop());
		Object.assign(result, report);

		// only the functions that declare a contract (or ask for it) are registered
		assert.deepEqual(report.registered.ids.sort(), ['actions/fails', 'actions/rejects', 'math/add', 'restricted', 'sections', 'single', 'text/length']);

		// a stream is not an action
		assert.equal(report.registered.warnings.length, 1);
		assert.equal(report.registered.warnings[0].id, 'count/up');

		assert.deepEqual(report.add, { ok: true, output: { sum: 5 } });
		assert.deepEqual(report.length, { ok: true, output: { length: 5 } });
		assert.deepEqual(report.single, { ok: true, output: 'single' });
	});

	test('Total.js validates the input with the contract before Rust is reached', function() {
		assert.equal(result.addInvalid.ok, false);
		assert.equal(result.addInvalid.errors[0].path, 'b');
	});

	test('only the message of Error::invalid reaches the client', function() {
		assert.deepEqual(result.rejects, { ok: false, errors: [{ error: 'the value is not acceptable' }] });
		assert.deepEqual(result.fails, { ok: false, errors: [{ error: 'The action failed' }] });
		assert.deepEqual(result.logged, ['REMOTE_ERROR', 'REMOTE_ERROR']);
	});

	test('query and params arrive validated, next to the input', function() {
		assert.deepEqual(result.sections.result, { ok: true, output: { input: { a: 5 }, query: { page: 2 }, params: { id: result.sections.id } } });
		assert.equal(result.sectionsInvalid.errors[0].name, 'query.page');
	});

	test('permissions are checked by Total.js', function() {
		assert.equal(result.restricted.reader.ok, false);
		assert.equal(result.restricted.nobody.ok, false);
		assert.deepEqual(result.restricted.editor, { ok: true, output: 'allowed' });
	});

	test('the functions with mcp(true) are tools for agents', function() {
		if (!result.tools)
			return;

		assert.deepEqual(result.tools.map(tool => tool.name).sort(), ['math_add', 'sections']);
		assert.equal(result.tools.find(tool => tool.name === 'math_add').description, 'Adds two numbers');
		assert.deepEqual(Object.keys(result.tools.find(tool => tool.name === 'sections').inputSchema.properties), ['input', 'query', 'params']);
	});

});

describe('doctor', { skip }, function() {

	const posix = process.platform === 'win32' ? 'this needs a shell script' : false;

	function script(name, content, mode) {
		const directory = Fs.mkdtempSync(Path.join(Os.tmpdir(), 'totalfusion-doctor-'));
		const file = Path.join(directory, name);
		Fs.writeFileSync(file, content);
		Fs.chmodSync(file, mode);
		return file;
	}

	function find(report, name, status) {
		return report.checks.filter(check => check.name === name && (!status || check.status === status));
	}

	test('a healthy worker has nothing to fix', async function() {
		const report = await create().doctor('rust');
		assert.equal(report.ok, true, report.text);
		assert.equal(find(report, 'Binary', 'ok').length, 1);
		assert.match(find(report, 'Functions', 'ok')[0].message, /\d+ functions \(\d+ streaming\), totalfusion crate 0\.1\.0, protocol 2/);
	});

	test('a worker that is not configured or does not exist says how to build it', async function() {
		let report = await create({ binary: null }).doctor('rust');
		assert.equal(report.ok, false);
		assert.match(find(report, 'Binary', 'error')[0].message, /binary option is not set/);

		report = await create({ binary: Path.join(Os.tmpdir(), 'no-such-worker') }).doctor('rust');
		assert.match(find(report, 'Binary', 'error')[0].fix, /cargo build --release/);
	});

	test('a file that cannot be executed is an error', { skip: posix }, async function() {
		const report = await create({ binary: script('worker', '#!/bin/sh\n', 0o644) }).doctor('rust');
		assert.match(find(report, 'Binary', 'error')[0].message, /is not executable/);
		assert.match(find(report, 'Binary', 'error')[0].fix, /chmod \+x/);
	});

	test('a program that is not a worker is an error', { skip: posix }, async function() {
		const report = await create({ binary: script('worker', '#!/bin/sh\necho this is not json\n', 0o755) }).doctor('rust');
		assert.equal(report.ok, false);
		assert.equal(find(report, 'Worker', 'error').length, 1);
	});

	test('a worker built with another protocol is an error', { skip: posix }, async function() {
		const report = await create({ binary: script('worker', '#!/bin/sh\necho \'{"protocol":1,"actions":[],"errors":[]}\'\n', 0o755) }).doctor('rust');
		assert.match(find(report, 'Protocol', 'error')[0].message, /protocol 1 and this version of TotalFusion speaks 2/);
	});

	test('a debug build gets a warning', { skip: posix }, async function() {
		const directory = Fs.mkdtempSync(Path.join(Os.tmpdir(), 'totalfusion-debug-'));
		Fs.mkdirSync(Path.join(directory, 'target', 'debug'), { recursive: true });
		const file = Path.join(directory, 'target', 'debug', 'worker');
		Fs.copyFileSync(build(), file);
		Fs.chmodSync(file, 0o755);

		const report = await create({ binary: file }).doctor('rust');
		assert.equal(report.ok, true);
		assert.match(find(report, 'Build', 'warn')[0].message, /debug build/);
	});

	test('the terminal command works with --runtime rust', function() {
		const run = (...args) => spawnSync(process.execPath, [BIN, ...args], { encoding: 'utf8', timeout: 60000 });

		let result = run('doctor', '--binary', build());
		assert.equal(result.status, 0, result.stdout + result.stderr);
		assert.match(result.stdout, /TotalFusion doctor: rust/);

		result = run('doctor', '--runtime', 'rust', '--binary', Path.join(Os.tmpdir(), 'no-such-worker'));
		assert.equal(result.status, 1);

		assert.equal(run('doctor', '--runtime', 'cobol').status, 2);
	});

});

describe('calls at the same time in one worker', { skip }, function() {

	test('the calls run in parallel threads of the same process', async function() {
		const fusion = create({ workers: 1, concurrency: 4 });
		await fusion.rust('pid');
		const started = Date.now();
		const pids = await Promise.all(Array.from({ length: 4 }, () => fusion.rust('slow_pid', { ms: 400 })));
		// serial: 1600 ms
		assert.ok(Date.now() - started < 1200, 'they did not overlap');
		assert.equal(new Set(pids).size, 1);
		assert.equal(fusion.stats().rust.workers, 1);
	});

	test('by default a worker runs one call at a time', async function() {
		const fusion = create({ workers: 1 });
		await fusion.rust('pid');
		const started = Date.now();
		await Promise.all(Array.from({ length: 3 }, () => fusion.rust('slow_pid', { ms: 200 })));
		assert.ok(Date.now() - started >= 550);
	});

	test('responses do not mix up', async function() {
		const fusion = create({ workers: 2, concurrency: 8 });
		const results = await Promise.all(Array.from({ length: 400 }, (_, i) => fusion.rust('math.add', { a: i, b: 1 })));
		assert.deepEqual(results.map(item => item.sum), Array.from({ length: 400 }, (_, i) => i + 1));
	});

	test('several streams share a worker', async function() {
		const fusion = create({ workers: 1, concurrency: 4 });
		const results = await Promise.all([0, 100, 200].map(start => collect(fusion.rust.stream('count.up', { n: 4, start }))));
		assert.deepEqual(results, [[0, 1, 2, 3], [100, 101, 102, 103], [200, 201, 202, 203]]);
	});

	test('a consumer that stops reading does not block the other calls (the writer is never held while waiting)', async function() {
		const fusion = create({ workers: 1, concurrency: 4 });
		const stalled = fusion.rust.stream('endless', {}, { highWaterMark: 2, timeout: 0 });
		await stalled.next();
		await wait(200);
		assert.deepEqual(await fusion.rust('math.add', { a: 1, b: 2 }), { sum: 3 });
		assert.deepEqual(await collect(fusion.rust.stream('count.up', { n: 3 })), [0, 1, 2]);
		stalled.cancel();
	});

	test('a call that is cancelled does not hurt the ones next to it', async function() {
		const fusion = create({ workers: 1, concurrency: 3 });
		const pid = await fusion.rust('pid');
		const [slow, neighbour] = await Promise.allSettled([
			fusion.rust('sleep', { ms: 5000 }, { timeout: 150 }),
			fusion.rust('sleep', { ms: 500 })
		]);
		assert.equal(slow.reason.code, 'TIMEOUT');
		assert.equal(neighbour.value, 'done');
		assert.equal(await fusion.rust('pid'), pid);
	});

	test('a panic fails only its own call', async function() {
		const fusion = create({ workers: 1, concurrency: 3 });
		const pid = await fusion.rust('pid');
		const [boom, ok] = await Promise.allSettled([fusion.rust('boom'), fusion.rust('slow_pid', { ms: 200 })]);
		assert.equal(boom.reason.remote.name, 'Panic');
		assert.equal(ok.value, pid);
	});

	test('a crash of the process rejects every call that it was running', async function() {
		const fusion = create({ workers: 1, concurrency: 3 });
		await fusion.rust('pid');
		const results = await Promise.allSettled([fusion.rust('sleep', { ms: 2000 }), fusion.rust('sleep', { ms: 2000 }), fusion.rust('crash')]);
		assert.deepEqual(results.map(result => result.reason.code), ['WORKER_CRASHED', 'WORKER_CRASHED', 'WORKER_CRASHED']);
		assert.ok(await fusion.rust('pid') > 0);
	});

});
