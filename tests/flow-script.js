'use strict';

// Runs in its own process (see total5.test.js): loads the Flow component of TotalFusion with the test harness
// of Total.js and sends it messages. Prints a JSON report.

const Path = require('path');
const Fs = require('fs');
const Os = require('os');

require(process.argv[2]);

// A component loads libraries with the require of Total.js, which also looks in the node_modules of the application
const modules = Fs.mkdtempSync(Path.join(Os.tmpdir(), 'totalfusion-flow-'));
Fs.mkdirSync(Path.join(modules, 'node_modules'));
Fs.symlinkSync(Path.join(__dirname, '..'), Path.join(modules, 'node_modules', 'totalfusion'), 'dir');
CONF.$nodemodules = Path.join(modules, 'node_modules');
CONF.$imprint = false;
F.console = NOOP;

const fusion = require('..');
fusion.configure({ python: { path: Path.join(__dirname, 'components'), forwardStderr: false } });

const source = Fs.readFileSync(Path.join(__dirname, '..', 'total5', 'flow', 'python.html'), 'utf8');
const report = { results: [], statuses: [] };

require(Path.join(process.argv[2], 'flow-test')).load('python', source, { fn: 'contract.count', timeout: 5000 }, function(Test) {

	Test.message = ($, data) => report.results.push(data);
	Test.status = status => report.statuses.push(status);

	(async function() {

		const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

		Test.input('input', { text: 'one two three' });
		await wait(1500);

		// a Python error goes to the error output
		Test.reconfigure({ fn: 'contract.explode', timeout: 5000 });
		await wait(200);
		Test.input('input', { value: 1 });
		await wait(800);

		// no function configured
		Test.reconfigure({ fn: '', timeout: 5000 });
		await wait(200);
		Test.input('input', { text: 'x' });
		await wait(300);

		await fusion.shutdown();
		Fs.rmSync(modules, { recursive: true, force: true });
		console.log(JSON.stringify(report));
		process.exit(0);

	})();
});
