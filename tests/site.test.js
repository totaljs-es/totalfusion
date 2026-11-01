'use strict';

// The website is built from the documentation: every page must exist, every link and anchor of it must lead somewhere,
// and nothing is loaded from outside (no fonts, no scripts, no trackers).

const { test } = require('node:test');
const assert = require('node:assert/strict');
const Path = require('path');
const Fs = require('fs');
const Os = require('os');

const { build, highlight } = require('../scripts/build-site.js');

const dist = Fs.mkdtempSync(Path.join(Os.tmpdir(), 'totalfusion-site-'));
const result = build(dist);

function pages(directory = dist) {
	let found = [];
	for (const entry of Fs.readdirSync(directory, { withFileTypes: true })) {
		const full = Path.join(directory, entry.name);
		if (entry.isDirectory())
			found = found.concat(pages(full));
		else if (entry.name.endsWith('.html'))
			found.push(full);
	}
	return found;
}

test('every page of the documentation is a page of the website', () => {

	const docs = Path.join(__dirname, '..', 'docs');
	const expected = Fs.readdirSync(docs).filter(name => name.endsWith('.md')).length + Fs.readdirSync(Path.join(docs, 'tutorials')).filter(name => name.endsWith('.md')).length + 1; // the changelog

	assert.equal(result.pages, expected);
	assert.ok(Fs.existsSync(Path.join(dist, 'index.html')));
	assert.ok(Fs.existsSync(Path.join(dist, 'docs', 'getting-started.html')));
	assert.ok(Fs.existsSync(Path.join(dist, 'docs', 'tutorials', 'index.html')));
});

test('every link, image and anchor leads somewhere', () => {

	const ids = {};

	for (const file of pages())
		ids[file] = new Set([...Fs.readFileSync(file, 'utf8').matchAll(/\sid="([^"]+)"/g)].map(match => match[1]));

	const problems = [];

	for (const file of pages()) {

		const html = Fs.readFileSync(file, 'utf8');

		for (const match of html.matchAll(/\s(?:href|src)="([^"]*)"/g)) {

			const url = match[1];

			if (/^[a-z][a-z0-9+.-]*:/i.test(url))
				continue;

			// The page that does not exist uses absolute addresses of the published site
			if (file.endsWith('404.html') && url.startsWith('http'))
				continue;

			const [target, fragment] = url.split('#');
			const resolved = target ? Path.join(Path.dirname(file), target) : file;

			if (!Fs.existsSync(resolved)) {
				problems.push(Path.relative(dist, file) + ' -> ' + url);
				continue;
			}

			if (fragment && resolved.endsWith('.html') && !ids[resolved].has(fragment))
				problems.push(Path.relative(dist, file) + ' -> ' + url + ' (no such anchor)');
		}
	}

	assert.deepEqual(problems, []);
});

test('nothing is loaded from outside, and the pages declare it', () => {

	const problems = [];

	for (const file of pages()) {

		const html = Fs.readFileSync(file, 'utf8');

		if (!/Content-Security-Policy/.test(html))
			problems.push(Path.relative(dist, file) + ' has no Content-Security-Policy');

		// Only the links that the person follows may leave the site; what the page loads may not
		// (the page that does not exist loads its own files by their address on the site)
		for (const match of html.matchAll(/<(script|img|link rel="stylesheet"|iframe)\b[^>]*\s(?:src|href)="(https?:)?\/\/(?!totaljs-es\.github\.io\/totalfusion\/)[^"]+"/g))
			problems.push(Path.relative(dist, file) + ' loads ' + match[0]);

		if (/\sstyle="/.test(html) || /<script>/.test(html))
			problems.push(Path.relative(dist, file) + ' has inline style or script, the policy forbids it');
	}

	assert.deepEqual(problems, []);
});

test('the sitemap lists every page', () => {

	const sitemap = Fs.readFileSync(Path.join(dist, 'sitemap.xml'), 'utf8');

	for (const file of pages()) {
		const relative = Path.relative(dist, file).split(Path.sep).join('/');
		if (relative !== '404.html')
			assert.ok(sitemap.includes('<loc>https://totaljs-es.github.io/totalfusion/' + (relative === 'index.html' ? '' : relative) + '</loc>'), relative + ' is not in the sitemap');
	}
});

test('the search index has every page', () => {

	const index = JSON.parse(Fs.readFileSync(Path.join(dist, 'search.json'), 'utf8'));
	const urls = new Set(index.map(entry => entry.u.split('#')[0]));

	assert.ok(urls.has('docs/getting-started.html'));
	assert.ok(urls.has('docs/tutorials/01-python-action-and-mcp.html'));
	assert.ok(index.every(entry => entry.t && entry.h));
});

test('code is escaped, never interpreted', () => {

	assert.equal(highlight('<script>alert()</script>', 'bash'), '&lt;script&gt;alert()&lt;/script&gt;');
	assert.ok(highlight('const a = "<b>"; // x < y', 'js').includes('&lt;b&gt;'));
	assert.equal(highlight('a < b', 'unknown'), 'a &lt; b');
});

test.after(() => Fs.rmSync(dist, { recursive: true, force: true }));
