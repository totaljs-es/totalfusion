'use strict';

const { FusionError } = require('../lib/errors');

// Keys of @action(...) that are passed to NEWACTION()
const KEYS = ['input', 'output', 'permissions'];

// Registers every function decorated with @action as a Total.js 5 action, so it works with
// ACTION(), API routes, FlowStream and (with mcp=True) as an MCP tool.
//
//   const { register } = require('totalfusion/total5');
//   await register({ python: { path: PATH.root('python'), workers: 2 } });
//
// options.python        configuration of the runtime (same as fusion.configure({ python: ... }))
// options.runtime       runtime to register (default: 'python')
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

	// Modules with a @startup hook are loaded when the worker starts, before it reports ready
	if (found.startups.length) {
		const current = (fusion.config[runtime] && fusion.config[runtime].preload) || [];
		fusion.configure({ [runtime]: { preload: Array.from(new Set([].concat(current, found.startups))) } });
	}

	const ids = [];

	for (const item of found.actions) {

		const meta = item.meta;
		const id = meta.id || (prefix + item.module.replace(/\./g, '/') + '/' + item.name);
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

	return { ids, errors: found.errors };
};
