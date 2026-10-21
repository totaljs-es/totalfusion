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

// 512, '512mb', '1.5gb' -> bytes. 0 or empty = no limit.
function bytes(value) {

	if (!value)
		return 0;

	if (typeof(value) === 'number')
		return value;

	const match = /^([\d.]+)\s*(b|kb|mb|gb)?$/i.exec(String(value).trim());

	if (!match)
		throw new FusionError('INVALID_CONFIG', 'Invalid memory size "' + value + '", use a number of bytes or a text like "512mb" or "1.5gb"');

	return Math.round(Number(match[1]) * ({ b: 1, kb: 1024, mb: 1024 * 1024, gb: 1024 * 1024 * 1024 }[(match[2] || 'b').toLowerCase()]));
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

		// Recycling: a worker is replaced after `maxCalls` calls or when it uses more than `maxMemory`.
		// The replacement starts first and the old worker leaves when it is idle, so no call waits for a restart.
		this.maxCalls = options.maxCalls || 0;
		this.maxMemory = bytes(options.maxMemory);
		this.recycled = { calls: 0, memory: 0 };
		this.noRecycleUntil = 0;

		// Health: idle workers must answer a ping. A busy worker is protected by the timeout of its call instead.
		this.healthInterval = options.healthInterval == null ? 10000 : options.healthInterval;
		this.healthTimeout = options.healthTimeout || 10000;
		this.unresponsive = 0;
		this.pings = 0;

		this.workers = [];
		this.queue = [];
		this.warm = [];
		this.counter = 0;
		this.failures = 0;
		this.closed = false;
		pools.add(this);

		if (this.healthInterval > 0) {
			this.health = setInterval(() => this.check(), this.healthInterval);
			this.health.unref();
		}
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
		const live = this.live();

		if (this.warm.length && live.length >= this.size && live.every(w => w.ready)) {
			for (const item of this.warm.splice(0))
				item.resolve();
		}
	}

	stats() {

		const ready = this.workers.filter(w => w.ready);

		return {
			workers: this.workers.length,
			ready: ready.length,
			busy: ready.filter(w => w.current).length,
			queued: this.queue.length,
			recycled: Object.assign({}, this.recycled),
			unresponsive: this.unresponsive,
			details: this.workers.map(w => ({ pid: w.proc.pid, ready: w.ready, busy: !!w.current, calls: w.calls, memory: w.memory, age: Date.now() - w.born, recycling: w.recycle || false }))
		};
	}

	// Workers that count for the size of the pool: those being replaced do not
	live() {
		return this.workers.filter(w => !w.recycle && !w.retiring);
	}

	async shutdown() {

		if (this.closed)
			return;

		this.closed = true;
		pools.delete(this);
		clearInterval(this.health);

		const err = new FusionError('CLOSED', 'TotalFusion ' + this.name + ' is shut down');

		for (const job of this.queue.splice(0))
			this.finish(job, err);

		for (const item of this.warm.splice(0))
			item.reject(err);

		await Promise.all(this.workers.map(w => new Promise(resolve => {

			if (w.current)
				this.finish(w.current, err);

			// Idle workers do not keep the process alive, but this wait has to: otherwise the event loop
			// can end before the close of a worker that had to be killed and shutdown() would never finish
			ref(w, true);

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

	// An idle worker, preferring those that are not going to be replaced
	idle() {
		return this.workers.find(w => w.ready && !w.current && !w.retiring && !w.recycle) || this.workers.find(w => w.ready && !w.current && !w.retiring);
	}

	pump() {

		if (this.closed)
			return;

		while (this.queue.length) {
			const w = this.idle();
			if (!w)
				break;
			this.dispatch(w, this.queue.shift());
		}

		let want = this.queue.length - this.workers.filter(w => !w.ready).length;

		if (this.warm.length)
			want = Math.max(want, this.size - this.live().length);

		while (want-- > 0 && this.live().length < this.size) {
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

	start(replaces) {

		let proc;

		try {
			proc = this.spawn();
		} catch (err) {
			if (!replaces)
				this.failAll(err instanceof FusionError ? err : new FusionError('SPAWN_FAILED', err.message));
			return false;
		}

		const w = { proc, ready: false, current: null, grace: null, startTimer: null, stderr: '', error: null, dead: false, calls: 0, memory: null, born: Date.now(), recycle: null, retiring: false, replaces: replaces || null, ping: null, unresponsive: false };

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

			// The replacement is ready: the worker it replaces can leave
			if (w.replaces) {
				this.leave(w.replaces);
				w.replaces = null;
			}

			this.pump();
			this.checkWarm();
			return;
		}

		if (message.t === 'pong') {

			if (w.ping && w.ping.id === message.id) {
				clearTimeout(w.ping.timer);
				w.ping = null;
			}

			this.measure(w, message.mem);
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
		w.calls++;
		ref(w, false);

		if (message.ok)
			this.finish(job, null, message.data);
		else
			this.finish(job, remote(message.error));

		this.measure(w, message.mem);

		if (w.retiring)
			this.bye(w);

		this.pump();
	}

	// Looks at the numbers a worker reports and decides if it has to be replaced
	measure(w, memory) {

		if (typeof(memory) === 'number')
			w.memory = memory;
		else if (this.maxMemory && memory == null && !this.warnedMemory) {
			this.warnedMemory = true;
			process.emitWarning('TotalFusion: maxMemory cannot be applied because this platform does not report the memory of a worker', 'TotalFusionWarning');
		}

		if (w.recycle || w.retiring || this.closed)
			return;

		if (this.maxCalls && w.calls >= this.maxCalls)
			this.recycle(w, 'calls');
		else if (this.maxMemory && w.memory > this.maxMemory)
			this.recycle(w, 'memory');
	}

	// Starts the replacement. The worker keeps serving until the replacement is ready.
	recycle(w, reason) {

		if (w.recycle || w.retiring || this.closed || Date.now() < this.noRecycleUntil)
			return;

		if (!this.start(w))
			return;

		w.recycle = reason;
		this.recycled[reason]++;
	}

	// The replacement of `w` is ready: it takes no more work and leaves as soon as it is idle
	leave(w) {

		if (w.dead || w.retiring)
			return;

		w.retiring = true;

		if (!w.current)
			this.bye(w);
	}

	// The replacement `w` could not start: the old worker stays and no new attempt is made for a while
	abandon(w) {
		w.replaces.recycle = null;
		w.replaces = null;
		this.noRecycleUntil = Date.now() + 60000;
	}

	// Asks the worker to stop (its @shutdown hooks run) and kills it if it does not
	bye(w) {

		if (w.byed)
			return;

		w.byed = true;
		w.byeTimer = setTimeout(() => this.killWorker(w), 3000);
		this.send(w, { t: 'bye' });
	}

	// Pings the workers that have nothing to do
	check() {

		if (this.closed)
			return;

		for (const w of this.workers) {

			if (!w.ready || w.current || w.ping || w.retiring)
				continue;

			w.ping = { id: ++this.pings, timer: setTimeout(() => this.unhealthy(w), this.healthTimeout) };
			w.ping.timer.unref();
			this.send(w, { t: 'ping', id: w.ping.id });
		}
	}

	unhealthy(w) {

		w.ping = null;

		// It got work meanwhile: the timeout of that call protects it
		if (w.current || w.dead || this.closed)
			return;

		this.unresponsive++;
		w.unresponsive = true;
		this.killWorker(w);
	}

	spawnError(w, err) {

		if (w.dead)
			return;

		w.dead = true;
		this.release(w);

		// A replacement that cannot start must not hurt the worker it was meant to replace
		if (w.replaces) {
			this.abandon(w);
			this.pump();
			return;
		}

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

		// A replacement that cannot start must not hurt the worker it was meant to replace: keep it and try again later
		if (!w.ready && w.replaces) {
			this.abandon(w);
			this.pump();
			return;
		}

		// A worker that did not answer is replaced at once, so the next call does not wait for a model to load
		if (w.unresponsive && this.live().length < this.size)
			this.start();

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
		clearTimeout(w.byeTimer);

		if (w.ping)
			clearTimeout(w.ping.timer);

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
