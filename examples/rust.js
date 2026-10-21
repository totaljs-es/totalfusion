'use strict';

// Calls the Rust worker of examples/rust.
//   cd examples/rust && cargo build --release && cd ../..
//   node examples/rust.js

const Path = require('path');
const Fs = require('fs');
const fusion = require('..');

const binary = Path.join(__dirname, 'rust', 'target', 'release', process.platform === 'win32' ? 'worker.exe' : 'worker');

if (!Fs.existsSync(binary)) {
	console.error('The worker is not built yet. Build it first:\n\n    cd examples/rust && cargo build --release\n');
	process.exit(1);
}

fusion.configure({ rust: { binary, workers: 2 } });

(async function() {

	const started = Date.now();
	const result = await fusion.rust('collatz.longest', { limit: 3000000 });
	console.log('Longest Collatz chain below 3 million:', result, 'in', Date.now() - started, 'ms');

	console.log('A mistake of the caller is an error with a name:');
	await fusion.rust('collatz.longest', { limit: 0 }).catch(err => console.log('  ', err.remote.name + ':', err.remote.message));

	console.log((await fusion.doctor('rust')).text);

	await fusion.shutdown();

})();
