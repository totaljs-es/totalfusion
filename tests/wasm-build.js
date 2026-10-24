'use strict';

// Builds the WebAssembly module of the tests once, with the Go of the machine (1.24 or newer: it is the first with //go:wasmexport).
// Without it the tests that need the module are skipped.
const Path = require('path');
const Os = require('os');
const { execFileSync } = require('child_process');

const DIRECTORY = Path.join(__dirname, 'wasm');
let built;

function go() {
	for (const command of [process.env.GO, 'go', Path.join(Os.homedir(), 'go', 'bin', 'go'), '/usr/local/go/bin/go']) {

		if (!command)
			continue;

		try {
			const match = /go(\d+)\.(\d+)/.exec(execFileSync(command, ['version'], { encoding: 'utf8' }));

			if (match && (+match[1] > 1 || +match[2] >= 24))
				return command;
		} catch {}
	}

	return null;
}

// The path of the module, or null if there is no Go that can build it
module.exports = function() {

	if (built !== undefined)
		return built;

	const command = go();

	if (!command)
		return built = null;

	const file = Path.join(Os.tmpdir(), 'totalfusion-wasm-' + process.pid + '.wasm');

	// Best effort: a file in use cannot be removed on every system
	process.on('exit', () => { try { require('fs').rmSync(file, { force: true }); } catch {} });

	execFileSync(command, ['build', '-buildmode=c-shared', '-o', file, '.'], { cwd: DIRECTORY, stdio: 'pipe', timeout: 600000, env: Object.assign({}, process.env, { GOOS: 'wasip1', GOARCH: 'wasm' }) });

	return built = file;
};

module.exports.skip = () => module.exports() ? false : 'Go 1.24 or newer is not installed (it is needed to build the WebAssembly module of the tests)';
