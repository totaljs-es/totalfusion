'use strict';

const assert = require('node:assert/strict');
const url = 'http://127.0.0.1:' + (process.env.PORT || 8001) + '/api/';

async function call(schema, data, status = 200) {
	const response = await fetch(url, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ schema, data }),
		signal: AbortSignal.timeout(10000)
	});
	const output = await response.json();
	assert.equal(response.status, status, JSON.stringify(output));
	return output;
}

(async function() {
	const stats = await call('statistics_summarize', { values: [1, 2, 3, 4] });
	assert.deepEqual(stats, { count: 4, mean: 2.5, std: Math.sqrt(1.25), min: 1, max: 4 });
	assert.deepEqual(await call('collatz_longest', { limit: 10 }), { number: 9, steps: 20 });

	const result = await call('arrays_normalize', { values: [1, 2, 3, 4] });
	assert.deepEqual(result.values.map(value => +value.toFixed(3)), [-1.342, -0.447, 0.447, 1.342]);

	await call('statistics_summarize', {}, 400);
	await call('statistics_summarize', { values: [] }, 400);
	await call('arrays_normalize', { values: [2, 2, 2] }, 400);
	await call('collatz_longest', { limit: 0 }, 400);
	console.log('Verified: NumPy statistics, Rust Collatz, binary arrays and invalid input over HTTP');
})().catch(function(err) {
	console.error(err);
	process.exitCode = 1;
});
