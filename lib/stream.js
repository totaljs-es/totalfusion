'use strict';

const { FusionError } = require('./errors');

// The result of fusion.stream(): an async iterable of the chunks yielded by a Python generator.
//
//   for await (const chunk of fusion.stream('python', 'llm.generate', { prompt }))
//       process(chunk);
//
// Backpressure: the worker may run ahead of the consumer by `highWaterMark` chunks. Every chunk that
// is read gives the worker one more credit, so a slow consumer slows down the generator instead of
// filling the memory of the process. Leaving the loop (break, return, throw) cancels the generator.
class FusionStream {

	constructor(pool) {
		this.pool = pool;
		this.job = null;
		this.queue = [];
		this.waiters = [];
		this.finished = false;
	}

	[Symbol.asyncIterator]() {
		return this;
	}

	next() {

		if (this.queue.length)
			return new Promise((resolve, reject) => this.deliver({ resolve, reject }, this.queue.shift()));

		if (this.finished)
			return Promise.resolve({ value: undefined, done: true });

		return new Promise((resolve, reject) => this.waiters.push({ resolve, reject }));
	}

	// Called by `for await` when the loop is left early
	return() {
		this.cancel();
		return Promise.resolve({ value: undefined, done: true });
	}

	// Stops the generator in the worker. Chunks that were not read are discarded.
	cancel() {

		if (this.finished)
			return this;

		this.finished = true;
		this.queue.length = 0;

		for (const waiter of this.waiters.splice(0))
			waiter.resolve({ value: undefined, done: true });

		if (this.job)
			this.pool.abort(this.job, new FusionError('CANCELLED', 'The stream was cancelled'));

		return this;
	}

	// Collects all the chunks. Careful with endless generators.
	async toArray() {
		const items = [];
		for await (const item of this)
			items.push(item);
		return items;
	}

	// Called by the pool: { value } | { end: true } | { error }
	push(entry) {

		if (this.finished)
			return;

		if (this.waiters.length)
			this.deliver(this.waiters.shift(), entry);
		else
			this.queue.push(entry);
	}

	deliver(waiter, entry) {

		if (entry.error || entry.end) {

			this.finished = true;

			if (entry.error)
				waiter.reject(entry.error);
			else
				waiter.resolve({ value: undefined, done: true });

			for (const other of this.waiters.splice(0))
				other.resolve({ value: undefined, done: true });

			return;
		}

		this.pool.credit(this.job);
		waiter.resolve({ value: entry.value, done: false });
	}

}

exports.FusionStream = FusionStream;
