'use strict';

// Runs in its own process (see watch.test.js): register() with watch, and the code changes on disk. Prints a JSON report.

const Path = require('path');
const Fs = require('fs');
const Os = require('os');

require(process.argv[2]);

CONF.$imprint = false;
F.console = NOOP;

const fusion = require('..');
const directory = Fs.mkdtempSync(Path.join(Os.tmpdir(), 'totalfusion-watch-t5-'));
const file = Path.join(directory, 'calc.py');

const code = body => 'from totalfusion import action\n\n' + body;
const DOUBLE = "@action(summary='Doubles', input='n:Number')\ndef double(data):\n    return data['n'] * %s\n";
const TRIPLE = "@action(summary='Triples', input='n:Number')\ndef triple(data):\n    return data['n'] * 3\n";

function run(id, input) {
	const builder = ACTION(id, input);
	builder.user({ sa: true });
	return builder.promise().then(output => ({ ok: true, output }), () => ({ ok: false }));
}

// A real application has a server that keeps the process alive; the watchers and the idle workers do not
setInterval(() => {}, 1000);

let waiting = null;

// The old worker serves until the new one is ready, so right after a change the answer can still be the old one: wait for the new one
async function eventually(call, accept) {

	let result;

	for (let i = 0; i < 200; i++) {
		result = await call();
		if (accept(result))
			return result;
		await new Promise(resolve => setTimeout(resolve, 50));
	}

	return result;
}

// Writes the file and waits until the contracts have been read again
function change(content) {
	return new Promise(resolve => {
		waiting = resolve;
		Fs.writeFileSync(file, content);
	});
}

(async function() {

	const report = {};

	Fs.writeFileSync(file, code(DOUBLE.replace('%s', '2')));

	const registered = await fusion.register({ python: { path: directory, forwardStderr: false }, watch: true, debounce: 50, log: false, onreload: info => waiting && waiting(info) });

	report.first = await run('calc/double', { n: 2 });

	await change(code(DOUBLE.replace('%s', '3')));
	report.edited = await eventually(() => run('calc/double', { n: 2 }), result => result.ok && result.output === 6);

	await change(code(DOUBLE.replace('%s', '3') + '\n\n' + TRIPLE));
	report.added = await eventually(() => run('calc/triple', { n: 5 }), result => result.ok && result.output === 15);

	await change(code(TRIPLE));
	report.removed = { double: !!F.actions['calc/double'], triple: await eventually(() => run('calc/triple', { n: 5 }), result => result.ok && result.output === 15) };

	// the same console.error that reports a broken file would fill the output: only what matters is kept
	const error = console.error;
	console.error = NOOP;
	const info = await change('def oops(:\n    pass\n');
	console.error = error;
	report.broken = { stillThere: !!F.actions['calc/triple'], errors: info.errors };

	await change(code(TRIPLE.replace('* 3', '* 4')));
	report.fixed = await eventually(() => run('calc/triple', { n: 5 }), result => result.ok && result.output === 20);

	registered.close();
	await fusion.shutdown();
	console.log(JSON.stringify(report));
	process.exit(0);

})().catch(function(err) {
	console.error(err);
	process.exit(1);
});
