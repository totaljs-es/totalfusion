const Path = require('path');
const fusion = REQUIRE('totalfusion');

exports.install = function() {

	// TOTALFUSION_PYTHON chooses the interpreter, including a virtual environment.
	// The Rust worker is the existing example, built once and shared by this app.
	const binary = process.env.TOTALFUSION_RUST_BINARY || Path.resolve(__dirname, '../../rust/target/release', process.platform === 'win32' ? 'worker.exe' : 'worker');

	Promise.all([
		fusion.register({ python: { path: PATH.root('python'), preload: ['statistics'] }, warmup: true }),
		fusion.register({ runtime: 'rust', rust: { binary }, warmup: true })
	]).then(function() {

		// Total.js owns validation, routing and the MCP contracts.
		ROUTE('API /api/ +statistics_summarize --> statistics/summarize');
		ROUTE('API /api/ +collatz_longest --> collatz/longest');

		NEWACTION('arrays/normalize', {
			name: 'Normalize an array',
			summary: 'Normalizes numbers with NumPy using binary transfer between Node.js and Python',
			input: '*values:[Number]',
			output: 'values:[Number]',
			action: function($, model) {
				// JSON at the API boundary; raw Float32 bytes over the worker protocol in both directions.
				fusion.python('statistics.normalize', { values: new Float32Array(model.values) }).then(function(values) {
					$.callback({ values: Array.from(values) });
				}, function(err) {
					console.error('[totalfusion] arrays/normalize:', err);
					$.invalid(err.code === 'REMOTE_ERROR' && err.remote.name === 'ValueError' ? err.remote.message : 'The action failed');
				});
			}
		});

		ROUTE('API /api/ +arrays_normalize --> arrays/normalize');
		console.log('TotalFusion ready: NumPy statistics, Rust Collatz and binary arrays');

	}).catch(function(err) {
		console.error('Cannot start the numerical example:', err);
		fusion.shutdown().finally(() => process.exit(1));
	});
};
