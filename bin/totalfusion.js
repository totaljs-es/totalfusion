#!/usr/bin/env node
'use strict';

// totalfusion doctor [--path DIR] [--venv DIR] [--python COMMAND] [--requirements FILE] [--preload a,b] [--max-memory 2gb] [--json]
//
// Checks the interpreter, the components and the libraries they need, without importing or installing anything.
// Exit code: 0 when everything is in order (warnings are only advice), 1 when something has to be fixed, 2 for a wrong usage.

const fusion = require('..');

const options = { string: ['path', 'venv', 'python', 'requirements', 'preload', 'max-memory'] };
const args = process.argv.slice(2);
const command = args[0] && !args[0].startsWith('-') ? args.shift() : null;
const values = {};
let json = false;

for (let i = 0; i < args.length; i++) {

	const flag = args[i].replace(/^--/, '');

	if (flag === 'json') {
		json = true;
		continue;
	}

	if (!args[i].startsWith('--') || !options.string.includes(flag) || args[i + 1] == null || args[i + 1].startsWith('--')) {
		console.error('Unknown or incomplete option: ' + args[i]);
		process.exit(2);
	}

	values[flag] = args[++i];
}

if (command !== 'doctor') {
	console.error('Usage: totalfusion doctor [--path DIR] [--venv DIR] [--python COMMAND] [--requirements FILE] [--preload a,b] [--max-memory 2gb] [--json]');
	process.exit(2);
}

const config = {};

if (values.path)
	config.path = values.path;

if (values.venv)
	config.venv = values.venv;

if (values.python)
	config.python = values.python;

if (values.requirements)
	config.requirements = values.requirements;

if (values.preload)
	config.preload = values.preload.split(',');

if (values['max-memory'])
	config.maxMemory = values['max-memory'];

fusion.configure({ python: config });

fusion.doctor('python').then(function(report) {
	console.log(json ? JSON.stringify(report, null, 2) : report.text);
	process.exit(report.ok ? 0 : 1);
}, function(err) {
	console.error(err.message);
	process.exit(2);
});
