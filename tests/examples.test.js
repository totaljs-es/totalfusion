'use strict';

// The scripts of examples/ are what a person (or an agent) copies first, so they are run for real. They work from a copy of the
// folder where `require('..')` is TotalFusion, and the Go modules find the SDK where their go.mod says.

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const Path = require('path');
const Fs = require('fs');
const Os = require('os');
const { spawnSync, execFileSync } = require('child_process');
const go = require('./go-build');
const wasm = require('./wasm-build');

const ROOT = Path.join(__dirname, '..');
let directory;

before(function() {

	directory = Fs.mkdtempSync(Path.join(Os.tmpdir(), 'totalfusion-examples-'));

	Fs.cpSync(Path.join(ROOT, 'examples'), Path.join(directory, 'examples'), { recursive: true, filter: file => !/(node_modules|target|\.DS_Store|\.map$|\.wasm$)/.test(file) && !/examples[\\/]go[\\/]worker/.test(file) });

	// require('..') from examples/ is the folder above: here it is the repository
	Fs.writeFileSync(Path.join(directory, 'index.js'), 'module.exports = require(' + JSON.stringify(ROOT) + ');\n');

	// the go.mod of the examples point to ../../go
	const type = process.platform === 'win32' ? 'junction' : 'dir';
	Fs.symlinkSync(Path.join(ROOT, 'go'), Path.join(directory, 'go'), type);
	Fs.symlinkSync(Path.join(ROOT, 'rust'), Path.join(directory, 'rust'), type);
});

after(function() {
	Fs.rmSync(directory, { recursive: true, force: true });
});

function run(script) {
	const result = spawnSync(process.execPath, [Path.join(directory, 'examples', script)], { cwd: directory, encoding: 'utf8', timeout: 90000 });
	assert.equal(result.status, 0, script + ' failed:\n' + result.stdout + result.stderr);
	return result.stdout;
}

function build(command, example, args, env) {
	execFileSync(command, args, { cwd: Path.join(directory, 'examples', example), stdio: 'pipe', timeout: 600000, env: Object.assign({}, process.env, env) });
}

describe('the scripts for Node.js', function() {

	test('basic.js calls Python and shows what an error looks like', function() {
		const output = run('basic.js');
		assert.match(output, /success: true, words: 5, longest: 'TotalFusion'/);
		assert.match(output, /REMOTE_ERROR - AttributeError/);
	});

	test('streaming.js reads a generator and stops it when the loop is left', function() {
		const output = run('streaming.js');
		assert.equal((output.match(/\{ tick: \d, at: /g) || []).length, 5);
		assert.match(output, /stopped after 3 chunks of 1000; the worker is free again: pong/);
	});

	test('the scripts of the workers say how to build them when there is nothing built', function() {
		for (const script of ['go.js', 'rust.js', 'wasm.js']) {
			const result = spawnSync(process.execPath, [Path.join(directory, 'examples', script)], { cwd: directory, encoding: 'utf8', timeout: 30000 });
			assert.equal(result.status, 1, script);
			assert.match(result.stderr, /not built yet/, script);
		}
	});

});

describe('the Go worker', { skip: go.skip() }, function() {

	test('go.js calls it, shows the error of the caller and the doctor says it is in order', function() {

		build(go.command(), 'go', ['build', '-o', 'worker' + (process.platform === 'win32' ? '.exe' : '')]);

		const output = run('go.js');
		assert.match(output, /\{ number: 2298025, steps: 560 \}/);
		assert.match(output, /ValueError: limit must be a number greater than 1/);
		assert.match(output, /Everything is in order/);
	});

});

describe('the module of WebAssembly', { skip: wasm.skip() }, function() {

	test('wasm.js calls it in the sandbox', function() {

		build(wasm.command(), 'wasm', ['build', '-buildmode=c-shared', '-o', 'module.wasm'], { GOOS: 'wasip1', GOARCH: 'wasm' });

		const output = run('wasm.js');
		assert.match(output, /\{ number: 2298025, steps: 560 \}/);
		assert.match(output, /ValueError: limit must be a number greater than 1/);
		assert.match(output, /Everything is in order/);
	});

});
