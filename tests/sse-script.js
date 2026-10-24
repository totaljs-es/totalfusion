'use strict';

// Runs in its own process (see total5.test.js): boots Total.js with a real HTTP server, streams
// from Python with fusion.sse() and prints a JSON report.

const Path = require('path');

const port = +process.argv[3];
require(process.argv[2]);

const fusion = require('..');

CONF.$imprint = false;
F.console = NOOP;

fusion.configure({ python: { path: Path.join(__dirname, 'components'), forwardStderr: false } });

async function events(path, stopAfter) {

	const controller = new AbortController();
	const started = Date.now();
	const res = await fetch('http://127.0.0.1:' + port + path, { signal: controller.signal });
	const decoder = new TextDecoder();
	const got = [];
	let rest = '';

	try {
		for await (const part of res.body) {
			rest += decoder.decode(part, { stream: true });
			let index;
			while ((index = rest.indexOf('\n\n')) !== -1) {
				got.push({ at: Date.now() - started, text: rest.slice(0, index) });
				rest = rest.slice(index + 2);
			}
			if (stopAfter && got.length >= stopAfter) {
				controller.abort();
				break;
			}
		}
	} catch (err) {
		if (err.name !== 'AbortError')
			throw err;
	}

	return { type: res.headers.get('content-type'), cache: res.headers.get('cache-control'), got };
}

F.http({ port, ip: '127.0.0.1' });

ON('ready', async function() {

	const report = {};

	// Routes of a real application live in the install() of a definition, loaded at startup
	ROUTE('GET /ticks/', $ => fusion.sse($, fusion.python.stream('streams.ticks', { n: 4, delay: 0.15 })));
	ROUTE('GET /fails/', $ => fusion.sse($, fusion.python.stream('streams.fails_midway', {}), { onerror: () => {} }));
	ROUTE('GET /secret/', $ => fusion.sse($, fusion.python.stream('contract.explode', {}), { onerror: () => {} }));
	ROUTE('GET /endless/', $ => fusion.sse($, fusion.python.stream('streams.endless_async', {})));

	// The routing table is rebuilt shortly after ROUTE()
	await new Promise(resolve => setTimeout(resolve, 600));

	report.ticks = await events('/ticks/');
	report.fails = await events('/fails/');
	report.secret = await events('/secret/');
	report.endless = await events('/endless/', 3);

	// the cancel travels to the worker after the browser left: wait for it, up to 5 seconds
	for (let i = 0; i < 50 && !report.closed; i++) {
		await new Promise(resolve => setTimeout(resolve, 100));
		report.closed = await fusion.python('streams.closed');
	}

	await fusion.shutdown();
	console.log(JSON.stringify(report));
	process.exit(0);
});
