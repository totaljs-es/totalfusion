'use strict';

// Checks what the tutorial says, against the application that is running: npm run verify
const assert = require('node:assert/strict');

const base = 'http://127.0.0.1:' + (process.env.PORT || 8000);

async function post(path, body) {
	const response = await fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(10000) });

	// A route that does not exist answers with a page, not with JSON
	const text = await response.text();

	try {
		return { status: response.status, body: JSON.parse(text) };
	} catch {
		return { status: response.status, body: text };
	}
}

const api = text => post('/api/', { schema: 'sentiment_analyze', data: text });
const rpc = (id, method, params) => post('/$mcp/', { jsonrpc: '2.0', id, method, params });
const mcp = (id, method, params) => rpc(id, method, params).then(response => response.body.result);
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

// The actions are registered a moment after the application starts
async function ready() {
	for (let i = 0; i < 100; i++) {
		try {
			if ((await api({ text: 'ready' })).status === 200)
				return;
		} catch {}
		await wait(200);
	}
	throw new Error('The application did not answer: is it running? (npm start)');
}

// The MCP endpoint is in the repository of Total.js 5 but not in the release 0.0.19 of the npm package: there the address answers
// 404. The tools of the agents are registered a moment after the actions.
async function agents() {
	for (let i = 0; i < 50; i++) {

		const response = await rpc(0, 'tools/list');

		if (response.status === 404)
			return false;

		if (response.body && response.body.result && response.body.result.tools.length)
			return true;

		await wait(200);
	}
	throw new Error('The MCP endpoint answers, but the tool was not registered');
}

(async function() {

	await ready();

	// 1. The action as an API
	let response = await api({ text: 'I love how fast it works!' });
	assert.equal(response.status, 200);
	assert.deepEqual(response.body, { label: 'POSITIVE', score: 3 });

	response = await api({ text: 'This is terrible and broken' });
	assert.deepEqual(response.body, { label: 'NEGATIVE', score: -2 });

	response = await api({ text: 'A table with four legs' });
	assert.deepEqual(response.body, { label: 'NEUTRAL', score: 0 });

	// 2. Total.js validates before Python is reached
	response = await api({});
	assert.equal(response.status, 400);
	assert.equal(response.body[0].path, 'text');

	// 3. The same action as a tool for an AI agent
	if (!await agents()) {
		console.log('Verified: the API and the validation. The tool for agents was NOT checked: this Total.js has no MCP endpoint (the release 0.0.19 of the npm package does not have it).');
		return;
	}

	const tools = (await mcp(1, 'tools/list')).tools;
	assert.deepEqual(tools.map(tool => tool.name), ['sentiment_analyze']);
	assert.equal(tools[0].description, 'Detects whether a text is positive, negative or neutral');
	assert.deepEqual(tools[0].inputSchema.properties.input.required, ['text']);

	let result = await mcp(2, 'tools/call', { name: 'sentiment_analyze', arguments: { input: { text: 'This is terrible and broken' } } });
	assert.deepEqual(result.structuredContent, { label: 'NEGATIVE', score: -2 });
	assert.equal(result.isError, undefined);

	result = await mcp(3, 'tools/call', { name: 'sentiment_analyze', arguments: { input: {} } });
	assert.equal(result.isError, true);

	console.log('Verified: the API, the validation and the tool for agents');

})().catch(function(err) {
	console.error(err);
	process.exitCode = 1;
});
