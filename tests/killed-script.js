'use strict';

// A worker that is killed while it is idle, and a call that arrives before its exit is noticed.
// Nothing else keeps the process alive: if the pool does not, the process ends with the call pending.
const Path = require('path');
const { Fusion } = require('..');

const fusion = new Fusion({ python: { path: Path.join(__dirname, 'components'), forwardStderr: false, healthInterval: 0 } });

(async function() {

	const dying = await fusion.python('health.pid');
	const pool = fusion.pools.get('python');

	pool.killWorker(pool.workers[0]);

	const pid = await fusion.python('health.pid');
	console.log(pid !== dying ? 'OK' : 'SAME WORKER');
	await fusion.shutdown();
})();
