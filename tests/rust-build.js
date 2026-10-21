'use strict';

// Builds the Rust worker of the tests once, with the toolchain of the machine. Without cargo the Rust tests are skipped.
const Path = require('path');
const Os = require('os');
const { execFileSync } = require('child_process');

const DIRECTORY = Path.join(__dirname, 'rust');
let built;

function cargo() {
	for (const command of [process.env.CARGO, 'cargo', Path.join(Os.homedir(), '.cargo', 'bin', 'cargo')]) {
		if (!command)
			continue;
		try {
			execFileSync(command, ['--version'], { stdio: 'ignore' });
			return command;
		} catch {}
	}
	return null;
}

// The path of the worker, or null if there is no Rust here
module.exports = function() {

	if (built !== undefined)
		return built;

	const command = cargo();

	if (!command)
		return built = null;

	execFileSync(command, ['build', '--release', '--quiet'], { cwd: DIRECTORY, stdio: 'pipe', timeout: 600000 });

	return built = Path.join(process.env.CARGO_TARGET_DIR || Path.join(DIRECTORY, 'target'), 'release', 'test-worker' + (process.platform === 'win32' ? '.exe' : ''));
};

module.exports.skip = () => module.exports() ? false : 'Rust is not installed (cargo was not found)';
