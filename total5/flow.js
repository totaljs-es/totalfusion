'use strict';

// The logic of the components of Flow (total5/flow/*.html). Each component is a small file with its name, its icon and its
// settings, and it asks for the rest here: `exports.make = require('totalfusion').flow('call', 'rust');`
//
//   call    a function of a runtime with the data of each message: the result goes to the first output, a failure to the second
//   stream  a function that sends chunks: every chunk is a message
//   events  the events of the workers (a worker ended, was replaced, stopped answering...) as messages
//   stats   what the pools are doing, when a message arrives and, if you ask, every N seconds

const RUNTIMES = ['python', 'rust', 'go', 'wasm'];

// The events that are worth a message: they are the ones of the pool (see docs/workers.md)
const EVENTS = ['worker:ready', 'worker:exit', 'worker:recycle', 'worker:unresponsive', 'call:retry', 'reload'];

// The message of an error, without the traceback (do not connect that output straight to a public response)
function failure(err) {
	return { code: err.code || 'ERROR', message: String(err.message || err).split('\n')[0] };
}

function milliseconds(value, fallback) {
	value = +value;
	return value >= 0 ? value : fallback;
}

function call(fusion, runtime) {

	return function(instance, config) {

		const status = { calls: 0, errors: 0, error: '' };

		instance.message = function($) {

			if (!config.fn) {
				status.error = 'No function';
				instance.status(status);
				$.send('error', { code: 'NO_FUNCTION', message: status.error });
				return;
			}

			const options = { timeout: milliseconds(config.timeout, 0) };

			if (config.idempotent)
				options.idempotent = true;

			// The data of the message is the argument of the function
			fusion.call(runtime, config.fn, $.data, options).then(function(result) {
				status.calls++;
				status.error = '';
				instance.status(status);
				$.send('output', result);
			}, function(err) {
				status.errors++;
				const problem = failure(err);
				status.error = problem.code + ': ' + problem.message;
				instance.status(status);
				$.send('error', problem);
			});
		};
	};
}

function stream(fusion) {

	return function(instance, config) {

		const status = { streams: 0, running: 0, chunks: 0, errors: 0, error: '' };
		const active = new Map();

		function refresh() {
			status.running = active.size;
			instance.status(status);
		}

		instance.message_input = async function($) {

			const runtime = config.runtime || 'python';

			if (!RUNTIMES.includes(runtime)) {
				status.error = 'Unknown runtime ' + runtime;
				instance.status(status);
				$.send('error', { code: 'NOT_FOUND', message: status.error });
				$.destroy();
				return;
			}

			if (!config.fn) {
				status.error = 'No function';
				instance.status(status);
				$.send('error', { code: 'NO_FUNCTION', message: status.error });
				$.destroy();
				return;
			}

			const source = fusion.stream(runtime, config.fn, $.data, { timeout: milliseconds(config.timeout, 0) });
			const state = { cancelled: false };
			let chunks = 0;

			active.set(source, state);
			status.streams++;
			status.error = '';
			refresh();

			try {

				for await (const chunk of source) {
					chunks++;
					status.chunks++;
					$.send('chunk', chunk);
				}

				$.send('end', { chunks, cancelled: state.cancelled });

			} catch (err) {
				status.errors++;
				const problem = failure(err);
				status.error = problem.code + ': ' + problem.message;
				$.send('error', Object.assign(problem, { chunks }));
			} finally {
				active.delete(source);
				refresh();
				$.destroy();
			}
		};

		// Stops the streams that are running
		instance.message_stop = function($) {

			for (const [source, state] of active) {
				state.cancelled = true;
				source.cancel();
			}

			$.destroy();
		};

		// The flow stops or the component is removed: nobody reads the chunks any more
		instance.close = function() {

			for (const [source, state] of active) {
				state.cancelled = true;
				source.cancel();
			}

			active.clear();
		};
	};
}

function events(fusion) {

	return function(instance, config) {

		const status = { count: 0, last: '' };
		const listeners = [];

		function selected(name, data) {

			const wanted = String(config.events || '').split(',').map(item => item.trim()).filter(Boolean);

			if (!wanted.includes(name))
				return false;

			return !config.runtime || config.runtime === 'all' || config.runtime === data.runtime;
		}

		for (const name of EVENTS) {

			const listener = function(data) {

				if (!selected(name, data))
					return;

				status.count++;
				status.last = name;
				instance.status(status);

				// An event is a message of its own, with the data of the event and when it happened
				instance.send('event', Object.assign({ event: name, at: new Date().toISOString() }, data));
			};

			fusion.on(name, listener);
			listeners.push([name, listener]);
		}

		instance.close = function() {

			for (const [name, listener] of listeners)
				fusion.off(name, listener);

			listeners.length = 0;
		};
	};
}

function stats(fusion) {

	return function(instance, config) {

		let timer = null;

		function send($) {
			if ($)
				$.send('output', fusion.stats());
			else
				instance.send('output', fusion.stats());
		}

		// Every N seconds, if the settings say so. It is armed again when the settings change.
		function arm() {

			clearInterval(timer);
			timer = null;

			if (+config.interval > 0) {
				timer = setInterval(() => send(), Math.max(1, +config.interval) * 1000);
				timer.unref();
			}
		}

		instance.message = $ => send($);
		instance.configure = arm;
		instance.close = () => clearInterval(timer);

		arm();
	};
}

exports.RUNTIMES = RUNTIMES;
exports.EVENTS = EVENTS;

// The function `make` of a component. `runtime` is for the components that call one runtime.
exports.make = function(fusion, kind, runtime) {

	switch (kind) {
		case 'call':
			if (!RUNTIMES.includes(runtime))
				throw new Error('Unknown runtime "' + runtime + '" for a call component');
			return call(fusion, runtime);
		case 'stream':
			return stream(fusion);
		case 'events':
			return events(fusion);
		case 'stats':
			return stats(fusion);
	}

	throw new Error('Unknown component "' + kind + '", use call, stream, events or stats');
};
