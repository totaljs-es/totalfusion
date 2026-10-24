'use strict';

// The tutorials (docs/tutorials) have an application each (examples/tutorials) that is run here for real: it is started, its
// verify.js checks what the page says, and the live reload of the page is tried. A tutorial that stops working fails the build.

const { test, describe, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const Path = require('path');
const Fs = require('fs');
const Os = require('os');
const Net = require('net');
const { spawn, spawnSync } = require('child_process');
const total5 = require('./locate-total5')();

const ROOT = Path.join(__dirname, '..');
const TUTORIALS = Path.join(ROOT, 'examples', 'tutorials');
const skip = total5 ? false : 'Total.js 5 not found (set TOTAL5_PATH)';
const running = [];

function freePort() {
	return new Promise(function(resolve) {
		const server = Net.createServer();
		server.listen(0, '127.0.0.1', () => {
			const port = server.address().port;
			server.close(() => resolve(port));
		});
	});
}

// A copy of the tutorial with the framework and TotalFusion where its package.json would put them
function copy(name) {

	const directory = Fs.mkdtempSync(Path.join(Os.tmpdir(), 'totalfusion-tutorial-'));
	Fs.cpSync(Path.join(TUTORIALS, name), directory, { recursive: true, filter: file => !file.includes('node_modules') });
	Fs.mkdirSync(Path.join(directory, 'node_modules'));

	const type = process.platform === 'win32' ? 'junction' : 'dir';
	Fs.symlinkSync(total5, Path.join(directory, 'node_modules', 'total5'), type);
	Fs.symlinkSync(ROOT, Path.join(directory, 'node_modules', 'totalfusion'), type);

	return directory;
}

// Starts the application. The channel of messages makes Total.js run it directly, without the watcher of the debug mode.
async function start(directory) {

	const port = await freePort();
	const app = spawn(process.execPath, ['index.js'], { cwd: directory, env: Object.assign({}, process.env, { PORT: String(port) }), stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
	const item = { app, port, directory, output: '' };

	app.stdout.on('data', chunk => item.output += chunk);
	app.stderr.on('data', chunk => item.output += chunk);
	running.push(item);

	return item;
}

function verify(item) {
	const result = spawnSync(process.execPath, ['verify.js'], { cwd: item.directory, env: Object.assign({}, process.env, { PORT: String(item.port) }), encoding: 'utf8', timeout: 60000 });
	assert.equal(result.status, 0, result.stdout + result.stderr + '\n--- the application said:\n' + item.output.slice(-1500));
	return result.stdout;
}

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

afterEach(async function() {
	for (const item of running.splice(0)) {
		item.app.kill();
		await wait(200);
		Fs.rmSync(item.directory, { recursive: true, force: true });
	}
});

describe('every tutorial has its page and its application', function() {

	test('the pages and the applications are the same list', function() {

		const pages = Fs.readdirSync(Path.join(ROOT, 'docs', 'tutorials')).filter(file => /^\d\d-.*\.md$/.test(file)).map(file => file.replace(/\.md$/, ''));
		const applications = Fs.readdirSync(TUTORIALS).filter(file => /^\d\d-/.test(file));

		assert.deepEqual(applications, pages);
		assert.ok(pages.length >= 1);

		for (const name of applications)
			assert.ok(Fs.existsSync(Path.join(TUTORIALS, name, 'verify.js')), name + ' has no verify.js');
	});

});

describe('01 a Python function as an API and as a tool for an AI agent', { skip }, function() {

	test('the application does what the tutorial says', async function() {
		const item = await start(copy('01-python-action-and-mcp'));
		assert.match(verify(item), /Verified: the API, the validation and the tool for agents/);

		// the checker blocked this process while it ran: what the application printed arrives now
		await wait(300);
		assert.match(item.output, /TotalFusion actions: sentiment\/analyze/);
	});

	test('editing the Python file while the application runs changes the next answer', async function() {

		const item = await start(copy('01-python-action-and-mcp'));
		verify(item);

		const file = Path.join(item.directory, 'python', 'sentiment.py');
		const ask = () => fetch('http://127.0.0.1:' + item.port + '/api/', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ schema: 'sentiment_analyze', data: { text: 'I adore it' } }) }).then(response => response.json());

		assert.deepEqual(await ask(), { label: 'NEUTRAL', score: 0 });

		const source = Fs.readFileSync(file, 'utf8');
		assert.ok(source.includes("'amazing',"));
		Fs.writeFileSync(file, source.replace("'amazing',", "'amazing', 'adore',"));

		let answer;
		for (let i = 0; i < 80 && (!answer || answer.label !== 'POSITIVE'); i++) {
			await wait(150);
			answer = await ask().catch(() => null);
		}

		assert.deepEqual(answer, { label: 'POSITIVE', score: 1 });
		await wait(300);
		assert.match(item.output, /python: sentiment\.py changed/);
	});

});
