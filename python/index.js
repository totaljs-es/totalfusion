'use strict';

const Path = require('path');
const Fs = require('fs');
const { spawn } = require('child_process');
const { Pool } = require('../lib/pool');
const { FusionError } = require('../lib/errors');

const WORKER = Path.join(__dirname, 'worker.py');

// Explicit `python`, then a virtual environment, then TOTALFUSION_PYTHON, then the system Python.
// Nothing is ever installed automatically.
function interpreter(config) {

	if (config.python)
		return config.python;

	if (config.venv)
		return process.platform === 'win32' ? Path.join(config.venv, 'Scripts', 'python.exe') : Path.join(config.venv, 'bin', 'python');

	return process.env.TOTALFUSION_PYTHON || (process.platform === 'win32' ? 'python' : 'python3');
}

exports.create = function(config) {

	const python = interpreter(config);
	const root = Path.resolve(config.path || 'python');

	if (!Fs.existsSync(root))
		throw new FusionError('NOT_FOUND', 'The Python components directory "' + root + '" does not exist. Create it or set it with fusion.configure({ python: { path: \'...\' } })');

	return new Pool({
		name: 'python',
		workers: config.workers,
		timeout: config.timeout,
		maxQueue: config.maxQueue,
		startTimeout: config.startTimeout,
		cancelGrace: config.cancelGrace,
		forwardStderr: config.forwardStderr,
		hint: 'Python interpreter "' + python + '" not found. Install Python 3.9+ or set `python`, `venv` or TOTALFUSION_PYTHON',
		spawn: () => spawn(python, [WORKER, '--path', root], { cwd: root, env: config.env || process.env, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true })
	});
};
