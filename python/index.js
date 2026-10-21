'use strict';

const Path = require('path');
const Fs = require('fs');
const { spawn, execFile } = require('child_process');
const { Pool, bytes } = require('../lib/pool');
const { FusionError } = require('../lib/errors');
const { Report, shell } = require('../lib/doctor');
const { poolOptions } = require('../lib/options');
const PIP_NAMES = require('./pip-names.json');

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

function source(config) {

	if (config.python)
		return 'the python option';

	if (config.venv)
		return 'the venv option';

	if (process.env.TOTALFUSION_PYTHON)
		return 'TOTALFUSION_PYTHON';

	return 'the default';
}

// What to do when a library is missing: install it in the interpreter that runs the workers, not in another one
function installHint(config) {
	const python = interpreter(config);
	return name => '"' + name + '" is not installed in the Python that runs the workers (' + python + '). Install it with: ' + shell(python) + ' -m pip install ' + (PIP_NAMES[name] || name);
}

function components(config) {

	const root = Path.resolve(config.path || 'python');

	if (!Fs.existsSync(root))
		throw new FusionError('NOT_FOUND', 'The Python components directory "' + root + '" does not exist. Create it or set it with fusion.configure({ python: { path: \'...\' } })');

	return root;
}

exports.installHint = installHint;

exports.create = function(config) {

	const python = interpreter(config);
	const root = components(config);
	const args = [WORKER, '--path', root];

	if (config.preload && config.preload.length)
		args.push('--preload', [].concat(config.preload).join(','));

	return new Pool(Object.assign(poolOptions('python', config), {
		installHint: installHint(config),
		hint: 'Python interpreter "' + python + '" not found. Install Python 3.9+ or set `python`, `venv` or TOTALFUSION_PYTHON',
		spawn: () => spawn(python, args, { cwd: root, env: config.env || process.env, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true })
	}));
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

const PROBE = 'import json, sys; print(json.dumps({"version": list(sys.version_info[:3]), "executable": sys.executable, "prefix": sys.prefix, "base_prefix": getattr(sys, "base_prefix", sys.prefix)}))';

function run(command, args, options) {
	return new Promise((resolve, reject) => execFile(command, args, Object.assign({ maxBuffer: 16 * 1024 * 1024, windowsHide: true }, options), (err, stdout, stderr) => err ? reject(Object.assign(err, { stderr })) : resolve(stdout)));
}

// Looks at the interpreter, the components and the libraries they need. Nothing is imported, run or installed.
exports.doctor = async function(config) {

	const report = new Report('python');
	const command = interpreter(config);
	const origin = source(config);
	const fixes = {
		'the venv option': 'Create it with: python3 -m venv ' + shell(config.venv || ''),
		'the python option': 'Check the path of the python option.',
		'TOTALFUSION_PYTHON': 'Check the TOTALFUSION_PYTHON variable.'
	};

	// Configuration that would fail later
	try {
		bytes(config.maxMemory);
	} catch (err) {
		report.add('error', 'Configuration', err.message);
	}

	// 1. The interpreter
	let probe;

	try {
		probe = JSON.parse(await run(command, ['-c', PROBE]));
	} catch (err) {
		report.add('error', 'Interpreter', err.code === 'ENOENT' ? '"' + command + '" was not found (chosen by ' + origin + ')' : 'Cannot run "' + command + '" (chosen by ' + origin + '): ' + err.message, fixes[origin] || 'Install Python 3.9 or newer, or set the python or venv option.');
		return report;
	}

	const version = probe.version.join('.');
	report.python = { command, source: origin, version, executable: probe.executable, venv: probe.prefix !== probe.base_prefix };

	if (probe.version[0] < 3 || (probe.version[0] === 3 && probe.version[1] < 9)) {
		report.add('error', 'Interpreter', 'Python ' + version + ' is too old (' + probe.executable + ', chosen by ' + origin + ')', 'TotalFusion needs Python 3.9 or newer.');
		return report;
	}

	report.add('ok', 'Interpreter', 'Python ' + version + ' (' + probe.executable + ', chosen by ' + origin + ')');

	if (report.python.venv)
		report.add('ok', 'Environment', 'Virtual environment ' + probe.prefix);
	else
		report.add('warn', 'Environment', 'This is a Python of the system, not a virtual environment: the libraries you install are shared with everything else', 'python3 -m venv .venv, install the libraries in it and set the venv option.');

	// 2. The components
	const root = Path.resolve(config.path || 'python');

	if (!Fs.existsSync(root)) {
		report.add('error', 'Components', 'The directory "' + root + '" does not exist', 'Create it or set it with the path option.');
		return report;
	}

	for (const name of [].concat(config.preload || [])) {
		const base = Path.join(root, ...name.split('.'));
		if (!Fs.existsSync(base + '.py') && !Fs.existsSync(base))
			report.add('error', 'Preload', 'The module "' + name + '" of the preload option does not exist in ' + root, 'Check the name of the module.');
	}

	// 3. The worker looks at the components with the same interpreter that will run them
	let result;

	try {
		const args = [WORKER, '--path', root, '--doctor'];

		if (config.requirements)
			args.push('--requirements', Path.resolve(config.requirements));

		result = JSON.parse(await run(command, args, { cwd: root, env: config.env || process.env }));
	} catch (err) {
		report.add('error', 'Components', 'The diagnosis of the components failed: ' + (err.stderr || err.message).trim().split('\n').pop());
		return report;
	}

	const actions = result.contracts.actions;
	report.add(result.modules ? 'ok' : 'warn', 'Components', result.modules + (result.modules === 1 ? ' module' : ' modules') + ' in ' + root + ', ' + actions.length + (actions.length === 1 ? ' action' : ' actions') + ' (' + actions.filter(item => item.stream).length + ' streaming)', result.modules ? null : 'Put the .py files of your components in that directory.');

	for (const item of result.syntax)
		report.add('error', 'Syntax', item.module + ': ' + item.message, 'Fix the error in ' + item.module + '.py.');

	// The syntax errors are already reported above: here only the contracts that could not be read
	for (const item of result.contracts.errors.filter(item => item.function))
		report.add('warn', 'Contract', item.module + '.' + item.function + ': ' + item.message);

	// 4. The libraries they import
	const required = result.missing.filter(item => !item.optional);
	const optional = result.missing.filter(item => item.optional);
	const install = list => shell(command) + ' -m pip install ' + list.map(item => item.pip).join(' ');
	const describe = list => list.map(item => item.name + (item.name === item.pip ? '' : ' (pip: ' + item.pip + ')') + ' used by ' + item.files.join(', ')).join('; ');

	if (required.length)
		report.add('error', 'Libraries', 'Not installed: ' + describe(required), install(required));
	else
		report.add('ok', 'Libraries', 'Everything the components import can be found');

	if (optional.length)
		report.add('warn', 'Libraries', 'Optional, not installed: ' + describe(optional));

	// 5. requirements.txt
	const requirements = result.requirements;

	if (requirements.file) {

		const problems = requirements.items.filter(item => item.status === 'missing' || item.status === 'version');
		const skipped = requirements.items.filter(item => item.status === 'skipped').length;

		if (problems.length) {
			report.add('error', 'Requirements', Path.basename(requirements.file) + ': ' + problems.map(item => item.status === 'missing' ? item.name + ' is not installed' : item.name + ' ' + item.installed + ' does not satisfy ' + item.spec).join('; '), shell(command) + ' -m pip install -r ' + shell(requirements.file));
		} else {
			const checked = requirements.items.length - skipped;
			report.add('ok', 'Requirements', Path.basename(requirements.file) + ': ' + checked + (checked === 1 ? ' requirement is' : ' requirements are') + ' installed' + (skipped ? ' (' + skipped + ' not checked)' : ''));
		}
	}

	// 6. Limits that need something of the platform
	if (config.maxMemory && !result.memory)
		report.add('warn', 'Memory', 'This system does not report the memory of a process: maxMemory will have no effect');

	return report;
};
