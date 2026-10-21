const fusion = REQUIRE('totalfusion');

exports.install = function() {

	// Every function of python/ that declares its contract (@action) becomes a Total.js action.
	// watch: edit python/words.py while the application runs and the next request uses the new code.
	fusion.register({ python: { path: PATH.root('python') }, watch: DEBUG }).then(function(result) {
		console.log('TotalFusion actions:', result.ids.join(', '));
	});

	// The actions work like any other: ACTION(), API routes...
	ROUTE('API  /api/  +words_analyze  -->  words/analyze');

	// ...and a stream reaches the browser as Server-Sent Events
	ROUTE('GET /countdown/', function($) {
		fusion.sse($, fusion.python.stream('words.countdown', { from: +$.query.from || 5 }));
	});
};
