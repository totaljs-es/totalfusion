'use strict';

const { FusionError } = require('./errors');
const { FusionStream } = require('./stream');
const { VERSION, encode, write, Decoder } = require('./protocol');

const pools = new Set();

// Last line of defence: workers never outlive the parent process
process.on('exit', function() {
	for (const pool of pools)
		pool.kill();
});

// Idle workers must not keep the Node.js process alive, running calls must
function ref(worker, on) {
	const method = on ? 'ref' : 'unref';
	worker.proc[method]();
	for (const stream of [worker.proc.stdin, worker.proc.stdout, worker.proc.stderr]) {
		if (stream && stream[method])
			stream[method]();
	}
}

// A pool of persistent worker processes. Each worker runs one call at a time,
// the rest wait in a bounded queue. Calls are never retried automatically:
// a crashed worker rejects its call (it may have had side effects) and is replaced.
class Pool {

	constructor(options) {
		this.name = options.name;
		this.spawn = options.spawn;
		this.hint = options.hint || '';
		this.size = options.workers || 1;
		this.timeout = options.timeout == null ? 30000 : options.timeout;
		this.maxQueue = options.maxQueue == null ? 1000 : options.maxQueue;
		this.startTimeout = options.startTimeout || 30000;
		this.cancelGrace = options.cancelGrace || 2000;
		this.forwardStderr = options.forwardStderr !== false;
		this.workers = [];
		this.queue = [];
		this.warm = [];
		this.counter = 0;
		this.failures = 0;
		this.closed = false;
		pools.add(this);
	}

	call(fn, args, options) {
		return new Promise((resolve, reject) => this.enqueue(fn, args, options || {}, resolve, reject));
	}

	// Calls a generator of the worker. Returns an async iterable (see lib/stream.js).
	// `timeout` is the longest time without progress: no chunk produced and none read.
	stream(fn, args, options) {

		if (!options)
			options = {};

		const stream = new FusionStream(this);

		this.enqueue(fn, args, options, () => stream.push({ end: true }), err => stream.push({ error: err }), stream);

		return stream;
	}

	enqueue(fn, args, options, resolve, reject, stream) {

		if (this.closed)
			return reject(new FusionError('CLOSED', 'TotalFusion ' + this.name + ' is shut down'));

		if (options.signal && options.signal.aborted)
			return reject(new FusionError('ABORTED', 'The call was aborted'));

		if (this.queue.length >= this.maxQueue)
			return reject(new FusionError('QUEUE_FULL', 'The ' + this.name + ' queue is full (' + this.maxQueue + ' pending calls)'));

		const job = { id: ++this.counter, fn, args, resolve, reject, timeout: options.timeout == null ? this.timeout : options.timeout, worker: null, timer: null, settled: false, signal: options.signal, stream: stream || null, credit: Math.max(1, options.highWaterMark || 16) };

		if (stream)
			stream.job = job;

		if (job.signal) {
			job.onabort = () => this.abort(job, new FusionError('ABORTED', 'The call was aborted'));
			job.signal.addEventListener('abort', job.onabort, { once: true });
		}

		this.queue.push(job);
		this.pump();
	}

	// Starts every worker of the pool and resolves when all of them are ready (preload and @startup included)
	warmup() {
		return new Promise((resolve, reject) => {

			if (this.closed)
				return reject(new FusionError('CLOSED', 'TotalFusion ' + this.name + ' is shut down'));

			this.warm.push({ resolve, reject });
			this.pump();
			this.checkWarm();
		});
	}

	checkWarm() {
		if (this.warm.length && this.workers.length >= this.size && this.workers.every(w => w.ready)) {
			for (const item of this.warm.splice(0))
				item.resolve();
		}
	}

	stats() {
		const ready = this.workers.filter(w => w.ready);
		return { workers: this.workers.length, ready: ready.length, busy: ready.filter(w => w.current).length, queued: this.queue.length };
	}

	async shutdown() {

		if (this.closed)
			return;

		this.closed = true;
		pools.delete(this);

		const err = new FusionError('CLOSED', 'TotalFusion ' + this.name + ' is shut down');

		for (const job of this.queue.splice(0))
			this.finish(job, err);

		for (const item of this.warm.splice(0))
			item.reject(err);

		await Promise.all(this.workers.map(w => new Promise(resolve => {

			if (w.current)
				this.finish(w.current, err);

			const timer = setTimeout(() => this.killWorker(w), 2000);
			w.proc.once('close', () => {
				clearTimeout(timer);
				resolve();
			});

			this.send(w, { t: 'bye' });
		})));
	}

	kill() {
		for (const w of this.workers)
			this.killWorker(w);
	}

	finish(job, err, data) {

		if (job.settled)
			return;

		job.settled = true;
		clearTimeout(job.timer);

		if (job.signal)
			job.signal.removeEventListener('abort', job.onabort);

		if (err)
			job.reject(err);
		else
			job.resolve(data);
	}

	// Rejects the caller right away. A running call keeps its worker busy until the
	// worker answers the cancel request, or it is killed after the grace period (sync code cannot be interrupted).
	abort(job, err) {

		if (job.settled)
			return;

		this.finish(job, err);

		const w = job.worker;

		if (w) {
			this.send(w, { t: 'cancel', id: job.id });
			w.grace = setTimeout(() => this.killWorker(w), this.cancelGrace);
			return;
		}

		const index = this.queue.indexOf(job);
		if (index !== -1)
			this.queue.splice(index, 1);
	}

	pump() {

		if (this.closed)
			return;

		while (this.queue.length) {
			const w = this.workers.find(w => w.ready && !w.current);
			if (!w)
				break;
			this.dispatch(w, this.queue.shift());
		}

		let want = this.queue.length - this.workers.filter(w => !w.ready).length;

		if (this.warm.length)
			want = Math.max(want, this.size - this.workers.length);

		while (want-- > 0 && this.workers.length < this.size) {
			if (!this.start())
				break;
		}
	}

	dispatch(w, job) {

		let frame;

		try {
			frame = encode(job.stream ? { t: 'call', id: job.id, fn: job.fn, args: job.args, stream: true, credit: job.credit } : { t: 'call', id: job.id, fn: job.fn, args: job.args });
		} catch (err) {
			this.finish(job, err instanceof FusionError ? err : new FusionError('ENCODE_ERROR', 'The arguments cannot be serialized: ' + err.message));
			return;
		}

		w.current = job;
		job.worker = w;
		ref(w, true);

		this.arm(job);
		write(w.proc.stdin, frame);
	}

	// The timeout of a call counts from the moment it is sent to a worker. In a stream it is the longest time without progress.
	arm(job) {

		clearTimeout(job.timer);

		if (job.timeout > 0 && !job.settled)
			job.timer = setTimeout(() => this.abort(job, new FusionError('TIMEOUT', 'The ' + (job.stream ? 'stream of ' : 'call to ') + this.name + ' "' + job.fn + '" timed out after ' + job.timeout + ' ms' + (job.stream ? ' without progress' : ''))), job.timeout);
	}

	// A chunk was read by the consumer: the worker may produce one more
	credit(job) {

		if (job.settled || !job.worker)
			return;

		this.send(job.worker, { t: 'credit', id: job.id, n: 1 });
		this.arm(job);
	}

	send(w, message) {
		try {
			write(w.proc.stdin, encode(message));
		} catch {}
	}

	start() {

		let proc;

		try {
			proc = this.spawn();
		} catch (err) {
			this.failAll(err instanceof FusionError ? err : new FusionError('SPAWN_FAILED', err.message));
			return false;
		}

		const w = { proc, ready: false, current: null, grace: null, startTimer: null, stderr: '', error: null, dead: false };

		this.workers.push(w);
		ref(w, true);

		w.decoder = new Decoder(message => this.message(w, message));

		proc.stdout.on('data', chunk => {
			try {
				w.decoder.push(chunk);
			} catch (err) {
				w.error = err;
				this.killWorker(w);
			}
		});

		proc.stderr.on('data', chunk => {
			w.stderr = (w.stderr + chunk).slice(-4096);
			if (this.forwardStderr)
				process.stderr.write(chunk);
		});

		proc.stdin.on('error', () => {});
		proc.on('error', err => this.spawnError(w, err));
		proc.on('close', (code, signal) => this.exit(w, code, signal));

		w.startTimer = setTimeout(() => {
			w.error = new FusionError('START_TIMEOUT', 'The ' + this.name + ' worker did not become ready in ' + this.startTimeout + ' ms');
			this.killWorker(w);
		}, this.startTimeout);

		return true;
	}

	message(w, message) {

		if (message.t === 'ready') {

			if (message.v !== VERSION) {
				w.error = new FusionError('PROTOCOL_MISMATCH', 'The ' + this.name + ' worker speaks protocol ' + message.v + ', expected ' + VERSION);
				this.killWorker(w);
				return;
			}

			w.ready = true;
			w.info = message;
			this.failures = 0;
			clearTimeout(w.startTimer);

			if (!w.current)
				ref(w, false);

			this.pump();
			this.checkWarm();
			return;
		}

		if (message.t === 'chunk') {

			const job = w.current;

			if (job && job.id === message.id && job.stream && !job.settled) {
				job.stream.push({ value: message.data });
				this.arm(job);
			}

			return;
		}

		if (message.t !== 'res')
			return;

		const job = w.current;

		if (!job || job.id !== message.id)
			return;

		clearTimeout(w.grace);
		w.grace = null;
		w.current = null;
		ref(w, false);

		if (message.ok)
			this.finish(job, null, message.data);
		else
			this.finish(job, remote(message.error));

		this.pump();
	}

	spawnError(w, err) {

		if (w.dead)
			return;

		w.dead = true;
		this.release(w);

		const error = new FusionError('SPAWN_FAILED', 'Cannot start the ' + this.name + ' worker: ' + err.message + (this.hint ? '. ' + this.hint : ''), { cause: err });

		if (w.current)
			this.finish(w.current, error);

		this.failAll(error);
	}

	exit(w, code, signal) {

		if (w.dead)
			return;

		w.dead = true;
		this.release(w);

		const stderr = w.stderr.trim();

		if (w.current)
			this.finish(w.current, new FusionError('WORKER_CRASHED', 'The ' + this.name + ' worker stopped during the call (' + (signal || 'exit code ' + code) + ')' + (stderr ? ':\n' + stderr : ''), { exitCode: code, signal, stderr }));

		if (this.closed)
			return;

		// A worker that never gets ready (broken interpreter, import error) must not be restarted forever
		if (!w.ready && ++this.failures >= 3) {
			this.failures = 0;
			this.failAll(w.error || new FusionError('START_FAILED', 'The ' + this.name + ' worker cannot start (' + (signal || 'exit code ' + code) + ')' + (stderr ? ':\n' + stderr : ''), { exitCode: code, signal, stderr }));
			return;
		}

		this.pump();
	}

	release(w) {
		clearTimeout(w.startTimer);
		clearTimeout(w.grace);
		const index = this.workers.indexOf(w);
		if (index !== -1)
			this.workers.splice(index, 1);
	}

	killWorker(w) {
		try {
			w.proc.kill('SIGKILL');
		} catch {}
	}

	failAll(err) {

		for (const job of this.queue.splice(0))
			this.finish(job, err);

		for (const item of this.warm.splice(0))
			item.reject(err);
	}

}

function remote(e) {

	const err = new FusionError(e.code || 'REMOTE_ERROR', (e.name ? e.name + ': ' : '') + e.message, { remote: e });

	if (e.traceback)
		err.stack += '\n\n--- remote traceback ---\n' + e.traceback;

	return err;
}

exports.Pool = Pool;
