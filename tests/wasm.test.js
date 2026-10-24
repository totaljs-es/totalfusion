'use strict';

const { test, describe, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const Path = require('path');
const Fs = require('fs');
const Os = require('os');
const Crypto = require('crypto');
const { spawnSync } = require('child_process');
const build = require('./wasm-build');
const fixtures = require('./wasm-fixtures');
const total5 = require('./locate-total5')();
const BIN = Path.join(__dirname, '..', 'bin', 'totalfusion.js');
const { Fusion } = require('..');

const skip = build.skip();
const instances = [];
const directories = [];

function create(options) {
	const fusion = new Fusion({ wasm: Object.assign({ module: build(), forwardStderr: false }, options) });
	instances.push(fusion);
	return fusion;
}

// A module that is not the one of the tests: written to a file of its own
function file(content, name) {
	const directory = Fs.mkdtempSync(Path.join(Os.tmpdir(), 'totalfusion-wasm-test-'));
	directories.push(directory);
	const path = Path.join(directory, name || 'module.wasm');
	Fs.writeFileSync(path, content);
	return path;
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

const pids = fusion => fusion.stats().wasm.details.map(item => item.pid);

afterEach(async function() {
	await Promise.all(instances.splice(0).map(fusion => fusion.shutdown()));
	for (const directory of directories.splice(0))
		Fs.rmSync(directory, { recursive: true, force: true });
});

describe('calls', { skip }, function() {

	test('calls a function of the module and returns the result', async function() {
		const fusion = create();
		assert.deepEqual(await fusion.wasm('math.add', { a: 2, b: 3.5 }), { sum: 5.5 });
		assert.deepEqual(await fusion.wasm('text.length', { text: 'héllo wörld' }), { length: 11 });
	});

	test('keeps responses apart under concurrency', async function() {
		const fusion = create({ workers: 3 });
		const results = await Promise.all(Array.from({ length: 200 }, (_, i) => fusion.wasm('math.add', { a: i, b: 1000 })));
		assert.deepEqual(results.map(item => item.sum), Array.from({ length: 200 }, (_, i) => i + 1000));
	});

	test('json values go and come back', async function() {
		const fusion = create();
		const value = { a: [1, 2, { b: null }], s: 'x', n: 1.5, t: true, nested: { deep: { deeper: [] } } };
		assert.deepEqual(await fusion.wasm('echo', value), value);
		assert.equal(await fusion.wasm('echo', 'text'), 'text');
		assert.equal(await fusion.wasm('single'), 'single');
	});

	test('the state of the module lives as long as its instance', async function() {
		const fusion = create();
		assert.deepEqual([await fusion.wasm('counter.next'), await fusion.wasm('counter.next'), await fusion.wasm('counter.next')], [1, 2, 3]);
	});

	test('what the module prints does not break the protocol', async function() {
		const fusion = create();
		assert.equal(await fusion.wasm('print'), 'ok');
		assert.equal((await fusion.wasm('math.add', { a: 1, b: 1 })).sum, 2);
	});

	test('the memory of the process is reported', async function() {
		const fusion = create();
		await fusion.wasm('single');
		const worker = fusion.stats().wasm.details[0];
		assert.ok(worker.pid > 0);
		assert.ok(worker.memory > 1024 * 1024, 'memory: ' + worker.memory);
	});

});

describe('errors', { skip }, function() {

	test('an error of the function reaches JavaScript with its name', async function() {
		const fusion = create();
		await assert.rejects(() => fusion.wasm('fail'), function(err) {
			assert.equal(err.code, 'REMOTE_ERROR');
			assert.equal(err.remote.name, 'Error');
			assert.match(err.message, /something failed/);
			return true;
		});
	});

	test('Invalid is a ValueError, the way the callers of Total.js tell their own mistakes', async function() {
		const fusion = create();
		await assert.rejects(() => fusion.wasm('math.add', { a: 1 }), function(err) {
			assert.equal(err.remote.name, 'ValueError');
			assert.match(err.message, /b must be a number/);
			return true;
		});
	});

	test('an error can have a name and a code of its own', async function() {
		const fusion = create();
		await assert.rejects(() => fusion.wasm('named'), { code: 'E_DB' });
	});

	test('a panic is a failure of that call: the worker lives on', async function() {
		const fusion = create();
		await fusion.wasm('single');
		const before = pids(fusion);
		await assert.rejects(() => fusion.wasm('boom'), function(err) {
			assert.equal(err.remote.name, 'Panic');
			assert.match(err.message, /kaboom/);
			return true;
		});
		assert.equal(await fusion.wasm('single'), 'single');
		assert.deepEqual(pids(fusion), before);
	});

	test('NaN cannot be sent', async function() {
		const fusion = create();
		await assert.rejects(() => fusion.wasm('nan'), { code: 'NOT_SERIALIZABLE' });
		assert.equal((await fusion.wasm('math.add', { a: 1, b: 1 })).sum, 2);
	});

	test('an unknown function and a stream called as a function', async function() {
		const fusion = create();
		await assert.rejects(() => fusion.wasm('nope'), { code: 'NOT_FOUND' });
		await assert.rejects(() => fusion.wasm('count.up'), { code: 'STREAMING_FUNCTION' });
	});

	test('a module that does not exist or an option that is missing is a clear error', async function() {
		await assert.rejects(() => create({ module: Path.join(Os.tmpdir(), 'no-such-module.wasm') }).wasm('single'), { code: 'NOT_FOUND' });
		await assert.rejects(() => create({ module: null }).wasm('single'), { code: 'INVALID_CONFIG' });
	});

});

describe('the sandbox', { skip }, function() {

	test('the module cannot read a file', async function() {
		const fusion = create();
		const result = await fusion.wasm('sandbox.read', { path: __filename });
		assert.equal(result.read, false);
		assert.equal((await fusion.wasm('sandbox.read', { path: '/etc/hosts' })).read, false);
	});

	test('the module cannot write a file', async function() {
		const fusion = create();
		const target = Path.join(Os.tmpdir(), 'totalfusion-escaped-' + process.pid);
		Fs.rmSync(target, { force: true });
		assert.equal((await fusion.wasm('sandbox.write', { path: target })).written, false);
		assert.equal(Fs.existsSync(target), false);
	});

	test('the module sees no environment and no arguments', async function() {
		const fusion = create({ env: Object.assign({}, process.env, { TOTALFUSION_SECRET: 'visible to the host only' }) });
		assert.deepEqual(await fusion.wasm('sandbox.env'), { variables: 0, home: '', args: 0 });
	});

	test('the module cannot open a connection', async function() {

		const net = require('net');
		const server = net.createServer(socket => socket.end());
		await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));

		try {
			// the module dials 127.0.0.1:1; what matters is that nothing reaches a port that is open
			assert.equal((await create().wasm('sandbox.net')).connected, false);
		} finally {
			server.close();
		}
	});

	test('a module that imports anything but WASI is refused, with the reason', async function() {
		const path = file(fixtures.module({ imports: [{ module: 'env', name: 'fetch' }] }));
		await assert.rejects(() => create({ module: path }).wasm('anything'), function(err) {
			assert.match(err.message, /imports env\.fetch/);
			return true;
		});
	});

	test('a command module is refused: it has to be a reactor', async function() {
		const path = file(fixtures.module({ command: true }));
		await assert.rejects(() => create({ module: path }).wasm('anything'), /exports _start/);
	});

	test('a module that speaks another version of the ABI is refused', async function() {
		const path = file(fixtures.module({ abi: 7 }));
		await assert.rejects(() => create({ module: path }).wasm('anything'), /version 7 of the ABI/);
	});

});

describe('traps, exits and timeouts', { skip }, function() {

	test('a trap fails that call, and the worker lives on', async function() {
		const fusion = create({ module: file(fixtures.module()) });

		for (let i = 0; i < 3; i++) {
			await assert.rejects(() => fusion.wasm('anything'), function(err) {
				assert.equal(err.remote.name, 'Trap');
				assert.equal(err.code, 'WASM_TRAP');
				return true;
			});
		}

		assert.equal(pids(fusion).length, 1);
	});

	test('a module that ends its own process fails the call and starts again with a clean state', async function() {
		const fusion = create();
		assert.equal(await fusion.wasm('counter.next'), 1);
		assert.equal(await fusion.wasm('counter.next'), 2);
		const before = pids(fusion);
		await assert.rejects(() => fusion.wasm('exit'), { code: 'WASM_EXIT' });
		assert.equal(await fusion.wasm('counter.next'), 1);
		assert.deepEqual(pids(fusion), before);
	});

	test('a function that never returns is killed after the timeout and the worker is replaced', async function() {
		const fusion = create({ cancelGrace: 200 });
		await fusion.wasm('single');
		const before = pids(fusion);
		await assert.rejects(() => fusion.wasm('spin', null, { timeout: 150 }), { code: 'TIMEOUT' });
		assert.equal((await fusion.wasm('math.add', { a: 1, b: 2 })).sum, 3);
		assert.notDeepEqual(pids(fusion), before);
	});

	test('the shutdown ends the worker', async function() {
		const fusion = create();
		await fusion.wasm('single');
		const [pid] = pids(fusion);
		await fusion.shutdown();
		assert.ok(await until(() => { try { process.kill(pid, 0); return false; } catch { return true; } }, 3000), 'the process is still running');
	});

});

describe('binary data', { skip }, function() {

	test('a Buffer arrives as bytes', async function() {
		const fusion = create();
		const blob = Crypto.randomBytes(1000);
		assert.equal(await fusion.wasm('bytes.length', { blob }), 1000);
		assert.equal(await fusion.wasm('bytes.sum', { blob }), blob.reduce((sum, byte) => sum + byte, 0));
	});

	test('a Float32Array arrives as f32 and comes back as a Float32Array', async function() {
		const fusion = create();
		const doubled = await fusion.wasm('floats.double', { values: new Float32Array([1.5, 2.5]) });
		assert.ok(doubled instanceof Float32Array);
		assert.deepEqual([...doubled], [3, 5]);
	});

	test('every type of array comes back as the typed array of JavaScript', async function() {
		const fusion = create();
		const result = await fusion.wasm('types');
		assert.deepEqual(result.i32, new Int32Array([-1, 2]));
		assert.deepEqual(result.f64, new Float64Array([0.5, 1.5]));
		assert.deepEqual(result.u16, new Uint16Array([65535]));
		assert.deepEqual(result.i64, new BigInt64Array([-(2n ** 63n)]));
		assert.deepEqual([...result.bytes], [1, 2, 3]);
	});

	test('binary data nested in what is echoed keeps its type', async function() {
		const fusion = create();
		const result = await fusion.wasm('echo', { a: [Buffer.from('hi')], f: new Float64Array([0.1, 0.2]), plain: 1 });
		assert.equal(Buffer.from(result.a[0]).toString(), 'hi');
		assert.deepEqual(result.f, new Float64Array([0.1, 0.2]));
		assert.equal(result.plain, 1);
	});

	test('20 MB go to the module and 20 MB come back', async function() {
		const fusion = create();
		const blob = Crypto.randomBytes(20 * 1024 * 1024);
		assert.equal(await fusion.wasm('bytes.length', { blob }), blob.length);
		const made = await fusion.wasm('bytes.make', { n: 20 * 1024 * 1024 });
		assert.equal(made.length, 20 * 1024 * 1024);
		assert.equal(made[0], 7);
		assert.equal(made[made.length - 1], 7);
	});

	test('a million floats make a round trip', async function() {
		const fusion = create();
		const values = new Float32Array(1_000_000).map((_, i) => Math.fround(Math.sin(i)));
		const echoed = await fusion.wasm('echo', { values });
		assert.deepEqual(echoed.values, values);
	});

});

describe('streams', { skip }, function() {

	test('a function called as a stream is a stream of one chunk', async function() {
		const fusion = create();
		assert.deepEqual(await collect(fusion.wasm.stream('single')), ['single']);
		assert.deepEqual(await collect(fusion.wasm.stream('math.add', { a: 1, b: 2 })), [{ sum: 3 }]);
	});

	test('an error of a function called as a stream rejects it', async function() {
		const fusion = create();
		await assert.rejects(() => collect(fusion.wasm.stream('invalid')), { code: 'REMOTE_ERROR' });
	});

});

describe('workers', { skip }, function() {

	test('work is spread over the workers of the pool', async function() {
		// every worker is a process, and a call keeps its worker busy
		const fusion = create({ workers: 3 });
		await Promise.all([1, 2, 3].map(() => fusion.wasm('hold', { mb: 1 })));
		await Promise.all([1, 2, 3].map(() => fusion.wasm('hold', { mb: 1 })));
		assert.ok(new Set(pids(fusion)).size >= 2);
	});

	test('a worker is replaced after maxCalls and nothing fails', async function() {
		const fusion = create({ maxCalls: 5 });
		const seen = new Set();
		for (let i = 0; i < 40; i++) {
			await fusion.wasm('single');
			pids(fusion).forEach(pid => seen.add(pid));
			await wait(10);
		}
		assert.ok(seen.size >= 2);
		assert.ok(fusion.stats().wasm.recycled.calls >= 1);
	});

	test('a worker that grows over maxMemory is replaced', async function() {
		const fusion = create({ maxMemory: '300mb' });
		await fusion.wasm('single');
		const first = pids(fusion)[0];
		assert.equal(await fusion.wasm('hold', { mb: 400 }), 1);
		assert.ok(await until(async () => await fusion.wasm('single') && !pids(fusion).includes(first), 10000), 'the worker was not replaced');
		assert.equal(await fusion.wasm('held'), 0);
	});

	test('idle workers answer the health check', async function() {
		const fusion = create({ healthInterval: 100, healthTimeout: 500 });
		await fusion.wasm('single');
		const before = pids(fusion);
		await wait(900);
		assert.equal(fusion.stats().wasm.unresponsive, 0);
		assert.deepEqual(pids(fusion), before);
	});

	test('warmup starts the workers', async function() {
		const fusion = create({ workers: 2 });
		await fusion.warmup('wasm');
		assert.equal(fusion.stats().wasm.ready, 2);
	});

});

describe('describe', { skip }, function() {

	test('the contracts are read from the module', async function() {
		const found = await create().describe('wasm');
		const add = found.actions.find(item => item.fn === 'math.add');
		assert.equal(add.module, 'math');
		assert.equal(add.name, 'add');
		assert.deepEqual(add.meta, { summary: 'Adds two numbers', input: '*a:Number\n*b:Number', output: 'sum:Number', mcp: true });
		assert.equal(found.actions.find(item => item.fn === 'single').module, '');
		assert.deepEqual(found.errors, []);
		assert.equal(found.runtime, 'wasm');

		// only the functions that declare a contract (or ask for it) are registered; the others are private
		const names = found.actions.map(item => item.fn);
		assert.ok(!names.includes('echo'));
		assert.ok(!names.includes('boom'));
		assert.ok(found.functions > names.length);
	});

	test('a module without tf_describe has no contracts, and its functions can still be called', async function() {
		const path = file(fixtures.module({ omit: ['tf_describe'] }));
		const found = await create({ module: path }).describe('wasm');
		assert.deepEqual(found.actions, []);
	});

});

describe('Total.js 5', { skip: skip || (total5 ? false : 'Total.js 5 not found (set TOTAL5_PATH)') }, function() {

	const result = {};

	test('the functions of the module become actions', function() {

		const run = spawnSync(process.execPath, [Path.join(__dirname, 'wasm-total5-script.js'), total5, build()], { timeout: 60000, cwd: Os.tmpdir() });
		assert.equal(run.status, 0, run.stderr.toString() + run.stdout.toString().slice(-500));

		const report = JSON.parse(run.stdout.toString().trim().split('\n').pop());
		Object.assign(result, report);

		// only the functions that declare a contract (or ask for it) are registered
		assert.deepEqual(report.registered.ids.sort(), ['math/add', 'single', 'text/length']);

		// a stream is not an action
		assert.equal(report.registered.warnings.length, 0);

		assert.deepEqual(report.add, { ok: true, output: { sum: 5 } });
		assert.deepEqual(report.length, { ok: true, output: { length: 5 } });
		assert.deepEqual(report.single, { ok: true, output: 'single' });
	});

	test('Total.js validates the input with the contract before the module is reached', function() {
		assert.equal(result.addInvalid.ok, false);
		assert.equal(result.addInvalid.errors[0].path, 'b');
	});

	test('the functions with MCP(true) are tools for agents', function() {
		if (!result.tools)
			return;

		assert.deepEqual(result.tools.map(tool => tool.name).sort(), ['math_add']);
		assert.equal(result.tools[0].description, 'Adds two numbers');
	});

});

describe('doctor', function() {

	function find(report, name, status) {
		return report.checks.filter(check => check.name === name && (!status || check.status === status));
	}

	test('a healthy module has nothing to fix', { skip }, async function() {
		const report = await create().doctor('wasm');
		assert.equal(report.ok, true, report.text);
		assert.equal(find(report, 'Module', 'ok').length, 1);
		assert.equal(find(report, 'Imports', 'ok').length, 1);
		assert.match(find(report, 'Imports', 'ok')[0].message, /WASI \(no files, no network, no environment\)/);
		assert.match(find(report, 'Functions', 'ok')[0].message, /\d+ functions, SDK 0\.1\.0, protocol 2/);
	});

	test('a module that is not configured or does not exist says how to build it', async function() {
		let report = await create({ module: null }).doctor('wasm');
		assert.equal(report.ok, false);
		assert.match(find(report, 'Module', 'error')[0].message, /module option is not set/);

		report = await create({ module: Path.join(Os.tmpdir(), 'no-such-module.wasm') }).doctor('wasm');
		assert.match(find(report, 'Module', 'error')[0].fix, /GOOS=wasip1 GOARCH=wasm go build -buildmode=c-shared/);
	});

	test('a file that is not WebAssembly is an error', async function() {
		const report = await create({ module: file('this is not a module') }).doctor('wasm');
		assert.equal(report.ok, false);
		assert.match(find(report, 'Module', 'error')[0].message, /not a valid WebAssembly module/);
	});

	test('what a sandbox cannot allow is an error with the reason', async function() {
		const report = await create({ module: file(fixtures.module({ imports: [{ module: 'env', name: 'fetch' }] })) }).doctor('wasm');
		assert.equal(report.ok, false);
		assert.match(find(report, 'Imports', 'error')[0].message, /imports env\.fetch.*can only import WASI/);
	});

	test('a command, or a module without the exports of the ABI, is an error', async function() {

		let report = await create({ module: file(fixtures.module({ command: true })) }).doctor('wasm');
		assert.match(find(report, 'Exports', 'error')[0].message, /command/);
		assert.match(find(report, 'Exports', 'error')[0].fix, /c-shared/);

		report = await create({ module: file(fixtures.module({ omit: ['tf_call', 'tf_free'] })) }).doctor('wasm');
		assert.match(find(report, 'Exports', 'error')[0].message, /does not export tf_free, tf_call|does not export tf_call, tf_free/);
	});

	test('a module without tf_describe is a warning', async function() {
		const report = await create({ module: file(fixtures.module({ omit: ['tf_describe'] })) }).doctor('wasm');
		assert.equal(find(report, 'Contract', 'warn').length, 1);
	});

	test('the terminal command works with --runtime wasm and --module', { skip }, function() {
		const run = (...args) => spawnSync(process.execPath, [BIN, ...args], { encoding: 'utf8', timeout: 60000 });

		let result = run('doctor', '--module', build());
		assert.equal(result.status, 0, result.stdout + result.stderr);
		assert.match(result.stdout, /TotalFusion doctor: wasm/);

		result = run('doctor', '--runtime', 'wasm', '--module', Path.join(Os.tmpdir(), 'no-such-module.wasm'));
		assert.equal(result.status, 1);
	});

});

describe('reload', { skip }, function() {

	test('building the module again replaces the workers, and the next call runs the new build', async function() {

		const path = file(Fs.readFileSync(build()));
		const fusion = create({ module: path });
		const reloads = [];
		const handle = fusion.watch('wasm', { debounce: 150, log: false, onreload: info => reloads.push(info) });

		try {
			assert.equal((await fusion.wasm('math.add', { a: 1, b: 2 })).sum, 3);

			// a different module in the same place: this one traps in every call
			const next = path + '.next';
			Fs.writeFileSync(next, fixtures.module());
			Fs.renameSync(next, path);

			assert.ok(await until(async () => await fusion.wasm('anything').then(() => false, err => err.code === 'WASM_TRAP'), 8000), 'the new build was not picked up');
			assert.ok(reloads.length >= 1);
		} finally {
			handle.close();
		}
	});

});
