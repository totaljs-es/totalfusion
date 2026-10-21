'use strict';

// A Python generator read from Node.js as an async iterable, with the backpressure and the cancellation of a stream.
//   node examples/streaming.js

const fusion = require('..');

fusion.configure({ python: { path: __dirname + '/components' } });

(async function() {

	console.log('--- a stream of 5 chunks');
	for await (const chunk of fusion.python.stream('ticker.ticks', { count: 5, delay: 0.2 }))
		console.log(chunk);

	console.log('--- leaving the loop early stops the generator in Python');
	let seen = 0;
	for await (const chunk of fusion.python.stream('ticker.ticks', { count: 1000, delay: 0.05 })) {
		if (++seen === 3)
			break;
	}
	console.log('stopped after', seen, 'chunks of 1000; the worker is free again:', await fusion.python('ticker.ping'));

	await fusion.shutdown();

})();
