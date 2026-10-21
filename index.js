'use strict';

const { FusionError } = require('./lib/errors');

// Adapters are loaded only when their runtime is used
const ADAPTERS = {
	python: () => require('./python')
};

class Fusion {

	constructor(config) {

		this.config = {};
		this.pools = new Map();

		// So they can be destructured: const { python } = require('totalfusion')
		this.configure = this.configure.bind(this);
		this.call = this.call.bind(this);
		this.python = this.python.bind(this);
		this.describe = this.describe.bind(this);
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

		let pool = this.pools.get(runtime);

		if (!pool) {

			if (!ADAPTERS[runtime])
				return Promise.reject(new FusionError('NOT_FOUND', 'Unknown runtime "' + runtime + '"'));

			try {
				pool = ADAPTERS[runtime]().create(this.config[runtime] || {});
			} catch (err) {
				return Promise.reject(err);
			}

			this.pools.set(runtime, pool);
		}

		return pool.call(fn, args, options);
	}

	python(fn, args, options) {
		return this.call('python', fn, args, options);
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

	stats() {
		const output = {};
		for (const [name, pool] of this.pools)
			output[name] = pool.stats();
		return output;
	}

	async shutdown() {
		const pools = Array.from(this.pools.values());
		this.pools.clear();
		await Promise.all(pools.map(pool => pool.shutdown()));
	}

}

module.exports = new Fusion();
module.exports.Fusion = Fusion;
module.exports.FusionError = FusionError;
