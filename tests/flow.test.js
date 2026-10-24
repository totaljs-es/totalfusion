'use strict';

// The components of Flow (total5/flow/*.html), run with the test harness of Flow that comes with Total.js 5

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const Path = require('path');
const Fs = require('fs');
const Os = require('os');
const { spawnSync } = require('child_process');
const total5 = require('./locate-total5')();
const rust = require('./rust-build');
const go = require('./go-build');
const wasm = require('./wasm-build');

const harness = total5 && Fs.existsSync(Path.join(total5, 'flow-test.js'));
const skipFlow = harness ? false : 'The test harness of Flow (flow-test.js) was not found';
const COMPONENTS = Path.join(__dirname, 'components');
const FLOW = Path.join(__dirname, '..', 'total5', 'flow');

function run(scenario) {

	const result = spawnSync(process.execPath, [Path.join(__dirname, 'flow-script.js'), total5, JSON.stringify(scenario)], { timeout: 90000, cwd: Os.tmpdir() });
	assert.equal(result.status, 0, result.stderr.toString() + result.stdout.toString().slice(-500));

	return JSON.parse(result.stdout.toString().trim().split('\n').pop());
}

const python = { python: { path: COMPONENTS, forwardStderr: false } };
const from = (report, output) => report.results.filter(item => item.output === output).map(item => item.data);

describe('the files of the components', function() {

	test('every component declares what Flow needs, with an id of its own', function() {

		const ids = new Set();

		for (const name of Fs.readdirSync(FLOW).filter(file => file.endsWith('.html'))) {

			const source = Fs.readFileSync(Path.join(FLOW, name), 'utf8');
			const id = /exports\.id = '([^']+)'/.exec(source)[1];

			assert.ok(!ids.has(id), 'the id ' + id + ' is repeated');
			ids.add(id);

			assert.match(id, /^fusion[a-z]+$/, name);
			assert.match(source, /exports\.group = 'TotalFusion'/, name);
			assert.match(source, /exports\.make = require\('totalfusion'\)\.flow\(/, name);
			assert.ok(source.includes('<readme>') && source.includes('<settings>') && source.includes('<body>'), name + ' is not a complete component');
		}

		assert.deepEqual([...ids].sort(), ['fusionevents', 'fusiongo', 'fusionpython', 'fusionrust', 'fusionstats', 'fusionstream', 'fusionwasm']);
	});

	test('the list of components for Flow (db.json) is what the files say', function() {

		const { text } = require('../scripts/flow-db');
		const listed = Fs.readFileSync(Path.join(FLOW, 'db.json'), 'utf8').replace(/\r\n/g, '\n');

		// if this fails, run: node scripts/flow-db.js --write
		assert.equal(listed, text());
		assert.equal(JSON.parse(listed).length, 7);
	});

	test('every icon is one that the icon font of Flow has', function() {

		// Flow 11 has its own font (the list is public/icons-db.html of Flow): a name of Tabler that it lacks shows nothing
		const available = ['bell', 'server', 'python', 'microchip', 'chart-bar', 'stream', 'shield-check'];
		const icons = Fs.readdirSync(FLOW).filter(file => file.endsWith('.html')).map(file => /exports\.icon = 'ti ti-([^']+)'/.exec(Fs.readFileSync(Path.join(FLOW, file), 'utf8'))[1]);

		assert.deepEqual(icons.filter(icon => !available.includes(icon)), []);

		// and, when a checkout of Flow is next to this one, the real list
		const list = Path.join(__dirname, '..', '..', 'flow', 'public', 'icons-db.html');

		if (Fs.existsSync(list)) {
			const names = Fs.readFileSync(list, 'utf8').trim().split(',');
			assert.deepEqual(icons.filter(icon => !names.includes(icon)), []);
		}
	});

	test('a component asks for the logic of its runtime', function() {
		for (const runtime of ['python', 'rust', 'go', 'wasm'])
			assert.match(Fs.readFileSync(Path.join(FLOW, runtime + '.html'), 'utf8'), new RegExp("flow\\('call', '" + runtime + "'\\)"));
	});

});

describe('Python', { skip: skipFlow }, function() {

	test('calls a function with the message, and a failure goes to the error output without the traceback', function() {

		const report = run({
			file: 'python.html', id: 'fusionpython', configure: python, config: { fn: 'contract.count', timeout: 5000 },
			steps: [
				{ send: 'input', data: { text: 'one two three' }, wait: 1500 },
				{ reconfigure: { fn: 'contract.explode' }, wait: 200 },
				{ send: 'input', data: { value: 1 }, wait: 800 },
				{ reconfigure: { fn: '' }, wait: 200 },
				{ send: 'input', data: { text: 'x' }, wait: 300 }
			]
		});

		assert.deepEqual(report.results[0], { output: 'output', data: { words: 3 } });

		assert.equal(report.results[1].output, 'error');
		assert.equal(report.results[1].data.code, 'REMOTE_ERROR');
		assert.match(report.results[1].data.message, /^RuntimeError: /);
		assert.ok(!report.results[1].data.message.includes('Traceback'));

		assert.equal(report.results[2].output, 'error');
		assert.equal(report.results[2].data.code, 'NO_FUNCTION');
		assert.equal(report.results.length, 3);

		// the component shows how many calls and errors it had
		assert.ok(report.statuses.some(status => status.calls === 1));
		assert.ok(report.statuses.some(status => status.errors === 1 && status.error.startsWith('REMOTE_ERROR')));
	});

});

describe('Rust, Go and WebAssembly', { skip: skipFlow }, function() {

	const cases = [
		['rust', 'rust.html', 'fusionrust', () => ({ rust: { binary: rust(), forwardStderr: false } }), rust.skip(), 'Error'],
		['go', 'go.html', 'fusiongo', () => ({ go: { binary: go(), forwardStderr: false } }), go.skip(), 'Error'],
		['wasm', 'wasm.html', 'fusionwasm', () => ({ wasm: { module: wasm(), forwardStderr: false } }), wasm.skip(), 'Error']
	];

	for (const [runtime, file, id, configure, skip] of cases) {

		test('the component of ' + runtime + ' calls a function and sends the result, or the failure', { skip }, function() {

			const report = run({
				file, id, configure: configure(), config: { fn: 'math.add', timeout: 10000 },
				steps: [
					{ send: 'input', data: { a: 2, b: 3 }, wait: 800 },
					{ send: 'input', data: { a: 2 }, wait: 400 },
					{ reconfigure: { fn: 'fail' }, wait: 200 },
					{ send: 'input', data: null, wait: 400 },
					{ reconfigure: { fn: 'nope' }, wait: 200 },
					{ send: 'input', data: null, wait: 400 }
				]
			});

			assert.deepEqual(report.results[0], { output: 'output', data: { sum: 5 } });

			// a mistake of the caller is an error of the function
			assert.equal(report.results[1].output, 'error');
			assert.equal(report.results[1].data.code, 'REMOTE_ERROR');
			assert.match(report.results[1].data.message, /b must be a number/);

			assert.equal(report.results[2].output, 'error');
			assert.match(report.results[2].data.message, /something failed/);

			assert.equal(report.results[3].output, 'error');
			assert.equal(report.results[3].data.code, 'NOT_FOUND');
			assert.equal(report.results.length, 4);
		});
	}

	test('a runtime that is not configured is an error of the message, not of the flow', { skip: go.skip() }, function() {

		const report = run({ file: 'go.html', id: 'fusiongo', configure: {}, config: { fn: 'math.add' }, steps: [{ send: 'input', data: { a: 1, b: 1 }, wait: 400 }] });

		assert.equal(report.results[0].output, 'error');
		assert.equal(report.results[0].data.code, 'INVALID_CONFIG');
	});

});

describe('Stream', { skip: skipFlow }, function() {

	test('every chunk is a message, in order, and the end says how many', { skip: go.skip() }, function() {

		const report = run({
			file: 'stream.html', id: 'fusionstream', configure: { go: { binary: go(), forwardStderr: false } }, config: { runtime: 'go', fn: 'count.up', timeout: 5000 },
			steps: [{ send: 'input', data: { n: 5, start: 10 }, wait: 800 }]
		});

		assert.deepEqual(from(report, 'chunk'), [10, 11, 12, 13, 14]);
		assert.deepEqual(from(report, 'end'), [{ chunks: 5, cancelled: false }]);
		assert.equal(report.results.length, 6);
	});

	test('a Python generator works the same way', function() {

		const report = run({
			file: 'stream.html', id: 'fusionstream', configure: python, config: { runtime: 'python', fn: 'streams.numbers', timeout: 5000 },
			steps: [{ send: 'input', data: { n: 3, start: 100 }, wait: 1500 }]
		});

		assert.deepEqual(from(report, 'chunk'), [100, 101, 102]);
		assert.deepEqual(from(report, 'end'), [{ chunks: 3, cancelled: false }]);
	});

	test('the input Stop cancels the stream that is running, and the end says so', { skip: go.skip() }, function() {

		const report = run({
			file: 'stream.html', id: 'fusionstream', configure: { go: { binary: go(), forwardStderr: false } }, config: { runtime: 'go', fn: 'ticks', timeout: 5000 },
			steps: [
				{ send: 'input', data: { n: 1000, delay: 20 }, wait: 400 },
				{ send: 'stop', data: null, wait: 600 }
			]
		});

		const chunks = from(report, 'chunk');
		const end = from(report, 'end');

		assert.ok(chunks.length >= 3 && chunks.length < 1000, 'chunks: ' + chunks.length);
		assert.deepEqual(end, [{ chunks: chunks.length, cancelled: true }]);

		// nothing comes out after the stop
		assert.equal(report.results[report.results.length - 1].output, 'end');
		assert.equal(report.statuses[report.statuses.length - 1].running, 0);
	});

	test('the chunks before a failure are delivered, then the error says how many', { skip: go.skip() }, function() {

		const report = run({
			file: 'stream.html', id: 'fusionstream', configure: { go: { binary: go(), forwardStderr: false } }, config: { runtime: 'go', fn: 'fails_midway', timeout: 5000 },
			steps: [{ send: 'input', data: null, wait: 800 }]
		});

		assert.deepEqual(from(report, 'chunk'), [1, 2]);
		assert.equal(from(report, 'end').length, 0);

		const error = from(report, 'error')[0];
		assert.equal(error.code, 'REMOTE_ERROR');
		assert.match(error.message, /boom after two chunks/);
		assert.equal(error.chunks, 2);
	});

	test('a function that is not a stream is a stream of one chunk', { skip: wasm.skip() }, function() {

		const report = run({
			file: 'stream.html', id: 'fusionstream', configure: { wasm: { module: wasm(), forwardStderr: false } }, config: { runtime: 'wasm', fn: 'single', timeout: 5000 },
			steps: [{ send: 'input', data: null, wait: 800 }]
		});

		assert.deepEqual(from(report, 'chunk'), ['single']);
		assert.deepEqual(from(report, 'end'), [{ chunks: 1, cancelled: false }]);
	});

	test('a missing function and an unknown runtime go to the error output', function() {

		const report = run({
			file: 'stream.html', id: 'fusionstream', configure: python, config: { runtime: 'python', fn: '' },
			steps: [
				{ send: 'input', data: null, wait: 200 },
				{ reconfigure: { fn: 'streams.numbers', runtime: 'cobol' }, wait: 200 },
				{ send: 'input', data: { n: 1 }, wait: 200 }
			]
		});

		assert.deepEqual(from(report, 'error').map(item => item.code), ['NO_FUNCTION', 'NOT_FOUND']);
	});

});

describe('Events', { skip: skipFlow }, function() {

	test('a message for every event that you chose, with the data of the event', function() {

		const report = run({
			file: 'events.html', id: 'fusionevents', configure: python, config: { events: 'worker:ready,worker:exit', runtime: 'all' },
			steps: [
				{ fusion: { runtime: 'python', fn: 'sample.add', args: { a: 1, b: 1 } }, wait: 1200 },
				{ shutdown: true, wait: 500 }
			]
		});

		const events = from(report, 'event');

		assert.deepEqual(events.map(item => item.event), ['worker:ready', 'worker:exit']);
		assert.equal(events[0].runtime, 'python');
		assert.ok(events[0].pid > 0);
		assert.equal(events[1].reason, 'shutdown');
		assert.ok(!isNaN(Date.parse(events[0].at)));
		assert.ok(report.results.every(item => item.output === 'event'));
	});

	test('the events that were not chosen, and the runtimes that were not chosen, do not come out', function() {

		const report = run({
			file: 'events.html', id: 'fusionevents', configure: python, config: { events: 'worker:exit', runtime: 'rust' },
			steps: [
				{ fusion: { runtime: 'python', fn: 'sample.add', args: { a: 1, b: 1 } }, wait: 1200 },
				{ shutdown: true, wait: 500 }
			]
		});

		assert.deepEqual(report.results, []);
	});

	test('the settings can change while the flow runs', function() {

		const report = run({
			file: 'events.html', id: 'fusionevents', configure: python, config: { events: 'worker:ready', runtime: 'all' },
			steps: [
				{ fusion: { runtime: 'python', fn: 'sample.add', args: { a: 1, b: 1 } }, wait: 1200 },
				{ shutdown: true, wait: 300 },
				{ reconfigure: { events: 'worker:exit' }, wait: 200 },
				{ fusion: { runtime: 'python', fn: 'sample.add', args: { a: 1, b: 1 } }, wait: 1200 },
				{ shutdown: true, wait: 500 }
			]
		});

		assert.deepEqual(from(report, 'event').map(item => item.event), ['worker:ready', 'worker:exit']);
	});

});

describe('Stats', { skip: skipFlow }, function() {

	test('what the pools are doing, when a message arrives', function() {

		const report = run({
			file: 'stats.html', id: 'fusionstats', configure: python, config: { interval: 0 },
			steps: [
				{ fusion: { runtime: 'python', fn: 'sample.add', args: { a: 1, b: 1 } }, wait: 1200 },
				{ send: 'input', data: null, wait: 300 }
			]
		});

		const [stats] = from(report, 'output');

		assert.equal(report.results.length, 1);
		assert.equal(stats.python.workers, 1);
		assert.equal(stats.python.ready, 1);
		assert.ok(stats.python.details[0].pid > 0);
	});

	test('every N seconds when the settings say so, and not when they stop saying it', function() {

		const report = run({
			file: 'stats.html', id: 'fusionstats', configure: python, config: { interval: 0 },
			steps: [
				{ wait: 1300 },
				{ reconfigure: { interval: 1 }, wait: 3300 },
				{ reconfigure: { interval: 0 }, wait: 200 },
				{ marker: true, wait: 2200 }
			]
		});

		// about three messages in 3.3 seconds, and none after that
		const count = report.results.length;
		assert.ok(count >= 2 && count <= 4, 'messages: ' + count);
	});

});
