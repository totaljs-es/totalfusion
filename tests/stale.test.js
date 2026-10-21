'use strict';

// Python trusts a .pyc when the modification time of the source (in whole seconds) and its size have not changed. A file edited
// twice within a second without changing its size would keep running the old code, even in a new worker. The components are loaded
// from their source, so this cannot happen.

const { test, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const Path = require('path');
const Fs = require('fs');
const Os = require('os');
const { Fusion } = require('..');

const instances = [];

// This is the setting of a machine that writes bytecode (the CI, most computers). Some environments turn it off,
// which hides the problem: the empty value turns it on again.
const BYTECODE = Object.assign({}, process.env, { PYTHONDONTWRITEBYTECODE: '' });

function create(directory, options) {
	const fusion = new Fusion({ python: Object.assign({ path: directory, forwardStderr: false, env: BYTECODE }, options) });
	instances.push(fusion);
	return fusion;
}

afterEach(async function() {
	await Promise.all(instances.splice(0).map(fusion => fusion.shutdown()));
});

const code = number => 'def value(data):\n    return ' + number + '\n';

test('a file edited within the same second, with the same size, is loaded again from its source', async function() {

	const directory = Fs.mkdtempSync(Path.join(Os.tmpdir(), 'totalfusion-stale-'));
	const file = Path.join(directory, 'thing.py');

	Fs.writeFileSync(file, code(1));
	const seconds = Math.floor(Fs.statSync(file).mtimeMs / 1000);

	const first = create(directory);
	assert.equal(await first.python('thing.value'), 1);
	await first.shutdown();

	// Exactly the case that fools Python: the same size and the same modification time (to the second)
	Fs.writeFileSync(file, code(2));
	Fs.utimesSync(file, seconds, seconds);
	assert.equal(Fs.statSync(file).size, code(1).length);

	const second = create(directory);
	assert.equal(await second.python('thing.value'), 2, 'a new worker ran the old code');
});

test('TotalFusion leaves no bytecode next to your code', async function() {

	const directory = Fs.mkdtempSync(Path.join(Os.tmpdir(), 'totalfusion-stale-'));
	Fs.mkdirSync(Path.join(directory, 'package'));
	Fs.writeFileSync(Path.join(directory, 'package', '__init__.py'), '');
	Fs.writeFileSync(Path.join(directory, 'package', 'inner.py'), 'def where(data):\n    return "inner"\n');
	Fs.writeFileSync(Path.join(directory, 'thing.py'), 'import package.inner\n\n\ndef value(data):\n    return package.inner.where(data)\n');

	const fusion = create(directory);
	assert.equal(await fusion.python('thing.value'), 'inner');

	const found = [];
	(function walk(folder) {
		for (const entry of Fs.readdirSync(folder, { withFileTypes: true })) {
			if (entry.isDirectory())
				walk(Path.join(folder, entry.name));
			if (entry.name === '__pycache__' || entry.name.endsWith('.pyc'))
				found.push(Path.join(folder, entry.name));
		}
	})(directory);

	assert.deepEqual(found, []);
});

test('packages of the components, and the standard library, still import', async function() {
	const directory = Fs.mkdtempSync(Path.join(Os.tmpdir(), 'totalfusion-stale-'));
	Fs.mkdirSync(Path.join(directory, 'tools', 'deep'), { recursive: true });
	Fs.writeFileSync(Path.join(directory, 'tools', '__init__.py'), 'LEVEL = 1\n');
	Fs.writeFileSync(Path.join(directory, 'tools', 'deep', '__init__.py'), '');
	Fs.writeFileSync(Path.join(directory, 'tools', 'deep', 'leaf.py'), 'import json, collections\nfrom .. import LEVEL\n\n\ndef value(data):\n    return {"level": LEVEL, "json": json.dumps([1, 2]), "kind": collections.OrderedDict(a=1).__class__.__name__}\n');

	const fusion = create(directory);
	assert.deepEqual(await fusion.python('tools.deep.leaf.value'), { level: 1, json: '[1, 2]', kind: 'OrderedDict' });
});
