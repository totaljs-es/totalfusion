'use strict';

// The publication to npm: the checks that run before it, the workflow, and the texts that say whether the package is on npm.

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const Path = require('path');
const Fs = require('fs');
const Os = require('os');
const { problems } = require('../scripts/release-check');

const ROOT = Path.join(__dirname, '..');
const read = file => Fs.readFileSync(Path.join(ROOT, file), 'utf8').replace(/\r\n/g, '\n');
const pkg = JSON.parse(read('package.json'));

describe('the checks before a release', function() {

	test('a package that is private, or a tag that is not the version, is a problem', function() {
		assert.ok(problems('v' + pkg.version).some(text => /private/.test(text)) === !!pkg.private);
		assert.ok(problems('v9.9.9').some(text => /The tag is v9\.9\.9/.test(text)));
		assert.ok(problems('').some(text => /no tag/.test(text)));
	});

	test('everything in order gives no problem, and a version that differs is told', function() {

		const root = Fs.mkdtempSync(Path.join(Os.tmpdir(), 'totalfusion-release-'));

		try {
			for (const file of ['package.json', 'rust/Cargo.toml', 'go/app.go', 'CHANGELOG.md']) {
				Fs.mkdirSync(Path.dirname(Path.join(root, file)), { recursive: true });
				Fs.copyFileSync(Path.join(ROOT, file), Path.join(root, file));
			}

			const manifest = JSON.parse(read('package.json'));
			delete manifest.private;
			Fs.writeFileSync(Path.join(root, 'package.json'), JSON.stringify(manifest));

			assert.deepEqual(problems('v' + manifest.version, root), []);

			Fs.writeFileSync(Path.join(root, 'rust', 'Cargo.toml'), read('rust/Cargo.toml').replace(/^version = ".*"/m, 'version = "9.9.9"'));
			assert.match(problems('v' + manifest.version, root).join('\n'), /rust\/Cargo\.toml is version 9\.9\.9/);
		} finally {
			Fs.rmSync(root, { recursive: true, force: true });
		}
	});

});

describe('the workflow that publishes', function() {

	const workflow = read('.github/workflows/publish.yml');

	test('it runs on a release, after the tests, with the identity that trusted publishing needs', function() {
		assert.match(workflow, /on:\n  release:\n    types: \[published\]/);
		assert.match(workflow, /uses: \.\/\.github\/workflows\/test\.yml/);
		assert.match(workflow, /needs: tests/);
		assert.match(workflow, /id-token: write/);
		assert.match(workflow, /registry-url: https:\/\/registry\.npmjs\.org/);
		assert.match(read('.github/workflows/test.yml'), /^  workflow_call:$/m);
	});

	test('it checks the release before it publishes, and publishes with a token or without one', function() {
		assert.ok(workflow.indexOf('release-check.js') < workflow.indexOf('npm publish'));
		assert.match(workflow, /npm publish --provenance --access public/);
		assert.match(workflow, /run: npm publish --access public/);
		assert.ok(!/npm_[A-Za-z0-9]{20,}/.test(workflow), 'a token is written in the workflow');
	});

	test('prepublishOnly runs the fast checks, because the tests ran before', function() {
		assert.equal(pkg.scripts.prepublishOnly, 'npm run check');
	});

});

describe('the texts say the truth about npm', function() {

	test('while the package is private they say that it is not on npm, and when it is not they say how to install it', function() {

		for (const file of ['README.md', 'docs/getting-started.md', 'AGENTS.md', 'scripts/llms.js']) {
			const text = read(file);

			if (pkg.private)
				assert.match(text, /not on npm yet/i, file + ' must say that the package is not on npm yet');
			else {
				assert.ok(!/not on npm yet/i.test(text), file + ' still says that the package is not on npm');
				assert.ok(text.includes('npm install totalfusion'), file + ' does not say how to install it');
			}
		}
	});

});
