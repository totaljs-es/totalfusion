'use strict';

const { EventEmitter } = require('events');
const { FusionError } = require('./lib/errors');
const { FusionStream } = require('./lib/stream');
const { watch } = require('./lib/watch');

// Adapters are loaded only when their runtime is used
const ADAPTERS = {
	python: () => require('./python'),
	rust: () => require('./rust')
};

class Fusion extends EventEmitter {

	constructor(config) {

		super();

		this.config = {};
		this.pools = new Map();
		this.watchers = new Set();

		// So they can be destructured: const { python } = require('totalfusion')
		this.configure = this.configure.bind(this);
		this.call = this.call.bind(this);
		this.python = this.python.bind(this);
		this.python.stream = (fn, args, options) => this.stream('python', fn, args, options);
		this.rust = this.rust.bind(this);
		this.rust.stream = (fn, args, options) => this.stream('rust', fn, args, options);
		this.describe = this.describe.bind(this);
		this.warmup = this.warmup.bind(this);
		this.doctor = this.doctor.bind(this);
		this.register = this.register.bind(this);
		this.watch = this.watch.bind(this);
		this.stream = this.stream.bind(this);
		this.sse = this.sse.bind(this);
		this.stats = this.stats.bind(this);
		this.shutdown = this.shutdown.bind(this);

		if (config)
			this.configure(config);
	}

	// fusion.configure({ python: { path: './python', workers: 2, timeout: 30000, venv: './.venv' } })
	configure(config) {

		for (const name of Object.keys(config)) {

			if (!ADAPTERS[name])
				throw new FusionError('NOT_FOUND', 'Unknown runtime "' + name + '"');

			if (this.pools.has(name))
				throw new FusionError('ALREADY_STARTED', 'The ' + name + ' runtime is already running, configure it before the first call');

			this.config[name] = Object.assign({}, this.config[name], config[name]);
		}

		return this;
	}

	// fusion.call('python', 'analyzer.analyze', { text: 'Hello' }, { timeout: 5000, signal })
	call(runtime, fn, args, options) {
		try {
			return this.pool(runtime).call(fn, args, options);
		} catch (err) {
			return Promise.reject(err);
		}
	}

	// Calls a generator (a Python function that yields) and returns an async iterable of its chunks:
	//   for await (const chunk of fusion.stream('python', 'llm.generate', { prompt })) ...
	//   for await (const chunk of fusion.python.stream('llm.generate', { prompt })) ...
	// options: timeout (longest time without progress), signal, highWaterMark (chunks the worker may run ahead, default 16)
	stream(runtime, fn, args, options) {
		try {
			return this.pool(runtime).stream(fn, args, options);
		} catch (err) {
			const stream = new FusionStream(null);
			stream.push({ error: err });
			return stream;
		}
	}

	// Starts all the workers of a runtime and waits until they are ready (models loaded), so the first request is not slow
	warmup(runtime) {
		try {
			return this.pool(runtime).warmup();
		} catch (err) {
			return Promise.reject(err);
		}
	}

	pool(runtime) {

		let pool = this.pools.get(runtime);

		if (!pool) {

			if (!ADAPTERS[runtime])
				throw new FusionError('NOT_FOUND', 'Unknown runtime "' + runtime + '"');

			pool = ADAPTERS[runtime]().create(this.config[runtime] || {});
			this.pools.set(runtime, pool);

			// What happens to the workers, for logs and metrics. A listener that fails must not break the pool.
			pool.emit = (name, data) => {
				try {
					this.emit(name, Object.assign({ runtime }, data));
				} catch (err) {
					process.emitWarning('A listener of "' + name + '" threw: ' + (err && err.message), 'TotalFusionWarning');
				}
			};
		}

		return pool;
	}

	python(fn, args, options) {
		return this.call('python', fn, args, options);
	}

	rust(fn, args, options) {
		return this.call('rust', fn, args, options);
	}

	// Contracts declared with @action in the components of a runtime, read without running them
	describe(runtime) {

		if (!ADAPTERS[runtime])
			return Promise.reject(new FusionError('NOT_FOUND', 'Unknown runtime "' + runtime + '"'));

		try {
			return ADAPTERS[runtime]().describe(this.config[runtime] || {});
		} catch (err) {
			return Promise.reject(err);
		}
	}

	// Development: replaces the workers of a runtime when its code changes on disk (the .py files, or the Rust binary after
	// `cargo build`), so you see your edit in the next call. No call is lost: the new workers start first. Returns { close() }.
	//   fusion.watch('python');
	// options: debounce (ms of quiet after the last change, default 200), log (default true), onreload({ runtime, files, replaced })
	watch(runtime, options) {

		if (!options)
			options = {};

		if (!ADAPTERS[runtime])
			throw new FusionError('NOT_FOUND', 'Unknown runtime "' + runtime + '"');

		const target = ADAPTERS[runtime]().watchTarget(this.config[runtime] || {});

		const handle = watch(target, files => {

			const pool = this.pools.get(runtime);
			const replaced = pool ? pool.restart() : 0;

			if (options.log !== false)
				console.log('[totalfusion] ' + runtime + ': ' + files.join(', ') + ' changed, ' + (replaced ? 'replacing ' + replaced + (replaced === 1 ? ' worker' : ' workers') : 'the next call starts with the new code'));

			this.emit('reload', { runtime, files, replaced });

			if (options.onreload)
				options.onreload({ runtime, files, replaced });

		}, options);

		this.watchers.add(handle);

		return { close: () => {
			handle.close();
			this.watchers.delete(handle);
		} };
	}

	// Checks the interpreter, the components and the libraries before anything runs. Nothing is imported or installed.
	//   const report = await fusion.doctor('python');   report.ok, report.checks, report.text
	doctor(runtime) {

		if (!runtime)
			runtime = 'python';

		if (!ADAPTERS[runtime])
			return Promise.reject(new FusionError('NOT_FOUND', 'Unknown runtime "' + runtime + '"'));

		try {
			return ADAPTERS[runtime]().doctor(this.config[runtime] || {});
		} catch (err) {
			return Promise.reject(err);
		}
	}

	// Total.js 5: registers the functions decorated with @action as actions (and MCP tools). Loaded only when used.
	//   const fusion = REQUIRE('totalfusion');
	//   await fusion.register({ python: { path: PATH.root('python') } });
	register(options) {
		return require('./total5').register(Object.assign({ fusion: this }, options));
	}

	// Total.js 5: sends a stream to the browser as Server-Sent Events (see total5/index.js)
	sse($, stream, options) {
		return require('./total5').sse($, stream, options);
	}

	stats() {
		const output = {};
		for (const [name, pool] of this.pools)
			output[name] = pool.stats();
		return output;
	}

	async shutdown() {
		for (const handle of this.watchers)
			handle.close();

		this.watchers.clear();

		const pools = Array.from(this.pools.values());
		this.pools.clear();
		await Promise.all(pools.map(pool => pool.shutdown()));
	}

}

module.exports = new Fusion();
module.exports.Fusion = Fusion;
module.exports.FusionError = FusionError;
