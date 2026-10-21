'use strict';

// Total.js 5 comes from TOTAL5_PATH, the "total5" package or a sibling checkout (../framework5)
const Path = require('path');
const Fs = require('fs');

module.exports = function() {

	const candidates = [process.env.TOTAL5_PATH, Path.join(__dirname, '..', '..', 'framework5')];

	try {
		candidates.push(Path.dirname(require.resolve('total5/package.json')));
	} catch {}

	return candidates.find(path => path && Fs.existsSync(Path.join(path, 'index.js')));
};
