'use strict';

const { FusionError } = require('../lib/errors');

// Keys of @action(...) that are passed to NEWACTION()
const KEYS = ['input', 'output', 'permissions'];

// Total.js splits the fields of a schema on commas, even inside a `// comment`:
// '*text:String // Text, up to 2000 chars' declares an extra field called "up to 2000 chars"
function lint(id, meta) {

	const warnings = [];

	for (const key of ['input', 'output']) {
		if (typeof(meta[key]) === 'string' && /\/\/[^\n]*,/.test(meta[key]))
			warnings.push({ id, message: 'A comma inside a // comment of "' + key + '" splits the field. Use parentheses or a new line instead' });
	}

	return warnings;
}

exports.lint = lint;

// Sends a stream to the browser as Server-Sent Events from a Total.js route:
//
//   ROUTE('GET /generate/', function($) {
//       fusion.sse($, fusion.python.stream('llm.generate', { prompt: $.query.prompt }));
//   });
//
// Every chunk is an event `data: <json>`, the end is `event: end` and a failure is `event: error`.
// When the browser disconnects the generator is cancelled, so a model does not keep generating for nobody.
// As in the actions, only the message of a ValueError reaches the client; the real error goes to `onerror`.
exports.sse = function($, stream, options) {

	if (!options)
		options = {};

	const onerror = options.onerror || (err => console.error('[totalfusion] stream: ' + (err.stack || err)));
	const { Readable } = require('stream');

	$.res.once('close', () => stream.cancel());

	async function* events() {
		try {
			for await (const chunk of stream)
				yield 'data: ' + JSON.stringify(chunk) + '\n\n';
			yield 'event: end\ndata: {}\n\n';
		} catch (err) {
			onerror(err);
			yield 'event: error\ndata: ' + JSON.stringify({ message: err.code === 'REMOTE_ERROR' && err.remote.name === 'ValueError' ? err.remote.message : 'The stream failed' }) + '\n\n';
		}
	}

	// No buffering in proxies such as nginx, and no cache
	$.response.headers['cache-control'] = 'no-cache';
	$.response.headers['x-accel-buffering'] = 'no';
	$.stream('text/event-stream', Readable.from(events()));
};

// Registers every function decorated with @action as a Total.js 5 action, so it works with
// ACTION(), API routes, FlowStream and (with mcp=True) as an MCP tool.
//
//   const { register } = require('totalfusion/total5');
//   await register({ python: { path: PATH.root('python'), workers: 2 } });
//
// options.python        configuration of the runtime (same as fusion.configure({ python: ... }))
// options.runtime       runtime to register (default: 'python')
// options.preload       false = do not add the modules with @startup to `preload` (default: true)
// options.warmup        true = start the workers and wait until they are ready before resolving (default: false)
// options.prefix        prepended to the id of every action, e.g. 'Python/'
// options.fusion        TotalFusion instance (default: the shared one)
// options.onerror       function(err, id) called with the real error of a failed call (default: console.error)
exports.register = async function(options) {

	if (!options)
		options = {};

	if (typeof(global.NEWACTION) !== 'function')
		throw new FusionError('NOT_FOUND', 'Total.js 5 is not loaded: require("total5") before registering actions');

	const fusion = options.fusion || require('..');
	const runtime = options.runtime || 'python';
	const prefix = options.prefix || '';
	const onerror = options.onerror || ((err, id) => console.error('[totalfusion] ' + id + ': ' + (err.stack || err)));

	if (options[runtime])
		fusion.configure({ [runtime]: options[runtime] });

	const found = await fusion.describe(runtime);

	// Modules with a @startup hook are loaded when the worker starts, before it reports ready.
	// Every worker loads all of them: use `preload: false` to load each one on its first call instead.
	if (found.startups.length && options.preload !== false) {
		const current = (fusion.config[runtime] && fusion.config[runtime].preload) || [];
		fusion.configure({ [runtime]: { preload: Array.from(new Set([].concat(current, found.startups))) } });
	}

	const ids = [];
	const warnings = [];

	for (const item of found.actions) {

		const meta = item.meta;
		const id = meta.id || (prefix + item.module.replace(/\./g, '/') + '/' + item.name);

		warnings.push(...lint(id, meta));

		// An action answers once. A generator is a stream: it is called with fusion.stream() or fusion.sse()
		if (item.stream) {
			warnings.push({ id, message: 'A generator is a stream and it is not registered as an action: call it with fusion.stream() or fusion.sse()' });
			continue;
		}
		const action = { name: meta.name || id, summary: meta.summary || (item.doc ? item.doc.split('\n')[0] : id), mcp: meta.mcp === true };

		for (const key of KEYS) {
			if (meta[key] != null)
				action[key] = meta[key];
		}

		action.action = function($, model) {
			fusion.call(runtime, item.fn, model, { timeout: meta.timeout }).then(function(result) {
				$.callback(result);
			}, function(err) {
				onerror(err, id);
				// Only a ValueError (invalid input, by convention) reaches the client with its message.
				// Any other failure may contain paths, queries or secrets, so it stays in the log.
				$.invalid(err.code === 'REMOTE_ERROR' && err.remote.name === 'ValueError' ? err.remote.message : 'The action failed');
			});
		};

		NEWACTION(id, action);
		ids.push(id);
	}

	// Loads the models now (at boot) instead of on the first request
	if (options.warmup)
		await fusion.warmup(runtime);

	return { ids, errors: found.errors, warnings };
};
