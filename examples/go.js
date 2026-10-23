'use strict';

// Calls the Go worker of examples/go.
//   cd examples/go && go build -o worker && cd ../..
//   node examples/go.js

const Path = require('path');
const Fs = require('fs');
const fusion = require('..');

const binary = Path.join(__dirname, 'go', process.platform === 'win32' ? 'worker.exe' : 'worker');

if (!Fs.existsSync(binary)) {
	console.error('The worker is not built yet. Build it first:\n\n    cd examples/go && go build -o worker\n');
	process.exit(1);
}

fusion.configure({ go: { binary, workers: 2 } });

(async function() {

	const started = Date.now();
	const result = await fusion.go('collatz.longest', { limit: 3000000 });
	console.log('Longest Collatz chain below 3 million:', result, 'in', Date.now() - started, 'ms');

	console.log('A mistake of the caller is an error with a name:');
	await fusion.go('collatz.longest', { limit: 0 }).catch(err => console.log('  ', err.remote.name + ':', err.remote.message));

	console.log((await fusion.doctor('go')).text);

	await fusion.shutdown();

})();
