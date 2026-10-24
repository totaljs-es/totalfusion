'use strict';

// The files for agents and models: AGENTS.md and the pointers to it, the skills, llms.txt, llms-full.txt and the schemas.
// They are only useful if they are true, so they are tested like the documentation.

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const Path = require('path');
const Fs = require('fs');

const ROOT = Path.join(__dirname, '..');
const read = file => Fs.readFileSync(Path.join(ROOT, file), 'utf8').replace(/\r\n/g, '\n');
const pkg = JSON.parse(read('package.json'));
const llms = require('../scripts/llms');
const { KEYS } = require('../lib/options');

// Every file and folder of the repository, to check the paths that a text mentions
const everything = [];

(function walk(directory, prefix) {
	for (const entry of Fs.readdirSync(directory, { withFileTypes: true })) {

		if (['node_modules', '.git', 'target', '__pycache__'].includes(entry.name))
			continue;

		const path = prefix + entry.name;
		everything.push(path);

		if (entry.isDirectory())
			walk(Path.join(directory, entry.name), path + '/');
	}
})(ROOT, '');

function exists(token) {
	const wanted = token.replace(/\/$/, '');
	return everything.some(path => path === wanted || path.endsWith('/' + wanted));
}

const GENERATED = ['target/', '__pycache__/', 'plugins/'];

// The paths that a text mentions between backticks: `docs/ai.md`, `scripts/llms.js`, `python/`
function mentioned(text) {

	const found = new Set();

	for (const match of text.matchAll(/`([^`\n]+)`/g)) {

		const token = match[1].trim();

		// Placeholders (NN-name), what is generated and is not in git (target/, __pycache__/, plugins/) and globs are not paths of the repository
		if (/[\s<>*{}$()=:|,;@]/.test(token) || token.startsWith('-') || token.startsWith('node_modules') || /NN/.test(token) || GENERATED.includes(token))
			continue;

		if (/^[\w.\-/]+\.(md|js|json|html|py|rs|go|yml|txt|toml|mod)$/.test(token) || /^[\w.\-]+(\/[\w.\-]+)*\/$/.test(token))
			found.add(token);
	}

	return [...found];
}

// The commands that a text mentions: npm run x, node scripts/x.js, node --test tests/x.js
function commands(text) {

	const found = [];

	for (const match of text.matchAll(/npm run ([\w:-]+)/g))
		found.push({ script: match[1] });

	for (const match of text.matchAll(/node (?:--test )?((?:scripts|tests|bin)\/[\w./-]+\.js)/g))
		found.push({ file: match[1] });

	return found;
}

function check(file) {

	const text = read(file);

	for (const token of mentioned(text))
		assert.ok(exists(token), file + ' mentions ' + token + ', which does not exist');

	for (const command of commands(text)) {
		if (command.script)
			assert.ok(pkg.scripts[command.script], file + ' runs "npm run ' + command.script + '", which is not a script of package.json');
		else
			assert.ok(Fs.existsSync(Path.join(ROOT, command.file)), file + ' runs ' + command.file + ', which does not exist');
	}
}

const SKILLS = Fs.readdirSync(Path.join(ROOT, '.claude', 'skills'));

describe('AGENTS.md', function() {

	test('what it mentions exists: the paths and the commands', function() {
		check('AGENTS.md');
	});

	test('it says how to use TotalFusion with each runtime and with Total.js', function() {

		const text = read('AGENTS.md');

		for (const word of ['Python', 'Rust', 'Go', 'WebAssembly', 'fusion.register', 'fusion.configure', 'doctor', 'MCP', 'llms.txt'])
			assert.ok(text.includes(word), 'AGENTS.md does not mention ' + word);
	});

	test('it is for any agent: it does not carry the personal way of working of the maintainers', function() {

		for (const file of ['AGENTS.md', 'CLAUDE.md', 'GEMINI.md', '.github/copilot-instructions.md', 'docs/ai.md', ...SKILLS.map(name => '.claude/skills/' + name + '/SKILL.md')]) {
			const text = read(file);
			assert.ok(!/Co-Authored-By|Generated with|the owner|commit only when|never push/i.test(text), file + ' has rules that are not about the project');
		}
	});

	test('it is in the package, so an agent finds it in node_modules/totalfusion', function() {
		assert.ok(pkg.files.includes('AGENTS.md'));
		assert.ok(pkg.files.includes('llms.txt'));
		assert.ok(pkg.files.includes('schemas'));
	});

});

describe('the files for each agent lead to AGENTS.md', function() {

	test('Claude Code and Gemini import it', function() {
		assert.match(read('CLAUDE.md'), /^@AGENTS\.md$/m);
		assert.match(read('GEMINI.md'), /^@AGENTS\.md$/m);
	});

	test('Copilot has the rules that matter most and says where the rest is', function() {

		const text = read('.github/copilot-instructions.md');

		assert.ok(text.includes('AGENTS.md'));
		assert.ok(text.includes('npm test'));
		check('.github/copilot-instructions.md');
	});

	test('CLAUDE.md names the skills that exist', function() {
		const text = read('CLAUDE.md');
		assert.ok(text.includes('.claude/skills/'));
		assert.deepEqual(SKILLS.sort(), ['totalfusion-add-function', 'totalfusion-add-tutorial', 'totalfusion-diagnose-worker']);

		// it says how many there are
		assert.ok(text.includes('three skills') || text.includes('skills of this repository'));
	});

});

describe('the skills', function() {

	test('every skill has a name that is its folder and a description that says when to use it', function() {

		for (const name of SKILLS) {

			const text = read('.claude/skills/' + name + '/SKILL.md');
			const front = /^---\nname: (.+)\ndescription: (.+)\n---\n/.exec(text);

			assert.ok(front, name + ' has no frontmatter with name and description');
			assert.equal(front[1], name);
			assert.match(front[2], /^Use (when|before)/, name + ': the description must say when to use it');
			assert.ok(front[2].length > 60, name + ': the description is too short');
		}
	});

	test('what the skills mention exists', function() {
		for (const name of SKILLS)
			check('.claude/skills/' + name + '/SKILL.md');
	});

	test('the page for assistants mentions what exists', function() {
		check('docs/ai.md');
	});

});

describe('llms.txt and llms-full.txt', function() {

	test('they are what the pages say: run node scripts/llms.js --write', function() {
		assert.equal(read('llms.txt'), llms.index());
		assert.equal(read('llms-full.txt'), llms.full());
	});

	test('every page of the documentation is listed, and every page listed exists', function() {

		const listed = new Set(llms.PAGES.map(page => page[1]));

		for (const file of listed)
			assert.ok(Fs.existsSync(Path.join(ROOT, file)), file + ' is listed in scripts/llms.js and does not exist');

		const pages = [
			...Fs.readdirSync(Path.join(ROOT, 'docs')).filter(name => name.endsWith('.md') && name !== 'README.md').map(name => 'docs/' + name),
			...Fs.readdirSync(Path.join(ROOT, 'docs', 'tutorials')).filter(name => name.endsWith('.md')).map(name => 'docs/tutorials/' + name)
		];

		assert.deepEqual(pages.filter(page => !listed.has(page)), [], 'pages that are not in scripts/llms.js');
	});

	test('the links lead to the files, and the format is the one of llmstxt.org', function() {

		const text = read('llms.txt');
		const lines = text.split('\n');

		assert.equal(lines[0], '# TotalFusion');
		assert.ok(lines[2].startsWith('> '));

		const links = [...text.matchAll(/^- \[[^\]]+\]\((https:\/\/[^)]+)\): .+$/gm)].map(match => match[1]);

		assert.equal(links.length, llms.PAGES.length);

		for (const link of links) {
			const file = link.replace('https://raw.githubusercontent.com/totaljs-es/totalfusion/main/', '');
			assert.ok(Fs.existsSync(Path.join(ROOT, file)), link + ' leads to a file that does not exist');
		}
	});

	test('llms-full.txt has every page, in order', function() {

		const text = read('llms-full.txt');
		let at = 0;

		for (const [, file] of llms.PAGES) {
			const found = text.indexOf('<!-- ', at);
			assert.ok(found !== -1 && text.indexOf(': ' + file + ' -->', found) !== -1, file + ' is missing or out of order');
			at = text.indexOf(': ' + file + ' -->', found);
		}
	});

});

describe('the schemas', function() {

	const configure = JSON.parse(read('schemas/configure.schema.json'));
	const contract = JSON.parse(read('schemas/contract.schema.json'));

	test('the options of the pool are the ones of the code, and each one has a description', function() {

		const pool = configure.$defs.pool.properties;

		assert.deepEqual(Object.keys(pool).sort(), [...KEYS, 'env'].sort());

		for (const [key, value] of Object.entries(pool))
			assert.ok(value.description, key + ' has no description');
	});

	test('the defaults are the ones of the pool', function() {

		const pool = configure.$defs.pool.properties;
		const reference = read('docs/reference.md');

		const expected = { workers: 1, concurrency: 1, timeout: 30000, maxQueue: 1000, startTimeout: 30000, cancelGrace: 2000, healthInterval: 10000, healthTimeout: 10000, forwardStderr: true };

		for (const [key, value] of Object.entries(expected)) {
			assert.equal(pool[key].default, value, key);
			assert.ok(reference.includes('`' + key + '`'), key + ' is not in the reference');
		}
	});

	test('there is a runtime for every adapter, with the options that its adapter reads', function() {

		const adapters = [...read('index.js').match(/const ADAPTERS = \{([\s\S]*?)\n\};/)[1].matchAll(/^\s*(\w+):/gm)].map(match => match[1]);

		assert.deepEqual(Object.keys(configure.properties).sort(), adapters.sort());

		assert.deepEqual(Object.keys(configure.properties.python.properties).sort(), ['path', 'preload', 'python', 'requirements', 'venv']);
		assert.deepEqual(Object.keys(configure.$defs.native.properties).sort(), ['args', 'binary', 'cwd', 'shadowCopy']);
		assert.deepEqual(Object.keys(configure.properties.wasm.properties).sort(), ['cwd', 'module']);
		assert.deepEqual(configure.properties.wasm.required, ['module']);
	});

	test('the options of a call are the ones that the pool reads', function() {
		assert.deepEqual(Object.keys(configure.$defs.callOptions.properties).sort(), ['highWaterMark', 'idempotent', 'retries', 'timeout']);
		assert.equal(configure.$defs.callOptions.properties.highWaterMark.default, 16);
	});

	test('the contract has what register() reads, and what the three languages declare', function() {

		const registered = JSON.parse(/const KEYS = (\[[^\]]*\])/.exec(read('total5/index.js'))[1].replace(/'/g, '"'));
		const properties = Object.keys(contract.$defs.contract.properties);

		for (const key of [...registered, 'summary', 'mcp', 'idempotent', 'timeout', 'id'])
			assert.ok(properties.includes(key), 'the contract does not have ' + key);

		assert.deepEqual(contract.$defs.describe.properties.runtime.enum.sort(), Object.keys(configure.properties).sort());
		assert.equal(contract.$defs.describe.properties.protocol.const, 2);
	});

	test('they are valid JSON Schema documents of the draft that they say', function() {

		for (const schema of [configure, contract]) {
			assert.equal(schema.$schema, 'https://json-schema.org/draft/2020-12/schema');
			assert.match(schema.$id, /^https:\/\/raw\.githubusercontent\.com\/totaljs-es\/totalfusion\/main\/schemas\/.+\.schema\.json$/);
			assert.ok(schema.title && schema.description);
		}
	});

});
