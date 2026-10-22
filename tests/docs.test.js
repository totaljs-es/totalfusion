'use strict';

// The documentation is part of the product: every link and every anchor must lead somewhere, and every page must be reachable.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const Path = require('path');
const Fs = require('fs');

const ROOT = Path.join(__dirname, '..');
const DOCS = Path.join(ROOT, 'docs');

const PAGES = [
	'README.md', 'CHANGELOG.md', 'CONTRIBUTING.md', Path.join('rust', 'README.md'), Path.join('examples', 'totaljs-app', 'README.md'), Path.join('examples', 'totaljs-numerics', 'README.md'),
	...Fs.readdirSync(DOCS).filter(name => name.endsWith('.md')).map(name => Path.join('docs', name))
];

// The text of a page without its code blocks
function prose(file) {

	let fenced = false;
	const lines = [];

	// A checkout on Windows has CRLF line endings
	for (const line of Fs.readFileSync(Path.join(ROOT, file), 'utf8').split(/\r?\n/)) {
		if (line.startsWith('```'))
			fenced = !fenced;
		else if (!fenced)
			lines.push(line);
	}

	return lines;
}

// The anchors that GitHub gives to the headings of a page
function anchors(file) {

	const found = new Set();
	const seen = {};

	for (const line of prose(file)) {

		const match = /^#{1,6} (.+)$/.exec(line);

		if (!match)
			continue;

		const slug = match[1].replace(/`|\*\*|\*/g, '').trim().toLowerCase().replace(/[^\p{L}\p{N}\s_-]/gu, '').replace(/\s/g, '-');
		found.add(seen[slug] ? slug + '-' + seen[slug] : slug);
		seen[slug] = (seen[slug] || 0) + 1;
	}

	return found;
}

function links(file) {
	const found = [];
	for (const line of prose(file)) {
		// Not the text inside `code`
		for (const match of line.replace(/`[^`]*`/g, '').matchAll(/\[[^\]]*\]\(([^)\s]+)\)/g))
			found.push(match[1]);
	}
	return found;
}

test('every link of the documentation leads to a file that exists', function() {

	const broken = [];

	for (const file of PAGES) {
		for (const target of links(file)) {

			if (/^(https?:|mailto:)/.test(target))
				continue;

			const [path] = target.split('#');
			const resolved = path ? Path.join(ROOT, Path.dirname(file), path) : Path.join(ROOT, file);

			if (!Fs.existsSync(resolved))
				broken.push(file + ' -> ' + target);
		}
	}

	assert.deepEqual(broken, []);
});

test('every anchor of the documentation leads to a heading that exists', function() {

	const broken = [];

	for (const file of PAGES) {
		for (const target of links(file)) {

			if (/^(https?:|mailto:)/.test(target) || !target.includes('#'))
				continue;

			const [path, anchor] = target.split('#');
			const page = path ? Path.normalize(Path.join(Path.dirname(file), path)) : file;

			if (!page.endsWith('.md') || !Fs.existsSync(Path.join(ROOT, page)))
				continue;

			if (!anchors(page).has(anchor))
				broken.push(file + ' -> ' + target);
		}
	}

	assert.deepEqual(broken, []);
});

test('the images and the HTML links lead to files that exist, and every image has a text for those who cannot see it', function() {

	const broken = [];

	for (const file of PAGES) {

		const text = prose(file).join('\n');

		for (const image of text.matchAll(/<img\b[^>]*>/g)) {
			if (!/\balt="[^"]+"/.test(image[0]))
				broken.push(file + ': ' + image[0] + ' has no alt text');
		}

		for (const match of text.matchAll(/\b(?:src|href)="([^"]+)"/g)) {

			const target = match[1];

			if (/^(https?:|mailto:|#)/.test(target))
				continue;

			if (!Fs.existsSync(Path.join(ROOT, Path.dirname(file), target.split('#')[0])))
				broken.push(file + ' -> ' + target);
		}
	}

	assert.deepEqual(broken, []);
});

test('every page of docs/ is reachable from the index', function() {

	const indexed = new Set(links(Path.join('docs', 'README.md')).map(target => target.split('#')[0]));
	const orphans = Fs.readdirSync(DOCS).filter(name => name.endsWith('.md') && name !== 'README.md' && !indexed.has(name));

	assert.deepEqual(orphans, []);
});

test('the project README leads to the documentation', function() {

	const targets = new Set(links('README.md').map(target => target.split('#')[0]));

	for (const name of Fs.readdirSync(DOCS).filter(name => name.endsWith('.md') && name !== 'README.md'))
		assert.ok(targets.has('docs/' + name), 'README.md does not link docs/' + name);
});

test('every page has one title, its headings do not skip a level, and its code blocks are closed', function() {

	for (const file of PAGES) {

		const text = Fs.readFileSync(Path.join(ROOT, file), 'utf8');
		assert.equal(text.split('\n').filter(line => line.startsWith('```')).length % 2, 0, file + ' has a code block that is not closed');

		let previous = 0;
		let titles = 0;

		for (const line of prose(file)) {

			const match = /^(#{1,6}) /.exec(line);

			if (!match)
				continue;

			const level = match[1].length;
			titles += level === 1 ? 1 : 0;
			assert.ok(level <= previous + 1, file + ': "' + line + '" skips a level');
			previous = level;
		}

		assert.equal(titles, 1, file + ' must have exactly one title');
	}
});

test('what the documentation says about the package matches the package', function() {

	const pack = JSON.parse(Fs.readFileSync(Path.join(ROOT, 'package.json'), 'utf8'));
	const crate = /^version = "([^"]+)"/m.exec(Fs.readFileSync(Path.join(ROOT, 'rust', 'Cargo.toml'), 'utf8'))[1];

	// The versions that the pages quote
	for (const file of PAGES) {
		for (const match of Fs.readFileSync(Path.join(ROOT, file), 'utf8').matchAll(/totalfusion crate (\d+\.\d+\.\d+)/g))
			assert.equal(match[1], crate, file + ' quotes the crate ' + match[1]);
	}

	// The options that the reference documents are the ones the runtimes read
	const reference = Fs.readFileSync(Path.join(DOCS, 'reference.md'), 'utf8');
	const KEYS = require('../lib/options').KEYS;

	for (const key of KEYS)
		assert.ok(reference.includes('`' + key + '`'), 'docs/reference.md does not document the option ' + key);

	assert.ok(pack.files.includes('docs'), 'docs/ is not in the package');
});
