'use strict';

// The logic of the components of Flow (total5/flow.js) with doubles of Flow and of the engine: what the harness of Total.js cannot see.

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('events');
const { Fusion, FusionError } = require('..');
const flow = require('../total5/flow');

// What a component receives: the instance of Flow and a message that remembers what is sent from it
function instance() {

	const sent = [];
	const item = { sent, statuses: [] };

	item.status = status => item.statuses.push(JSON.parse(JSON.stringify(status)));
	item.send = (output, data) => sent.push({ output, data });

	return item;
}

function message(data) {

	const item = { data, sent: [], destroyed: 0 };

	item.send = (output, value) => item.sent.push({ output, data: value });
	item.destroy = () => item.destroyed++;

	return item;
}

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

describe('the way to ask for a component', function() {

	test('fusion.flow() gives the function make of every kind', function() {
		const fusion = new Fusion();
		assert.equal(typeof fusion.flow('call', 'rust'), 'function');
		assert.equal(typeof fusion.flow('stream'), 'function');
		assert.equal(typeof fusion.flow('events'), 'function');
		assert.equal(typeof fusion.flow('stats'), 'function');
	});

	test('a mistake in the file of a component is told at once', function() {
		const fusion = new Fusion();
		assert.throws(() => fusion.flow('call', 'cobol'), /Unknown runtime "cobol"/);
		assert.throws(() => fusion.flow('call'), /Unknown runtime/);
		assert.throws(() => fusion.flow('nope'), /Unknown component "nope"/);
	});

});

describe('call', function() {

	function component(fusion, config) {
		const flowInstance = instance();
		flow.make(fusion, 'call', 'rust')(flowInstance, config);
		return flowInstance;
	}

	test('the data of the message is the argument, with the timeout and the idempotent flag of the settings', async function() {

		const calls = [];
		const fusion = { call: (runtime, fn, data, options) => (calls.push({ runtime, fn, data, options }), Promise.resolve({ ok: 1 })) };
		const flowInstance = component(fusion, { fn: 'math.add', timeout: 1500, idempotent: true });
		const $ = message({ a: 1 });

		flowInstance.message($);
		await wait(10);

		assert.deepEqual(calls, [{ runtime: 'rust', fn: 'math.add', data: { a: 1 }, options: { timeout: 1500, idempotent: true } }]);
		assert.deepEqual($.sent, [{ output: 'output', data: { ok: 1 } }]);
		assert.equal(flowInstance.statuses[0].calls, 1);
	});

	test('without a timeout the call has none, and without the flag it is not idempotent', async function() {

		const calls = [];
		const fusion = { call: (runtime, fn, data, options) => (calls.push(options), Promise.resolve(1)) };

		component(fusion, { fn: 'f', timeout: 0 }).message(message(null));
		component(fusion, { fn: 'f', timeout: '' }).message(message(null));
		await wait(10);

		assert.deepEqual(calls, [{ timeout: 0 }, { timeout: 0 }]);
	});

	test('the error output has the code and the first line of the message, never the traceback', async function() {

		const fusion = { call: () => Promise.reject(new FusionError('REMOTE_ERROR', 'ValueError: bad\nTraceback (most recent call last):\n  File "x.py"')) };
		const flowInstance = component(fusion, { fn: 'f' });
		const $ = message(null);

		flowInstance.message($);
		await wait(10);

		assert.deepEqual($.sent, [{ output: 'error', data: { code: 'REMOTE_ERROR', message: 'ValueError: bad' } }]);
		assert.equal(flowInstance.statuses[0].errors, 1);
	});

});

describe('stream', function() {

	// A stream that gives the chunks that it is told to, like the one of the engine
	function source(chunks) {

		const item = { cancelled: 0 };
		let released;
		const gate = new Promise(resolve => released = resolve);

		item.cancel = () => {
			item.cancelled++;
			released();
		};

		item[Symbol.asyncIterator] = async function*() {
			for (const chunk of chunks)
				yield chunk;
			await gate;
		};

		return item;
	}

	function component(fusion, config) {
		const flowInstance = instance();
		flow.make(fusion, 'stream')(flowInstance, config);
		return flowInstance;
	}

	test('stopping the flow cancels the streams that are running', async function() {

		const sources = [];
		const fusion = { stream: () => { const item = source([1, 2]); sources.push(item); return item; } };
		const flowInstance = component(fusion, { runtime: 'go', fn: 'f' });

		flowInstance.message_input(message(null));
		flowInstance.message_input(message(null));
		await wait(20);
		assert.equal(flowInstance.statuses.at(-1).running, 2);

		flowInstance.close();
		await wait(20);

		assert.deepEqual(sources.map(item => item.cancelled), [1, 1]);
	});

	test('the input Stop cancels them, and a message is destroyed when its stream ends', async function() {

		const fusion = { stream: () => source([1]) };
		const flowInstance = component(fusion, { runtime: 'python', fn: 'f' });
		const $ = message(null);
		const stop = message(null);

		flowInstance.message_input($);
		await wait(20);
		assert.equal($.destroyed, 0, 'it is still running');

		flowInstance.message_stop(stop);
		await wait(20);

		assert.deepEqual($.sent.map(item => item.output), ['chunk', 'end']);
		assert.equal($.sent[1].data.cancelled, true);
		assert.equal($.destroyed, 1);
		assert.equal(stop.destroyed, 1);
		assert.equal(flowInstance.statuses.at(-1).running, 0);
	});

	test('the stream gets the timeout of the settings and the runtime that was chosen', function() {

		const calls = [];
		const fusion = { stream: (runtime, fn, data, options) => (calls.push({ runtime, fn, data, options }), source([])) };

		component(fusion, { runtime: 'rust', fn: 'a.b', timeout: 900 }).message_input(message({ n: 1 }));

		assert.deepEqual(calls, [{ runtime: 'rust', fn: 'a.b', data: { n: 1 }, options: { timeout: 900 } }]);
	});

});

describe('events', function() {

	test('it listens only while the component lives', function() {

		const fusion = new EventEmitter();
		const flowInstance = instance();

		flow.make(fusion, 'events')(flowInstance, { events: 'worker:exit', runtime: 'all' });

		assert.equal(fusion.listenerCount('worker:exit'), 1);
		assert.equal(fusion.listenerCount('reload'), 1);

		fusion.emit('worker:exit', { runtime: 'python', pid: 1 });
		assert.equal(flowInstance.sent.length, 1);

		flowInstance.close();

		for (const name of flow.EVENTS)
			assert.equal(fusion.listenerCount(name), 0, name);

		fusion.emit('worker:exit', { runtime: 'python', pid: 2 });
		assert.equal(flowInstance.sent.length, 1);
	});

	test('the message has the name of the event, when it happened and the data of the event', function() {

		const fusion = new EventEmitter();
		const flowInstance = instance();

		flow.make(fusion, 'events')(flowInstance, { events: ' worker:recycle , call:retry ', runtime: 'rust' });

		fusion.emit('worker:recycle', { runtime: 'rust', pid: 7, reason: 'memory' });
		fusion.emit('worker:recycle', { runtime: 'python', pid: 8, reason: 'memory' });
		fusion.emit('worker:exit', { runtime: 'rust', pid: 9 });

		assert.equal(flowInstance.sent.length, 1);
		assert.equal(flowInstance.sent[0].output, 'event');
		assert.deepEqual(Object.keys(flowInstance.sent[0].data).sort(), ['at', 'event', 'pid', 'reason', 'runtime']);
		assert.equal(flowInstance.sent[0].data.event, 'worker:recycle');
	});

});

describe('stats', function() {

	test('a message gets the stats, and the timer ends with the component', async function() {

		let reads = 0;
		const fusion = { stats: () => ({ read: ++reads }) };
		const flowInstance = instance();
		const $ = message(null);

		flow.make(fusion, 'stats')(flowInstance, { interval: 0 });

		flowInstance.message($);
		assert.deepEqual($.sent, [{ output: 'output', data: { read: 1 } }]);
		assert.equal(flowInstance.sent.length, 0, 'there is no timer');

		const timed = instance();
		const config = { interval: 1 };
		flow.make(fusion, 'stats')(timed, config);

		await wait(1200);
		assert.equal(timed.sent.length, 1);

		timed.close();
		await wait(1200);
		assert.equal(timed.sent.length, 1, 'the timer was not cleared');
	});

});
