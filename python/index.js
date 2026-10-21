'use strict';

const Path = require('path');
const Fs = require('fs');
const { spawn, execFile } = require('child_process');
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

function components(config) {

	const root = Path.resolve(config.path || 'python');

	if (!Fs.existsSync(root))
		throw new FusionError('NOT_FOUND', 'The Python components directory "' + root + '" does not exist. Create it or set it with fusion.configure({ python: { path: \'...\' } })');

	return root;
}

exports.create = function(config) {

	const python = interpreter(config);
	const root = components(config);
	const args = [WORKER, '--path', root];

	if (config.preload && config.preload.length)
		args.push('--preload', [].concat(config.preload).join(','));

	return new Pool({
		name: 'python',
		workers: config.workers,
		timeout: config.timeout,
		maxQueue: config.maxQueue,
		startTimeout: config.startTimeout,
		cancelGrace: config.cancelGrace,
		maxCalls: config.maxCalls,
		maxMemory: config.maxMemory,
		healthInterval: config.healthInterval,
		healthTimeout: config.healthTimeout,
		forwardStderr: config.forwardStderr,
		hint: 'Python interpreter "' + python + '" not found. Install Python 3.9+ or set `python`, `venv` or TOTALFUSION_PYTHON',
		spawn: () => spawn(python, args, { cwd: root, env: config.env || process.env, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true })
	});
};

// Reads the @action contracts of the components with a one-shot process. Nothing is imported or executed.
// Resolves { actions: [{ fn, module, name, async, doc, meta }], startups: [module], errors: [] }
exports.describe = function(config) {

	const python = interpreter(config);
	const root = components(config);

	return new Promise(function(resolve, reject) {
		execFile(python, [WORKER, '--path', root, '--describe'], { cwd: root, env: config.env || process.env, maxBuffer: 16 * 1024 * 1024, windowsHide: true }, function(err, stdout, stderr) {

			if (err) {
				return reject(new FusionError(err.code === 'ENOENT' ? 'SPAWN_FAILED' : 'START_FAILED', 'Cannot describe the Python components: ' + err.message + (stderr ? '\n' + stderr : ''), { cause: err }));
			}

			try {
				resolve(JSON.parse(stdout));
			} catch (e) {
				reject(new FusionError('START_FAILED', 'Invalid output from the Python describe process: ' + e.message));
			}
		});
	});
};
