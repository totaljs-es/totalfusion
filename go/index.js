'use strict';

const Path = require('path');
const Fs = require('fs');
const Os = require('os');
const Crypto = require('crypto');
const { spawn, execFile } = require('child_process');
const { Pool, bytes } = require('../lib/pool');
const { FusionError } = require('../lib/errors');
const { Report, shell, target, compatibility } = require('../lib/doctor');
const { poolOptions } = require('../lib/options');
const { VERSION } = require('../lib/protocol');

// A Go worker is a binary built with the `totalfusion` module (see go/go.mod). Nothing is compiled here:
// the binary is built by you (go build) or comes precompiled, for the system where it runs.
function binary(config) {

	if (!config.binary)
		throw new FusionError('INVALID_CONFIG', 'The Go worker is not configured: set the binary option to the path of the compiled worker. Build it with: go build -o worker');

	let file = Path.resolve(config.binary);

	// On Windows the extension may be left out
	if (process.platform === 'win32' && !/\.exe$/i.test(file) && Fs.existsSync(file + '.exe'))
		file += '.exe';

	return file;
}

// Windows does not let anything overwrite or delete an executable that is running, so `go build` could not replace your worker
// while it is in use, and a reload would never see the new build. So on Windows (and when `shadowCopy` is true) the worker runs
// from a copy, and the file you build stays free. The copy is named after the modification time and the size of the original,
// so a new build is a new copy and the old ones are removed when no worker uses them.
function executable(file, config) {

	if (!(config.shadowCopy != null ? config.shadowCopy : process.platform === 'win32'))
		return file;

	const stat = Fs.statSync(file);
	const directory = Path.join(Os.tmpdir(), 'totalfusion-shadow', Crypto.createHash('sha1').update(file).digest('hex').slice(0, 12));
	const copy = Path.join(directory, Math.floor(stat.mtimeMs) + '-' + stat.size + Path.extname(file));

	if (!Fs.existsSync(copy)) {

		Fs.mkdirSync(directory, { recursive: true });

		// Copied under another name and moved into place: a worker that starts at the same time never runs half a file
		const partial = copy + '.' + Crypto.randomBytes(4).toString('hex') + '.tmp';
		Fs.copyFileSync(file, partial);
		Fs.chmodSync(partial, 0o755);

		try {
			Fs.renameSync(partial, copy);
		} catch {
			// Another worker put its copy there first (and may be running it)
			Fs.rmSync(partial, { force: true });
		}
	}

	// The copies of earlier builds go away if nobody is running them (the system refuses to delete the ones in use)
	for (const name of Fs.readdirSync(directory)) {

		if (Path.join(directory, name) === copy)
			continue;

		try {
			Fs.rmSync(Path.join(directory, name), { force: true });
		} catch {
			// In use: it goes away next time
		}
	}

	return copy;
}

function missing(file) {
	return new FusionError('NOT_FOUND', 'The Go worker "' + file + '" does not exist. Build it with: go build -o worker');
}

exports.create = function(config) {

	const file = binary(config);

	if (!Fs.existsSync(file))
		throw missing(file);

	return new Pool(Object.assign(poolOptions('go', config), {
		hint: 'The Go worker "' + file + '" cannot be started: is it built for this system (' + process.platform + ', ' + process.arch + ')? Build it with: go build -o worker',
		spawn: () => spawn(executable(file, config), config.args || [], { cwd: config.cwd || Path.dirname(file), env: config.env || process.env, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true })
	}));
};

// What to watch to reload the workers when the worker is built again: the binary
exports.watchTarget = function(config) {

	const file = binary(config);

	return { path: Path.dirname(file), recursive: false, accept: name => name === Path.basename(file) };
};

function describe(file, config) {
	return new Promise(function(resolve, reject) {
		execFile(file, ['--describe'], { cwd: config.cwd || Path.dirname(file), env: config.env || process.env, timeout: 15000, maxBuffer: 16 * 1024 * 1024, windowsHide: true }, function(err, stdout, stderr) {

			if (err)
				return reject(new FusionError(err.code === 'ENOENT' ? 'SPAWN_FAILED' : 'START_FAILED', 'Cannot describe the Go worker "' + file + '": ' + err.message + (stderr ? '\n' + stderr : ''), { cause: err }));

			try {
				resolve(JSON.parse(stdout));
			} catch (e) {
				reject(new FusionError('START_FAILED', 'Invalid output from "' + file + ' --describe": ' + e.message));
			}
		});
	});
}

// The contracts of the functions, as the worker declares them. The binary is asked, it does not run any function.
// Resolves { actions: [{ fn, module, name, async, stream, doc, meta }], startups: [], errors: [] }
exports.describe = function(config) {

	const file = binary(config);

	if (!Fs.existsSync(file))
		return Promise.reject(missing(file));

	return describe(file, config);
};

// Looks at the binary and at what it declares. Nothing is run except `--describe`.
exports.doctor = async function(config) {

	const report = new Report('go');

	try {
		bytes(config.maxMemory);
	} catch (err) {
		report.add('error', 'Configuration', err.message);
	}

	if (!config.binary) {
		report.add('error', 'Binary', 'The binary option is not set', 'Set it to the path of the compiled worker, for example ./worker/worker');
		return report;
	}

	let file;

	try {
		file = binary(config);
	} catch (err) {
		report.add('error', 'Binary', err.message);
		return report;
	}

	if (!Fs.existsSync(file)) {
		report.add('error', 'Binary', '"' + file + '" does not exist', 'Build it: go build -o worker (in the folder of your worker)');
		return report;
	}

	const stat = Fs.statSync(file);
	report.python = null;

	if (!stat.isFile()) {
		report.add('error', 'Binary', '"' + file + '" is not a file');
		return report;
	}

	if (process.platform !== 'win32') {
		try {
			Fs.accessSync(file, Fs.constants.X_OK);
		} catch {
			report.add('error', 'Binary', '"' + file + '" is not executable', 'chmod +x ' + shell(file));
			return report;
		}
	}

	const mismatch = compatibility(target(file), process.platform, process.arch);

	if (mismatch) {

		const names = { win32: 'windows', darwin: 'darwin', linux: 'linux', freebsd: 'freebsd' };
		const architectures = { x64: 'amd64', arm64: 'arm64', ia32: '386', arm: 'arm' };

		report.add(mismatch.status, 'Binary', file + ': ' + mismatch.message, 'Build it for this system: GOOS=' + names[process.platform] + ' GOARCH=' + (architectures[process.arch] || process.arch) + ' go build -o worker');

		if (mismatch.status === 'error')
			return report;
	}

	report.add('ok', 'Binary', file + ' (' + Math.round(stat.size / 1024) + ' KB, built ' + stat.mtime.toISOString().replace('T', ' ').substring(0, 19) + ')');

	let found;

	try {
		found = await describe(file, config);
	} catch (err) {
		report.add('error', 'Worker', err.message.split('\n')[0], 'Is it built for this system (' + process.platform + ', ' + process.arch + ') with the totalfusion module? Cross compile it with GOOS and GOARCH.');
		return report;
	}

	if (found.protocol !== VERSION) {
		report.add('error', 'Protocol', 'The worker speaks protocol ' + found.protocol + ' and this version of TotalFusion speaks ' + VERSION, 'Build the worker again with the same version of the totalfusion module.');
		return report;
	}

	const streams = found.actions.filter(item => item.stream).length;
	report.add(found.actions.length ? 'ok' : 'warn', 'Functions', found.actions.length + (found.actions.length === 1 ? ' function' : ' functions') + ' (' + streams + ' streaming), totalfusion module ' + found.sdk + ', protocol ' + found.protocol, found.actions.length ? null : 'Register functions with app.Function(...) before app.Run().');

	for (const item of found.errors)
		report.add('error', 'Functions', item.function + ': ' + item.message);

	for (const warning of require('../total5').lint ? found.actions.flatMap(item => require('../total5').lint(item.fn, item.meta)) : [])
		report.add('warn', 'Contract', warning.id + ': ' + warning.message);

	if (config.maxMemory && !['linux', 'darwin', 'win32'].includes(process.platform))
		report.add('warn', 'Memory', 'This system does not report the memory of a process: maxMemory will have no effect');

	return report;
};
