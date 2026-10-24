'use strict';

// Runs in its own process (see flow.test.js): loads a component of TotalFusion with the test harness of Flow and runs the steps
// that it is given. Prints a JSON report: the messages that came out of the component (with the output they came from)
// and the statuses that it showed.
//
//   node flow-script.js <path of Total.js> '<scenario>'
//
// scenario: { file, id, configure, config, steps }
//   configure: what to pass to fusion.configure() (the workers that the component needs)
//   steps: { send: input, data } | { reconfigure: config } | { fusion: { runtime, fn, args } } | { shutdown: true } | { wait: ms }
//          and every step can have `wait`, the milliseconds to wait after it

const Path = require('path');
const Fs = require('fs');
const Os = require('os');

require(process.argv[2]);

const scenario = JSON.parse(process.argv[3]);

// A component loads libraries with the require of Total.js, which also looks in the node_modules of the application
const modules = Fs.mkdtempSync(Path.join(Os.tmpdir(), 'totalfusion-flow-'));
Fs.mkdirSync(Path.join(modules, 'node_modules'));
Fs.symlinkSync(Path.join(__dirname, '..'), Path.join(modules, 'node_modules', 'totalfusion'), 'dir');
CONF.$nodemodules = Path.join(modules, 'node_modules');
CONF.$imprint = false;
F.console = NOOP;

const fusion = require('..');
fusion.configure(scenario.configure || {});

const source = Fs.readFileSync(Path.join(__dirname, '..', 'total5', 'flow', scenario.file), 'utf8');
const report = { results: [], statuses: [] };

require(Path.join(process.argv[2], 'flow-test')).load(scenario.id, source, scenario.config || {}, function(Test) {

	Test.message = ($, data) => report.results.push({ output: $.output, data });
	Test.status = status => report.statuses.push(JSON.parse(JSON.stringify(status)));

	(async function() {

		const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

		// the component is loaded
		await wait(300);

		for (const step of scenario.steps) {

			if (step.send)
				Test.input(step.send, step.data);
			else if (step.reconfigure)
				Test.reconfigure(step.reconfigure);
			else if (step.fusion)
				fusion.call(step.fusion.runtime, step.fusion.fn, step.fusion.args).catch(() => {});
			else if (step.shutdown)
				await fusion.shutdown();

			await wait(step.wait || (step.wait === 0 ? 0 : 100));
		}

		await fusion.shutdown();
		Fs.rmSync(modules, { recursive: true, force: true });
		console.log(JSON.stringify(report));
		process.exit(0);

	})();
});
