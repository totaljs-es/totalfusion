// The modules of the customers. Each one runs in a worker of its own, in the sandbox of WebAssembly:
// a runtime of TotalFusion has one module, so each customer gets its own Fusion.
const { Fusion } = REQUIRE('totalfusion');

const plugins = new Map();

function load(name) {
	plugins.set(name, new Fusion({ wasm: { module: PATH.root('plugins/' + name + '.wasm'), timeout: 1000, cancelGrace: 200, forwardStderr: false } }));
}

// What each module offers, read without running any function
async function list($) {

	const output = {};

	for (const [name, plugin] of plugins) {
		const found = await plugin.describe('wasm');
		output[name] = found.actions.map(item => ({ fn: item.fn, summary: item.meta.summary || '' }));
	}

	$.json(output);
}

// Runs a function of a module with the body of the request as its argument
function run($) {

	const plugin = plugins.get($.params.name);

	if (!plugin) {
		$.invalid(404);
		return;
	}

	// /plugins/rules/discount/apply/ is the function "discount.apply" (a dot in a route would look like a file)
	plugin.wasm($.params.module + '.' + $.params.fn, $.body).then(result => $.json(result), function(err) {
		// The code says what happened (REMOTE_ERROR, TIMEOUT, NOT_FOUND...) and the message is the first line of the error
		$.invalid(err.code + ': ' + err.message.split('\n')[0]);
	});
}

exports.install = function() {

	load('rules');
	load('hostile');

	ROUTE('GET /plugins/', list);
	ROUTE('POST /plugins/{name}/{module}/{fn}/', run);
};
