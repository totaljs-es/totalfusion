'use strict';

// Calls the WebAssembly module of examples/wasm. It needs Go 1.24 or newer to be built.
//   cd examples/wasm && GOOS=wasip1 GOARCH=wasm go build -buildmode=c-shared -o module.wasm && cd ../..
//   node examples/wasm.js

const Path = require('path');
const Fs = require('fs');
const fusion = require('..');

const file = Path.join(__dirname, 'wasm', 'module.wasm');

if (!Fs.existsSync(file)) {
	console.error('The module is not built yet. Build it first:\n\n    cd examples/wasm && GOOS=wasip1 GOARCH=wasm go build -buildmode=c-shared -o module.wasm\n');
	process.exit(1);
}

fusion.configure({ wasm: { module: file, workers: 2 } });

(async function() {

	const started = Date.now();
	const result = await fusion.wasm('collatz.longest', { limit: 3000000 });
	console.log('Longest Collatz chain below 3 million:', result, 'in', Date.now() - started, 'ms (the first call includes starting the worker)');

	console.log('A mistake of the caller is an error with a name:');
	await fusion.wasm('collatz.longest', { limit: 0 }).catch(err => console.log('  ', err.remote.name + ':', err.remote.message));

	console.log((await fusion.doctor('wasm')).text);

	await fusion.shutdown();

})();
