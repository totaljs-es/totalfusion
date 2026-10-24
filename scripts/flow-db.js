'use strict';

// The list of the components of TotalFusion for Flow: total5/flow/db.json, in the format of the list of Total.js
// (https://cdn.totaljs.com/flowstream/webcomponents/db.json). It is built from the files of the components, so it cannot differ from them.
//
//   node scripts/flow-db.js                     prints the list
//   node scripts/flow-db.js --write             writes total5/flow/db.json
//   node scripts/flow-db.js --base http://localhost:8000/fusion/ --out file.json   with another address for the files (to try them in a local Flow)

const Fs = require('fs');
const Path = require('path');

const DIRECTORY = Path.join(__dirname, '..', 'total5', 'flow');
const BASE = 'https://raw.githubusercontent.com/totaljs-es/totalfusion/main/total5/flow/';

// The order in which they are offered
const ORDER = ['fusionpython', 'fusionrust', 'fusiongo', 'fusionwasm', 'fusionstream', 'fusionevents', 'fusionstats'];

function value(source, name) {
	const match = new RegExp('exports\\.' + name + " = '([^']*)'").exec(source);

	if (!match)
		throw new Error('The component does not declare exports.' + name);

	return match[1];
}

exports.build = function(base) {

	const items = Fs.readdirSync(DIRECTORY).filter(file => file.endsWith('.html')).map(function(file) {

		const source = Fs.readFileSync(Path.join(DIRECTORY, file), 'utf8').replace(/\r\n/g, '\n');
		const readme = /<readme>\n([\s\S]*?)\n<\/readme>/.exec(source);

		return {
			id: value(source, 'id'),
			group: value(source, 'group'),
			name: value(source, 'name'),
			url: (base || BASE) + file,
			author: value(source, 'author'),
			icon: value(source, 'icon'),
			color: '',
			version: value(source, 'version'),
			kind: '',
			readme: readme ? readme[1] : ''
		};
	});

	return items.sort((a, b) => ORDER.indexOf(a.id) - ORDER.indexOf(b.id));
};

exports.text = base => JSON.stringify(exports.build(base), null, '\t') + '\n';

if (require.main === module) {

	const args = process.argv.slice(2);
	const base = args.includes('--base') ? args[args.indexOf('--base') + 1] : null;

	if (args.includes('--out'))
		Fs.writeFileSync(args[args.indexOf('--out') + 1], exports.text(base));
	else if (args.includes('--write'))
		Fs.writeFileSync(Path.join(DIRECTORY, 'db.json'), exports.text(base));
	else
		process.stdout.write(exports.text(base));
}
