'use strict';

// Builds the Go worker of the tests once, with the toolchain of the machine. Without go the Go tests are skipped.
const Path = require('path');
const Os = require('os');
const { execFileSync } = require('child_process');

const DIRECTORY = Path.join(__dirname, 'go');
const OUTPUT = Path.join(Os.tmpdir(), 'totalfusion-go-' + process.pid);
let built;

// The workers are built in a folder of this process, which goes away with it (best effort: a program that is running cannot be removed on every system)
process.on('exit', () => { try { require('fs').rmSync(OUTPUT, { recursive: true, force: true }); } catch {} });

function go() {
	for (const command of [process.env.GO, 'go', Path.join(Os.homedir(), 'go', 'bin', 'go'), '/usr/local/go/bin/go']) {
		if (!command)
			continue;
		try {
			execFileSync(command, ['version'], { stdio: 'ignore' });
			return command;
		} catch {}
	}
	return null;
}

function compile(command, directory, name) {
	const file = Path.join(OUTPUT, name + (process.platform === 'win32' ? '.exe' : ''));
	execFileSync(command, ['build', '-o', file, '.'], { cwd: directory, stdio: 'pipe', timeout: 600000 });
	return file;
}

// The path of the worker, or null if there is no Go here
module.exports = function() {

	if (built !== undefined)
		return built;

	const command = go();

	if (!command)
		return built = null;

	return built = compile(command, DIRECTORY, 'test-worker');
};

// A second, different worker: the example of the repository
let example;

module.exports.example = function() {

	if (example !== undefined)
		return example;

	const command = module.exports() && go();

	if (!command)
		return example = null;

	return example = compile(command, Path.join(__dirname, '..', 'examples', 'go'), 'worker');
};

// The same worker built for another system, to test what the doctor says about it (Go builds for any system from any system)
const crossed = {};

module.exports.cross = function(goos, goarch) {

	const key = goos + '/' + goarch;

	if (crossed[key] !== undefined)
		return crossed[key];

	const command = go();

	if (!command)
		return crossed[key] = null;

	const file = Path.join(OUTPUT, 'test-worker-' + goos + '-' + goarch + (goos === 'windows' ? '.exe' : ''));
	execFileSync(command, ['build', '-o', file, '.'], { cwd: DIRECTORY, stdio: 'pipe', timeout: 600000, env: Object.assign({}, process.env, { GOOS: goos, GOARCH: goarch, CGO_ENABLED: '0' }) });

	return crossed[key] = file;
};

module.exports.skip = () => module.exports() ? false : 'Go is not installed (the go command was not found)';
