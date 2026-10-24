'use strict';

// The files for the models that read the documentation: llms.txt (an index, in the format of https://llmstxt.org) and llms-full.txt
// (the documentation in one file, to give a model all of it at once). They are built from the pages of the repository, so they cannot
// differ from them, and a test checks that every page is listed.
//
//   node scripts/llms.js            prints llms.txt
//   node scripts/llms.js --write    writes llms.txt and llms-full.txt

const Fs = require('fs');
const Path = require('path');

const ROOT = Path.join(__dirname, '..');
const BASE = 'https://raw.githubusercontent.com/totaljs-es/totalfusion/main/';

const SUMMARY = 'TotalFusion extends Total.js 5 with other runtimes: functions written in Python, Rust, Go and WebAssembly are called from Node.js and Total.js as `async` functions, and become actions, API routes, MCP tools for AI agents, Server-Sent Events and nodes of Flow. Each runtime is a pool of worker processes that Node.js supervises; a crash in a worker never takes the application down. A WebAssembly module runs in a sandbox: no files, no network, no environment.';

const DETAILS = 'Node.js 20 or newer, no dependencies, plain JavaScript (no TypeScript). Version 0.1.0, not on npm yet: install it from a clone with `npm install ../totalfusion`. The engine (`require(\'totalfusion\')`) does not depend on Total.js; `fusion.register()`, `fusion.sse()` and `fusion.flow()` do. Nothing is downloaded, compiled or installed for the user. MIT license.';

// Every page, in the order in which it is read: [section, file, title, what it says]
const PAGES = [
	['Start here', 'README.md', 'README', 'What it is, what you get, install and status'],
	['Start here', 'AGENTS.md', 'AGENTS.md', 'For an agent: how to use TotalFusion in an application and how to work on the repository'],
	['Start here', 'docs/ai.md', 'Using TotalFusion with AI assistants', 'The files for models, the schemas, and your functions as tools for agents'],
	['Start here', 'docs/getting-started.md', 'Getting started', 'Install it, call a first function, make it an action'],
	['Start here', 'docs/use-cases.md', 'Use cases', 'What it is good for, with the numbers that were measured'],
	['Runtimes', 'docs/python.md', 'Python', 'Components, the @action contract, libraries, virtual environments'],
	['Runtimes', 'docs/rust.md', 'Rust', 'A worker with the totalfusion crate'],
	['Runtimes', 'rust/README.md', 'The Rust crate', 'The whole API of the crate'],
	['Runtimes', 'docs/go.md', 'Go', 'A worker with the totalfusion module'],
	['Runtimes', 'go/README.md', 'The Go module', 'The whole API of the module, and WebAssembly from Go'],
	['Runtimes', 'docs/webassembly.md', 'WebAssembly', 'Modules in a sandbox, and the ABI for other languages'],
	['Total.js', 'docs/total5.md', 'Total.js 5', 'Actions, validation, permissions, API routes, MCP tools, Server-Sent Events'],
	['Total.js', 'docs/flow.md', 'Flow', 'Seven components for Total.js Flow'],
	['Features', 'docs/binary-data.md', 'Binary data', 'Buffers and typed arrays without base64'],
	['Features', 'docs/streaming.md', 'Streaming', 'Generators as async iterables, backpressure, cancellation'],
	['Features', 'docs/workers.md', 'Working with the workers', 'Concurrency, recycling, health check, events, retrying'],
	['Features', 'docs/errors.md', 'Errors and cancellation', 'Every error code'],
	['Features', 'docs/development.md', 'Development and diagnosis', 'Reload on change, and the doctor'],
	['Features', 'docs/security.md', 'Security', 'What it protects and what it does not'],
	['Reference', 'docs/reference.md', 'Reference', 'Every option, method and command'],
	['Reference', 'docs/how-it-works.md', 'How it works', 'The pool, the workers and the protocol'],
	['Reference', 'schemas/configure.schema.json', 'Schema of the configuration', 'JSON Schema of fusion.configure() and of the options of a call'],
	['Reference', 'schemas/contract.schema.json', 'Schema of a contract', 'JSON Schema of the contract of a function and of what --describe prints'],
	['Tutorials', 'docs/tutorials/README.md', 'Tutorials', 'The list, with what each one needs'],
	['Tutorials', 'docs/tutorials/01-python-action-and-mcp.md', 'A Python function as an API and as a tool for an AI agent', 'Contract, validation, MCP, live reload'],
	['Tutorials', 'docs/tutorials/02-wasm-sandbox.md', 'The code of third parties in the sandbox of WebAssembly', 'One module for each customer, a hostile module, a timeout'],
	['Optional', 'CHANGELOG.md', 'Changelog', 'What each version contains'],
	['Optional', 'CONTRIBUTING.md', 'Contributing', 'Tests and how the project is organised']
];

exports.PAGES = PAGES;

exports.index = function() {

	const lines = ['# TotalFusion', '', '> ' + SUMMARY, '', DETAILS, ''];
	let section = null;

	for (const [name, file, title, what] of PAGES) {

		if (name !== section) {
			section = name;
			lines.push('## ' + name, '');
		}

		lines.push('- [' + title + '](' + BASE + file + '): ' + what);
	}

	return lines.join('\n') + '\n';
};

exports.full = function() {

	const parts = ['# TotalFusion: the documentation in one file', '', '> ' + SUMMARY, '', DETAILS];

	for (const [, file, title] of PAGES) {
		const text = Fs.readFileSync(Path.join(ROOT, file), 'utf8').replace(/\r\n/g, '\n').trimEnd();
		parts.push('', '---', '', '<!-- ' + title + ': ' + file + ' -->', '', text);
	}

	return parts.join('\n') + '\n';
};

if (require.main === module) {
	if (process.argv.includes('--write')) {
		Fs.writeFileSync(Path.join(ROOT, 'llms.txt'), exports.index());
		Fs.writeFileSync(Path.join(ROOT, 'llms-full.txt'), exports.full());
	} else
		process.stdout.write(exports.index());
}
