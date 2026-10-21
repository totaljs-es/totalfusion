'use strict';

const { test, describe, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const Path = require('path');
const { spawnSync, execFileSync } = require('child_process');
const { Fusion } = require('..');
const { installHint } = require('../python');

const BROKEN = Path.join(__dirname, 'components_doctor');
const FINE = Path.join(__dirname, 'components_doctor_ok');
const COMPONENTS = Path.join(__dirname, 'components');
const BIN = Path.join(__dirname, '..', 'bin', 'totalfusion.js');
const instances = [];

function create(options) {
	const fusion = new Fusion({ python: Object.assign({ path: FINE, forwardStderr: false }, options) });
	instances.push(fusion);
	return fusion;
}

function find(report, name, status) {
	return report.checks.filter(check => check.name === name && (!status || check.status === status));
}

// pip is in every Python of the CI, but a Python without it would only break the checks of versions
function hasPip() {
	try {
		const python = process.env.TOTALFUSION_PYTHON || (process.platform === 'win32' ? 'python' : 'python3');
		execFileSync(python, ['-m', 'pip', '--version'], { stdio: 'ignore' });
		return true;
	} catch {
		return false;
	}
}

afterEach(async function() {
	await Promise.all(instances.splice(0).map(fusion => fusion.shutdown()));
});

describe('doctor', function() {

	test('a healthy setup has nothing to fix', async function() {
		const report = await create().doctor('python');
		assert.equal(report.ok, true, report.text);
		assert.equal(find(report, 'Interpreter', 'ok').length, 1);
		assert.equal(find(report, 'Libraries', 'ok').length, 1);
		assert.equal(find(report, 'Components', 'ok').length, 1);
		assert.match(find(report, 'Components')[0].message, /1 action \(0 streaming\)/);
	});

	test('it reports the interpreter and where it was chosen from', async function() {
		const report = await create().doctor();
		assert.match(report.python.version, /^3\.\d+\.\d+$/);
		assert.ok(report.python.executable.length > 0);
		assert.match(find(report, 'Interpreter')[0].message, /chosen by/);
	});

	test('a library that is imported and not installed is an error with the command to install it', async function() {
		const report = await create({ path: BROKEN }).doctor('python');
		assert.equal(report.ok, false);
		const libraries = find(report, 'Libraries', 'error');
		assert.equal(libraries.length, 1);
		assert.match(libraries[0].message, /definitely_not_installed_pkg_xyz used by needs/);
		// found inside a function too: the doctor reads the code, it does not run it
		assert.match(libraries[0].message, /definitely_lazy_pkg_xyz used by lazy/);
		assert.match(libraries[0].fix, /-m pip install .*definitely_not_installed_pkg_xyz/);
		assert.ok(!libraries[0].message.includes('definitely_optional_pkg_xyz'));
	});

	test('an import guarded by try/except ImportError is only a warning', async function() {
		const report = await create({ path: BROKEN }).doctor('python');
		const optional = find(report, 'Libraries', 'warn');
		assert.equal(optional.length, 1);
		assert.match(optional[0].message, /definitely_optional_pkg_xyz used by optional/);
	});

	test('a syntax error is reported with its module', async function() {
		const report = await create({ path: BROKEN }).doctor('python');
		const syntax = find(report, 'Syntax', 'error');
		assert.equal(syntax.length, 1);
		assert.match(syntax[0].message, /^broken: SyntaxError/);

		// reported once, not again as a problem of a contract
		assert.equal(report.checks.filter(check => check.message.includes('SyntaxError')).length, 1);
	});

	test('a contract that cannot be read is a warning', async function() {
		const report = await create({ path: BROKEN }).doctor('python');
		assert.match(find(report, 'Contract', 'warn')[0].message, /nonliteral\.thing: The arguments of @action must be literals/);
	});

	test('requirements.txt: what is missing, what has another version, what is not checked', { skip: hasPip() ? false : 'pip is not installed' }, async function() {
		const report = await create({ path: BROKEN }).doctor('python');
		const requirements = find(report, 'Requirements', 'error');
		assert.equal(requirements.length, 1);
		assert.match(requirements[0].message, /definitely-not-installed-pkg-xyz is not installed/);
		assert.match(requirements[0].message, /pip \S+ does not satisfy ==0\.0\.1/);
		assert.ok(!requirements[0].message.includes('pywin32'), 'a requirement with an environment marker is not checked');
		assert.match(requirements[0].fix, /-m pip install -r .*requirements\.txt/);
	});

	test('a satisfied requirements.txt is ok', { skip: hasPip() ? false : 'pip is not installed' }, async function() {
		const report = await create().doctor('python');
		assert.match(find(report, 'Requirements', 'ok')[0].message, /requirements\.txt: 1 requirement is installed/);
	});

	test('a preload module that does not exist is an error', async function() {
		const report = await create({ preload: ['not_there'] }).doctor('python');
		assert.equal(report.ok, false);
		assert.match(find(report, 'Preload', 'error')[0].message, /"not_there"/);
	});

	test('an invalid maxMemory is an error', async function() {
		const report = await create({ maxMemory: 'lots' }).doctor('python');
		assert.equal(find(report, 'Configuration', 'error').length, 1);
	});

	test('an interpreter that does not exist says how to fix it, depending on how it was chosen', async function() {

		let report = await create({ python: '/nonexistent/python' }).doctor('python');
		assert.equal(report.ok, false);
		assert.match(find(report, 'Interpreter', 'error')[0].message, /chosen by the python option/);

		report = await create({ venv: '/nonexistent/venv' }).doctor('python');
		assert.match(find(report, 'Interpreter', 'error')[0].fix, /python3 -m venv \/nonexistent\/venv/);
	});

	test('a components directory that does not exist is an error', async function() {
		const report = await create({ path: Path.join(__dirname, 'missing') }).doctor('python');
		assert.match(find(report, 'Components', 'error')[0].message, /does not exist/);
	});

	test('nothing is imported or run: a module that fails on import is fine', async function() {
		// tests/static/heavy.py raises when it is imported
		const report = await create({ path: Path.join(__dirname, 'static') }).doctor('python');
		assert.equal(find(report, 'Syntax').length, 0);
		assert.equal(find(report, 'Components', 'ok').length, 1);
	});

	test('the text has the checks, the fixes and a conclusion', async function() {
		const report = await create({ path: BROKEN }).doctor('python');
		assert.match(report.text, /^TotalFusion doctor: python/);
		assert.match(report.text, /\[error\] Libraries/);
		assert.match(report.text, /Fix: .*-m pip install/);
		assert.match(report.text, /\d+ problems? to fix/);
		assert.equal(JSON.parse(JSON.stringify(report)).ok, false);
	});

	test('an unknown runtime is rejected', async function() {
		await assert.rejects(() => create().doctor('cobol'), { code: 'NOT_FOUND' });
	});

});

describe('terminal command', function() {

	function run(...args) {
		return spawnSync(process.execPath, [BIN, ...args], { encoding: 'utf8', timeout: 60000 });
	}

	test('exit code 0 when everything is in order', function() {
		const result = run('doctor', '--path', FINE);
		assert.equal(result.status, 0, result.stdout + result.stderr);
		assert.match(result.stdout, /Everything is in order/);
	});

	test('exit code 1 when something has to be fixed', function() {
		const result = run('doctor', '--path', BROKEN);
		assert.equal(result.status, 1);
		assert.match(result.stdout, /\[error\]/);
	});

	test('--json prints the report', function() {
		const report = JSON.parse(run('doctor', '--path', BROKEN, '--json').stdout);
		assert.equal(report.ok, false);
		assert.ok(report.checks.length > 3);
	});

	test('exit code 2 for a wrong usage', function() {
		assert.equal(run().status, 2);
		assert.equal(run('doctor', '--nope').status, 2);
		assert.equal(run('doctor', '--path').status, 2);
	});

});

describe('errors that say what to do', function() {

	test('a library that is missing at run time says where to install it', async function() {

		const fusion = create({ path: COMPONENTS });

		await assert.rejects(() => fusion.python('needs_library.run'), function(err) {
			assert.equal(err.remote.name, 'ModuleNotFoundError');
			assert.match(err.hint, /"definitely_not_installed_pkg_xyz" is not installed in the Python that runs the workers/);
			assert.match(err.hint, /-m pip install definitely_not_installed_pkg_xyz/);
			assert.match(err.stack, /Hint: /);
			return true;
		});
	});

	test('a worker that cannot start because of a library says it too', async function() {

		const fusion = create({ path: COMPONENTS, preload: ['preload_missing'] });

		await assert.rejects(() => fusion.python('sample.add', { a: 1, b: 1 }), function(err) {
			assert.equal(err.code, 'START_FAILED');
			assert.match(err.hint, /-m pip install definitely_not_installed_pkg_xyz/);
			assert.match(err.message, /Hint: /);
			return true;
		});
	});

	test('the name of the package is not always the name of the import', function() {
		const hint = installHint({ python: 'python3' });
		assert.match(hint('sklearn'), /-m pip install scikit-learn$/);
		assert.match(hint('cv2'), /-m pip install opencv-python$/);
		assert.match(hint('PIL'), /-m pip install Pillow$/);
		assert.match(hint('numpy'), /-m pip install numpy$/);
	});

});
