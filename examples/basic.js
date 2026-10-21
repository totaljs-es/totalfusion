'use strict';

const fusion = require('..');

fusion.configure({ python: { path: __dirname + '/components', workers: 2, timeout: 10000 } });

(async function() {

	const result = await fusion.python('analyzer.analyze', { text: 'TotalFusion calls Python from Node.js' });
	console.log(result);

	try {
		await fusion.python('analyzer.analyze', { text: null });
	} catch (err) {
		console.log(err.code, '-', err.message);
	}

	await fusion.shutdown();

})();
