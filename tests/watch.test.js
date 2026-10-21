'use strict';

const { test, describe, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const Path = require('path');
const Fs = require('fs');
const Os = require('os');
const { spawnSync } = require('child_process');
const build = require('./rust-build');
const total5 = require('./locate-total5')();
const { Fusion } = require('..');

const instances = [];
const handles = [];

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

function components(files) {
	const directory = Fs.mkdtempSync(Path.join(Os.tmpdir(), 'totalfusion-watch-'));
	for (const [name, content] of Object.entries(files))
		Fs.writeFileSync(Path.join(directory, name), content);
	return directory;
}

const VERSION = number => 'import os\n\n\ndef value(data):\n    return ' + number + '\n\n\ndef pid(data):\n    return os.getpid()\n';

function create(directory, options) {
	const fusion = new Fusion({ python: Object.assign({ path: directory, forwardStderr: false }, options) });
	instances.push(fusion);
	return fusion;
}

function watch(fusion, options) {
	const handle = fusion.watch('python', Object.assign({ debounce: 50, log: false }, options));
	handles.push(handle);
	return handle;
}

afterEach(async function() {
	handles.splice(0).forEach(handle => handle.close());
	await Promise.all(instances.splice(0).map(fusion => fusion.shutdown()));
});

describe('python', function() {

	test('an edit is in the next calls, in a new worker', async function() {
		const directory = components({ 'thing.py': VERSION(1) });
		const fusion = create(directory);
		watch(fusion);

		assert.equal(await fusion.python('thing.value'), 1);
		const before = await fusion.python('thing.pid');

		Fs.writeFileSync(Path.join(directory, 'thing.py'), VERSION(2));

		assert.ok(await until(async () => await fusion.python('thing.value') === 2, 5000), 'the edit was not picked up');
		assert.notEqual(await fusion.python('thing.pid'), before);
		assert.equal(fusion.stats().python.recycled.reload, 1);
	});

	test('no call fails while the workers are being replaced', async function() {

		const directory = components({ 'thing.py': VERSION(1) });
		const fusion = create(directory, { workers: 2 });
		watch(fusion);
		await fusion.warmup('python');

		let edited = false;
		const seen = new Set();
		const started = Date.now();

		while (Date.now() - started < 2000) {

			if (!edited && Date.now() - started > 300) {
				Fs.writeFileSync(Path.join(directory, 'thing.py'), VERSION(2));
				edited = true;
			}

			seen.add(await fusion.python('thing.value'));
			await wait(5);
		}

		assert.deepEqual(Array.from(seen).sort(), [1, 2]);
	});

	test('a file with an error does not take the rest down, and fixing it recovers', async function() {

		const directory = components({ 'thing.py': VERSION(1), 'other.py': 'def hello(data):\n    return "hi"\n' });
		const fusion = create(directory);
		watch(fusion);
		assert.equal(await fusion.python('thing.value'), 1);

		Fs.writeFileSync(Path.join(directory, 'thing.py'), 'def value(data:\n    return 5\n');
		assert.ok(await until(() => fusion.stats().python.recycled.reload >= 1, 5000));
		await wait(300);

		await assert.rejects(() => fusion.python('thing.value'), err => err.remote && err.remote.name === 'SyntaxError');
		assert.equal(await fusion.python('other.hello'), 'hi');

		Fs.writeFileSync(Path.join(directory, 'thing.py'), VERSION(3));
		assert.ok(await until(async () => (await fusion.python('thing.value').catch(() => null)) === 3, 5000), 'it did not recover');
	});

	test('a worker that cannot start leaves the old one serving, and the next edit still reloads', async function() {

		const directory = components({ 'thing.py': VERSION(1) });
		const fusion = create(directory, { preload: ['thing'] });
		watch(fusion);
		assert.equal(await fusion.python('thing.value'), 1);

		const warnings = [];
		const listener = warning => warnings.push(warning);
		process.on('warning', listener);

		// A syntax error in a preloaded module: the new worker cannot start
		Fs.writeFileSync(Path.join(directory, 'thing.py'), 'def value(data:\n    return 5\n');
		assert.ok(await until(() => warnings.some(warning => warning.name === 'TotalFusionWarning'), 8000), 'no warning');
		process.off('warning', listener);

		// The old worker keeps serving the old code
		assert.equal(await fusion.python('thing.value'), 1);

		// Fixing the file reloads at once, without waiting for the pause that follows a failed replacement
		Fs.writeFileSync(Path.join(directory, 'thing.py'), VERSION(4));
		assert.ok(await until(async () => (await fusion.python('thing.value').catch(() => null)) === 4, 8000), 'the fix was not picked up');
	});

	test('what is not Python code does not reload', async function() {
		const directory = components({ 'thing.py': VERSION(1) });
		const fusion = create(directory);
		const reloads = [];
		watch(fusion, { onreload: info => reloads.push(info) });
		await fusion.python('thing.value');

		Fs.writeFileSync(Path.join(directory, 'notes.txt'), 'hello');
		Fs.mkdirSync(Path.join(directory, '__pycache__'));
		Fs.writeFileSync(Path.join(directory, '__pycache__', 'thing.cpython.pyc'), 'x');
		Fs.writeFileSync(Path.join(directory, '.hidden.py'), 'x = 1');
		await wait(500);

		assert.equal(reloads.length, 0);
		assert.equal(fusion.stats().python.recycled.reload, 0);
	});

	test('many writes in a row are one reload', async function() {
		const directory = components({ 'thing.py': VERSION(1) });
		const fusion = create(directory);
		const reloads = [];
		watch(fusion, { debounce: 150, onreload: info => reloads.push(info) });
		await fusion.python('thing.value');

		for (let i = 2; i < 8; i++) {
			Fs.writeFileSync(Path.join(directory, 'thing.py'), VERSION(i));
			await wait(20);
		}

		assert.ok(await until(() => reloads.length >= 1, 3000));
		await wait(400);
		assert.equal(reloads.length, 1);
		assert.deepEqual(reloads[0].files, ['thing.py']);
		assert.equal(reloads[0].replaced, 1);
	});

	test('a new file is callable and close() stops watching', async function() {
		const directory = components({ 'thing.py': VERSION(1) });
		const fusion = create(directory);
		const reloads = [];
		const handle = watch(fusion, { onreload: info => reloads.push(info) });
		await fusion.python('thing.value');

		Fs.writeFileSync(Path.join(directory, 'added.py'), 'def hello(data):\n    return "new"\n');
		assert.ok(await until(() => reloads.length === 1, 3000));
		assert.equal(await fusion.python('added.hello'), 'new');

		handle.close();
		Fs.writeFileSync(Path.join(directory, 'thing.py'), VERSION(9));
		await wait(500);
		assert.equal(reloads.length, 1);
	});

	test('before the first call there is nothing to replace, and the first call has the new code', async function() {
		const directory = components({ 'thing.py': VERSION(1) });
		const fusion = create(directory);
		const reloads = [];
		watch(fusion, { onreload: info => reloads.push(info) });

		Fs.writeFileSync(Path.join(directory, 'thing.py'), VERSION(2));
		assert.ok(await until(() => reloads.length === 1, 3000));
		assert.equal(reloads[0].replaced, 0);
		assert.equal(await fusion.python('thing.value'), 2);
	});

	test('a runtime that does not exist or a directory that is missing is a clear error', function() {
		const fusion = create(Path.join(Os.tmpdir(), 'totalfusion-no-such-directory'));
		assert.throws(() => fusion.watch('cobol'), { code: 'NOT_FOUND' });
		assert.throws(() => fusion.watch('python'), { code: 'NOT_FOUND' });
	});

	test('shutdown stops the watchers', async function() {
		const directory = components({ 'thing.py': VERSION(1) });
		const fusion = create(directory);
		const reloads = [];
		watch(fusion, { onreload: info => reloads.push(info) });
		await fusion.shutdown();
		Fs.writeFileSync(Path.join(directory, 'thing.py'), VERSION(2));
		await wait(400);
		assert.equal(reloads.length, 0);
	});

});

describe('rust', { skip: build.skip() }, function() {

	test('building the worker again replaces it', async function() {

		const directory = Fs.mkdtempSync(Path.join(Os.tmpdir(), 'totalfusion-watch-rust-'));
		const file = Path.join(directory, process.platform === 'win32' ? 'worker.exe' : 'worker');
		Fs.copyFileSync(build(), file);
		Fs.chmodSync(file, 0o755);

		const fusion = new Fusion({ rust: { binary: file, forwardStderr: false } });
		instances.push(fusion);
		const reloads = [];
		handles.push(fusion.watch('rust', { debounce: 150, log: false, onreload: info => reloads.push(info) }));

		assert.deepEqual(await fusion.rust('math.add', { a: 1, b: 2 }), { sum: 3 });
		await assert.rejects(() => fusion.rust('collatz.longest', { limit: 100 }), { code: 'NOT_FOUND' });

		// cargo build ends by putting the new binary in place
		const next = file + '.next';
		Fs.copyFileSync(build.example(), next);
		Fs.chmodSync(next, 0o755);
		Fs.renameSync(next, file);

		assert.ok(await until(async () => await fusion.rust('collatz.longest', { limit: 100 }).then(() => true, () => false), 8000), 'the new worker was not picked up');
		await assert.rejects(() => fusion.rust('math.add', { a: 1, b: 2 }), { code: 'NOT_FOUND' });
		assert.ok(reloads.length >= 1);
	});

});

describe('Total.js 5', { skip: total5 ? false : 'Total.js 5 not found (set TOTAL5_PATH)' }, function() {

	test('the actions follow the code: changed, new and removed', function() {

		const result = spawnSync(process.execPath, [Path.join(__dirname, 'watch-script.js'), total5], { timeout: 60000, cwd: Os.tmpdir() });
		assert.equal(result.status, 0, result.stderr.toString() + result.stdout.toString().slice(-600));

		const report = JSON.parse(result.stdout.toString().trim().split('\n').pop());

		assert.deepEqual(report.first, { ok: true, output: 4 });

		// the same action, edited
		assert.deepEqual(report.edited, { ok: true, output: 6 });

		// and a new one
		assert.deepEqual(report.added, { ok: true, output: 15 });

		// removed from the code, removed from Total.js
		assert.equal(report.removed.double, false);
		assert.deepEqual(report.removed.triple, { ok: true, output: 15 });

		// a file with an error removes nothing and says what is wrong
		assert.equal(report.broken.stillThere, true);
		assert.equal(report.broken.errors.length, 1);
		assert.match(report.broken.errors[0].message, /SyntaxError/);

		// fixed
		assert.deepEqual(report.fixed, { ok: true, output: 20 });
	});

});
