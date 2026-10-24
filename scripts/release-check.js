'use strict';

// What has to be true before a release is published to npm. The workflow .github/workflows/publish.yml runs it with the tag of the
// release, and it can be run by hand:
//
//   node scripts/release-check.js v0.1.0
//
// It prints the problems that it finds and exits with 1, or exits with 0.

const Fs = require('fs');
const Path = require('path');

const ROOT = Path.join(__dirname, '..');

// The problems with publishing `tag` (for example "v0.1.0") from the folder `root`
exports.problems = function(tag, root) {

	root = root || ROOT;

	const read = file => Fs.readFileSync(Path.join(root, file), 'utf8').replace(/\r\n/g, '\n');
	const pkg = JSON.parse(read('package.json'));
	const found = [];

	if (pkg.private)
		found.push('package.json says "private": true, which npm refuses to publish. Remove it (and change the texts that say that the package is not on npm: the tests say which).');

	if (!tag)
		found.push('There is no tag. The release has to be tagged v' + pkg.version + '.');
	else if (tag !== 'v' + pkg.version)
		found.push('The tag is ' + tag + ' and package.json is version ' + pkg.version + '. The tag has to be v' + pkg.version + '.');

	const crate = /^version = "([^"]+)"/m.exec(read('rust/Cargo.toml'));
	const module = /^const Version = "([^"]+)"/m.exec(read('go/app.go'));

	if (!crate || crate[1] !== pkg.version)
		found.push('rust/Cargo.toml is version ' + (crate && crate[1]) + ', and package.json ' + pkg.version + '.');

	if (!module || module[1] !== pkg.version)
		found.push('go/app.go has version ' + (module && module[1]) + ', and package.json ' + pkg.version + '.');

	if (!new RegExp('^## ' + pkg.version.replace(/\./g, '\\.') + '$', 'm').test(read('CHANGELOG.md')))
		found.push('CHANGELOG.md has no heading "## ' + pkg.version + '".');

	return found;
};

if (require.main === module) {

	const tag = process.argv[2] || process.env.GITHUB_REF_NAME;
	const found = exports.problems(tag);

	if (found.length) {
		for (const problem of found)
			console.error('- ' + problem);
		process.exit(1);
	}

	const pkg = require('../package.json');
	console.log('Ready to publish ' + pkg.name + ' ' + pkg.version + ' (' + tag + ')');
}
