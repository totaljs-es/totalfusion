'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const Path = require('path');
const Fs = require('fs');
const { execFileSync } = require('child_process');

const ROOT = Path.join(__dirname, '..');

function pack() {
	const output = execFileSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['pack', '--dry-run', '--json', '--ignore-scripts'], { cwd: ROOT, encoding: 'utf8', shell: process.platform === 'win32' });
	return JSON.parse(output)[0].files.map(file => file.path.replace(/\\/g, '/'));
}

test('everything the code needs is in the package', function() {

	const files = new Set(pack());

	// What a file of the package requires with a relative path must be in the package too
	for (const file of files) {

		if (!file.endsWith('.js'))
			continue;

		const source = Fs.readFileSync(Path.join(ROOT, file), 'utf8');

		for (const match of source.matchAll(/require\('(\.{1,2}\/[^']*)'\)/g)) {

			const target = Path.posix.normalize(Path.posix.join(Path.posix.dirname(file), match[1]));
			const found = [target, target + '.js', target + '.json', target + '/index.js'].some(candidate => files.has(candidate));

			assert.ok(found, file + ' requires ' + match[1] + ', which is not in the package');
		}
	}

	// The workers and what they read
	for (const needed of ['python/worker.py', 'python/pip-names.json', 'python/sdk/totalfusion.py', 'rust/Cargo.toml', 'rust/src/lib.rs', 'bin/totalfusion.js', 'total5/flow/python.html', 'LICENSE', 'README.md', 'CHANGELOG.md'])
		assert.ok(files.has(needed), needed + ' is not in the package');
});

test('the package does not ship tests, examples or build output', function() {
	const files = pack();
	assert.deepEqual(files.filter(file => /^(tests|examples|\.github)\/|target\/|node_modules\/|__pycache__\/|\.pyc$|Cargo\.lock$/.test(file)), []);
});

test('Python bytecode that is lying around does not get into the package', function() {

	// Running a worker by hand leaves __pycache__ next to the code, and npm ignores .gitignore for the folders it is told to pack
	const directories = [Path.join(ROOT, 'python', '__pycache__'), Path.join(ROOT, 'python', 'sdk', '__pycache__')];

	try {
		for (const directory of directories) {
			Fs.mkdirSync(directory, { recursive: true });
			Fs.writeFileSync(Path.join(directory, 'stray.cpython-315.pyc'), 'x');
		}

		assert.deepEqual(pack().filter(file => /__pycache__|\.pyc$/.test(file)), []);

	} finally {
		for (const directory of directories)
			Fs.rmSync(directory, { recursive: true, force: true });
	}
});

test('the version of the package and of the crate are the same', function() {
	const version = JSON.parse(Fs.readFileSync(Path.join(ROOT, 'package.json'), 'utf8')).version;
	const crate = /^version = "([^"]+)"/m.exec(Fs.readFileSync(Path.join(ROOT, 'rust', 'Cargo.toml'), 'utf8'))[1];
	assert.equal(crate, version);
});

test('the command is executable code with a shebang', function() {
	const source = Fs.readFileSync(Path.join(ROOT, 'bin', 'totalfusion.js'), 'utf8');
	assert.ok(source.startsWith('#!/usr/bin/env node'));
	assert.equal(JSON.parse(Fs.readFileSync(Path.join(ROOT, 'package.json'), 'utf8')).bin.totalfusion, 'bin/totalfusion.js');
});

test('the changelog describes the version', function() {
	const version = JSON.parse(Fs.readFileSync(Path.join(ROOT, 'package.json'), 'utf8')).version;
	assert.match(Fs.readFileSync(Path.join(ROOT, 'CHANGELOG.md'), 'utf8'), new RegExp('^## ' + version.replace(/\./g, '\\.') + '$', 'm'));
});
