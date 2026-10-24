'use strict';

// Checks what the tutorial says, against the application that is running: npm run verify
// (build the modules first: npm run build)
const assert = require('node:assert/strict');
const Fs = require('fs');
const Os = require('os');
const Path = require('path');

const base = 'http://127.0.0.1:' + (process.env.PORT || 8000);

async function call(path, body) {
	const response = await fetch(base + '/plugins/' + path + '/', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body || {}), signal: AbortSignal.timeout(15000) });
	return { status: response.status, body: await response.json() };
}

// The first call of a module starts its worker, and the application takes a moment to start
async function ready() {
	for (let i = 0; i < 100; i++) {
		try {
			const response = await fetch(base + '/plugins/', { signal: AbortSignal.timeout(5000) });
			if (response.status === 200)
				return response.json();
		} catch {}
		await new Promise(resolve => setTimeout(resolve, 200));
	}
	throw new Error('The application did not answer: is it running? (npm start)');
}

(async function() {

	// 1. The modules of the customers, and what each one offers (read without running any function)
	const plugins = await ready();
	assert.deepEqual(plugins.rules.map(item => item.fn), ['discount.apply']);
	assert.deepEqual(plugins.hostile.map(item => item.fn).sort(), ['call.home', 'damage.write', 'spin.forever', 'steal.environment', 'steal.file']);

	// 2. The rule of a customer
	let response = await call('rules/discount/apply', { price: 100, quantity: 60, tier: 'premium' });
	assert.deepEqual(response.body, { subtotal: 6000, discount: 0.25, total: 4500 });

	response = await call('rules/discount/apply', { price: 10, quantity: 10 });
	assert.deepEqual(response.body, { subtotal: 100, discount: 0.1, total: 90 });

	// 3. A mistake of the caller is an error of the function, with its name
	response = await call('rules/discount/apply', { price: 100 });
	assert.equal(response.status, 400);
	assert.match(response.body[0].error, /^REMOTE_ERROR: ValueError: price and quantity must be numbers/);

	assert.equal((await call('nope/a/b')).status, 404);
	assert.match((await call('rules/nope/x')).body[0].error, /^NOT_FOUND/);

	// 4. A module that tries to get out cannot
	response = await call('hostile/steal/file', { path: '/etc/hosts' });
	assert.equal(response.body.read, false);

	response = await call('hostile/steal/file', { path: __filename });
	assert.equal(response.body.read, false);

	response = await call('hostile/steal/environment');
	assert.deepEqual(response.body, { variables: 0, home: '', path: '' });

	const target = Path.join(Os.tmpdir(), 'totalfusion-tutorial-2-' + process.pid);
	Fs.rmSync(target, { force: true });
	response = await call('hostile/damage/write', { path: target });
	assert.equal(response.body.written, false);
	assert.equal(Fs.existsSync(target), false, 'the module wrote a file');

	assert.equal((await call('hostile/call/home')).body.connected, false);

	// 5. A function that never returns is stopped by the timeout, and the application goes on
	const started = Date.now();
	response = await call('hostile/spin/forever');
	assert.equal(response.status, 400);
	assert.match(response.body[0].error, /^TIMEOUT: /);
	assert.ok(Date.now() - started < 5000, 'it took ' + (Date.now() - started) + ' ms');

	assert.equal((await call('rules/discount/apply', { price: 10, quantity: 10 })).body.total, 90);
	assert.equal((await call('hostile/steal/environment')).body.variables, 0);

	console.log('Verified: the rule, the errors, the sandbox and the timeout');

})().catch(function(err) {
	console.error(err);
	process.exitCode = 1;
});
