const fusion = REQUIRE('totalfusion');

exports.install = function() {

	// Every function of python/ that declares its contract (@action) becomes a Total.js action.
	// watch: edit python/sentiment.py while the application runs and the next request uses the new code.
	fusion.register({ python: { path: PATH.root('python') }, watch: DEBUG }).then(function(result) {
		console.log('TotalFusion actions:', result.ids.join(', '));
	});

	// The action is an API endpoint like any other
	ROUTE('API  /api/  +sentiment_analyze  -->  sentiment/analyze');
};
