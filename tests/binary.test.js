'use strict';

const { test, describe, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const Path = require('path');
const Crypto = require('crypto');
const { Fusion } = require('..');
const { encode, Decoder } = require('../lib/protocol');

const PATH = Path.join(__dirname, 'components');
const instances = [];

function create(options) {
	const fusion = new Fusion({ python: Object.assign({ path: PATH, forwardStderr: false }, options) });
	instances.push(fusion);
	return fusion;
}

afterEach(async function() {
	await Promise.all(instances.splice(0).map(fusion => fusion.shutdown()));
});

describe('node to python', function() {

	test('a Buffer arrives as bytes and keeps its content', async function() {
		const fusion = create();
		const blob = Crypto.randomBytes(1000);
		assert.equal(await fusion.python('binary.length', { blob }), 1000);
		assert.equal(await fusion.python('binary.sha256', { blob }), Crypto.createHash('sha256').update(blob).digest('hex'));
	});

	test('typed arrays arrive as memoryviews of the right type', async function() {
		const fusion = create();
		assert.equal(await fusion.python('binary.total', { values: new Float32Array([1.5, 2.5, 3]) }), 7);
		assert.equal(await fusion.python('binary.total', { values: new Float64Array([0.5, 0.25]) }), 0.75);
		assert.equal(await fusion.python('binary.total', { values: new Int32Array([-5, 10]) }), 5);
		assert.equal(await fusion.python('binary.total', { values: new BigInt64Array([2n ** 40n, 1n]) }), 2 ** 40 + 1);
	});

	test('a view of a bigger buffer sends only its own bytes', async function() {
		const fusion = create();
		const base = Buffer.from('0123456789');
		assert.equal(await fusion.python('binary.length', { blob: base.subarray(2, 6) }), 4);
		assert.equal(await fusion.python('binary.length', { blob: new Uint8Array(base.buffer, base.byteOffset + 1, 3) }), 3);
	});

	test('an ArrayBuffer and an empty buffer work', async function() {
		const fusion = create();
		assert.equal(await fusion.python('binary.length', { blob: new Uint8Array([1, 2, 3]).buffer }), 3);
		assert.equal(await fusion.python('binary.length', { blob: Buffer.alloc(0) }), 0);
	});

	test('binary data sits next to normal JSON', async function() {
		const fusion = create();
		const result = await fusion.python('binary.types', { blob: Buffer.from('x'), floats: new Float32Array(2), text: 'a', number: 1, list: [1, 2], nothing: null });
		assert.deepEqual(result, { blob: 'bytes', floats: 'memoryview', text: 'str', number: 'int', list: 'list', nothing: 'NoneType' });
	});

	test('"$bin" is a reserved key', async function() {
		const fusion = create();
		await assert.rejects(() => fusion.python('binary.echo', { $bin: 0, type: 'Uint8Array' }), { code: 'ENCODE_ERROR' });
	});

});

describe('python to node', function() {

	test('bytes arrive as a Buffer', async function() {
		const fusion = create();
		const result = await fusion.python('binary.make_bytes', { times: 2 });
		assert.ok(Buffer.isBuffer(result));
		assert.equal(result.length, 512);
		assert.equal(result[255], 255);
		assert.equal(result[256], 0);
	});

	test('bytearray and memoryview slices arrive as a Buffer', async function() {
		const fusion = create();
		assert.equal((await fusion.python('binary.make_bytearray')).toString(), 'abc');
		assert.deepEqual([...(await fusion.python('binary.make_view'))], [2, 3, 4, 5]);
	});

	test('array.array arrives as the matching typed array', async function() {
		const fusion = create();
		assert.deepEqual(await fusion.python('binary.make_floats'), new Float32Array([1.5, 2.5, 3.5]));
		assert.deepEqual(await fusion.python('binary.make_doubles'), new Float64Array([0.1, 0.2, 0.3]));
		assert.deepEqual(await fusion.python('binary.make_ints'), new Int32Array([-1, 0, 1, 2147483647]));
		assert.deepEqual(await fusion.python('binary.make_big'), new BigInt64Array([-1n, 9007199254740993n]));
	});

	test('binary data nested in the result is found', async function() {
		const fusion = create();
		const result = await fusion.python('binary.nested');
		assert.equal(result.a[0].toString(), 'x');
		assert.equal(result.a[1].toString(), 'yz');
		assert.equal(result.b.c.toString(), 'abc');
		assert.equal(result.n, 5);
		assert.equal(result.s, 'text');
	});

	test('an object that looks like a reference is left alone', async function() {
		const fusion = create();
		assert.deepEqual(await fusion.python('binary.confusable'), { $bin: 99, type: 'Uint8Array' });
	});

	test('an object that is not JSON nor binary is NOT_SERIALIZABLE', async function() {
		const fusion = create();
		await assert.rejects(() => fusion.python('binary.not_json'), { code: 'NOT_SERIALIZABLE' });
		assert.equal(await fusion.python('binary.length', { blob: Buffer.from('ab') }), 2);
	});

});

describe('round trip', function() {

	test('a 50 MB buffer comes back identical', async function() {
		const fusion = create();
		const blob = Crypto.randomBytes(50 * 1024 * 1024);
		const result = await fusion.python('binary.echo', { blob });
		assert.equal(result.blob.length, blob.length);
		assert.ok(result.blob.equals(blob));
	});

	test('a Float32Array of 5 million numbers comes back identical', async function() {
		const fusion = create();
		const values = new Float32Array(5_000_000).map((_, i) => Math.fround(Math.sin(i)));
		const result = await fusion.python('binary.echo', { values });
		assert.ok(result.values instanceof Float32Array);
		assert.deepEqual(result.values, values);
	});

	test('many concurrent calls with binary data do not mix up', async function() {
		const fusion = create({ workers: 3 });
		const blobs = Array.from({ length: 60 }, (_, i) => Buffer.alloc(1000 + i, i));
		const results = await Promise.all(blobs.map(blob => fusion.python('binary.echo', { blob })));
		results.forEach((result, i) => assert.ok(result.blob.equals(blobs[i])));
	});

});

describe('protocol', function() {

	test('the decoder rebuilds a frame that arrives in tiny chunks', function() {
		const received = [];
		const decoder = new Decoder(message => received.push(message));
		const frame = Buffer.concat(encode({ t: 'res', id: 1, ok: true, data: { blob: Buffer.from('hello'), floats: new Float32Array([1, 2]) } }));
		for (let i = 0; i < frame.length; i += 3)
			decoder.push(frame.subarray(i, i + 3));
		assert.equal(received.length, 1);
		assert.equal(received[0].data.blob.toString(), 'hello');
		assert.deepEqual(received[0].data.floats, new Float32Array([1, 2]));
	});

	test('two frames in one chunk are both decoded', function() {
		const received = [];
		const decoder = new Decoder(message => received.push(message));
		decoder.push(Buffer.concat([...encode({ id: 1 }), ...encode({ id: 2, blob: Buffer.from('x') })]));
		assert.deepEqual(received.map(message => message.id), [1, 2]);
	});

	test('encoding a big Buffer does not build one JSON array element per byte', function() {
		// JSON.stringify calls Buffer.toJSON first: past 32M elements that took seconds
		const blob = Buffer.alloc(40 * 1024 * 1024, 7);
		const started = Date.now();
		const chunks = encode({ t: 'call', id: 1, fn: 'a.b', args: { blob } });
		assert.ok(Date.now() - started < 500);
		assert.equal(chunks[chunks.length - 1].byteLength, blob.length);
	});

	test('a corrupt frame is rejected', function() {
		const decoder = new Decoder(() => {});
		assert.throws(() => decoder.push(Buffer.from([0xff, 0xff, 0xff, 0xff])), { code: 'PROTOCOL_MISMATCH' });
	});

});
