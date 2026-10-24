'use strict';

const Path = require('path');
const Fs = require('fs');
const { spawn, execFile } = require('child_process');
const { Pool, bytes } = require('../lib/pool');
const { FusionError } = require('../lib/errors');
const { Report } = require('../lib/doctor');
const { poolOptions } = require('../lib/options');
const { VERSION } = require('../lib/protocol');

// A WebAssembly worker is a .wasm module that exports its functions (the ABI is in docs/webassembly.md). Node.js runs it in
// a process of its own (wasm/host.js), so a function that never returns is killed like in any other runtime, and the module
// is a sandbox: no files, no network, no environment.
const HOST = Path.join(__dirname, 'host.js');
const WASI = 'wasi_snapshot_preview1';
const REQUIRED = ['memory', 'tf_abi', 'tf_alloc', 'tf_free', 'tf_call'];

function wasmFile(config) {

	if (!config.module)
		throw new FusionError('INVALID_CONFIG', 'The WebAssembly module is not configured: set the module option to the path of the .wasm file');

	return Path.resolve(config.module);
}

function missing(file) {
	return new FusionError('NOT_FOUND', 'The WebAssembly module "' + file + '" does not exist');
}

exports.create = function(config) {

	const file = wasmFile(config);

	if (!Fs.existsSync(file))
		throw missing(file);

	return new Pool(Object.assign(poolOptions('wasm', config), {
		hint: 'The WebAssembly module "' + file + '" cannot be started: run npx totalfusion doctor --runtime wasm --module ' + file,
		// --no-warnings: the WASI of Node.js is flagged as experimental and the warning would go to every log
		spawn: () => spawn(process.execPath, ['--no-warnings', HOST, file], { cwd: config.cwd || Path.dirname(file), env: config.env || process.env, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true })
	}));
};

// What to watch to reload the workers when the module is built again: the .wasm file
exports.watchTarget = function(config) {

	const file = wasmFile(config);

	return { path: Path.dirname(file), recursive: false, accept: name => name === Path.basename(file) };
};

function describe(file, config) {
	return new Promise(function(resolve, reject) {
		execFile(process.execPath, ['--no-warnings', HOST, file, '--describe'], { cwd: config.cwd || Path.dirname(file), env: config.env || process.env, timeout: 30000, maxBuffer: 16 * 1024 * 1024, windowsHide: true }, function(err, stdout, stderr) {

			if (err)
				return reject(new FusionError('START_FAILED', 'Cannot describe the WebAssembly module "' + file + '": ' + (stderr ? stderr.trim() : err.message), { cause: err }));

			try {
				resolve(JSON.parse(stdout));
			} catch (e) {
				reject(new FusionError('START_FAILED', 'Invalid output describing "' + file + '": ' + e.message));
			}
		});
	});
}

// The contracts of the functions, as the module declares them. Nothing is called except tf_describe.
// Resolves { actions: [{ fn, module, name, async, stream, doc, meta }], startups: [], errors: [] }
exports.describe = function(config) {

	const file = wasmFile(config);

	if (!Fs.existsSync(file))
		return Promise.reject(missing(file));

	return describe(file, config);
};

// Looks at the module (its format, imports and exports) and at what it declares.
exports.doctor = async function(config) {

	const report = new Report('wasm');
	report.python = null;

	try {
		bytes(config.maxMemory);
	} catch (err) {
		report.add('error', 'Configuration', err.message);
	}

	if (!config.module) {
		report.add('error', 'Module', 'The module option is not set', 'Set it to the path of the .wasm file, for example ./wasm/module.wasm');
		return report;
	}

	const file = wasmFile(config);

	if (!Fs.existsSync(file)) {
		report.add('error', 'Module', '"' + file + '" does not exist', 'Build it for the target of WebAssembly: Go: GOOS=wasip1 GOARCH=wasm go build -buildmode=c-shared -o module.wasm');
		return report;
	}

	const data = Fs.readFileSync(file);
	let compiled;

	try {
		compiled = new WebAssembly.Module(data);
	} catch (err) {
		report.add('error', 'Module', '"' + file + '" is not a valid WebAssembly module: ' + err.message);
		return report;
	}

	report.add('ok', 'Module', file + ' (' + Math.round(data.length / 1024) + ' KB)');

	const imports = WebAssembly.Module.imports(compiled);
	const exported = new Set(WebAssembly.Module.exports(compiled).map(item => item.name));
	const foreign = imports.filter(item => item.module !== WASI);

	if (foreign.length) {
		report.add('error', 'Imports', 'The module imports ' + foreign.slice(0, 3).map(item => item.module + '.' + item.name).join(', ') + (foreign.length > 3 ? ' and ' + (foreign.length - 3) + ' more' : '') + ': a sandboxed module can only import WASI', 'Build the module for WASI (GOOS=wasip1) or without imports (wasm32-unknown-unknown with no_std).');
		return report;
	}

	report.add('ok', 'Imports', imports.length ? imports.length + ' functions of WASI (no files, no network, no environment)' : 'none');

	const lacking = REQUIRED.filter(name => !exported.has(name));

	if (exported.has('_start'))
		report.add('error', 'Exports', 'The module is a command (it exports _start): it has to be a reactor, a library that exports its functions', 'Go: -buildmode=c-shared. Rust: crate-type = ["cdylib"].');
	else if (lacking.length)
		report.add('error', 'Exports', 'The module does not export ' + lacking.join(', '), 'These are the functions that the ABI of TotalFusion needs, see docs/webassembly.md');
	else
		report.add('ok', 'Exports', 'memory, tf_abi, tf_alloc, tf_free, tf_call' + (exported.has('tf_describe') ? ', tf_describe' : ''));

	if (report.checks.some(check => check.status === 'error'))
		return report;

	if (!exported.has('tf_describe'))
		report.add('warn', 'Contract', 'The module does not export tf_describe: its functions can be called from JavaScript, but none becomes an action of Total.js');

	let found;

	try {
		found = await describe(file, config);
	} catch (err) {
		report.add('error', 'Module', err.message.split('\n')[0]);
		return report;
	}

	const streams = found.actions.filter(item => item.stream).length;

	report.add(found.actions.length ? 'ok' : 'warn', 'Functions', found.actions.length + (found.actions.length === 1 ? ' function' : ' functions') + (found.sdk ? ', SDK ' + found.sdk : '') + ', protocol ' + found.protocol, found.actions.length || !exported.has('tf_describe') ? null : 'Declare the contracts of the functions.');

	if (streams)
		report.add('warn', 'Functions', streams + ' of them declared as a stream: a WebAssembly module answers once per call, a stream is delivered as one chunk');

	for (const item of found.errors)
		report.add('error', 'Functions', item.function + ': ' + item.message);

	for (const warning of require('../total5').lint ? found.actions.flatMap(item => require('../total5').lint(item.fn, item.meta)) : [])
		report.add('warn', 'Contract', warning.id + ': ' + warning.message);

	if (found.protocol !== VERSION)
		report.add('error', 'Protocol', 'The module declares protocol ' + found.protocol + ' and this version of TotalFusion speaks ' + VERSION);

	return report;
};
