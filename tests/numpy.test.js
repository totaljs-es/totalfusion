'use strict';

// Optional: needs a Python with NumPy. Run with TOTALFUSION_TEST_NUMPY=/path/to/python npm test
const { test, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const Path = require('path');
const { Fusion } = require('..');

const python = process.env.TOTALFUSION_TEST_NUMPY;
const skip = python ? false : 'set TOTALFUSION_TEST_NUMPY to a Python that has NumPy';
const instances = [];

function create() {
	const fusion = new Fusion({ python: { path: Path.join(__dirname, 'components_numpy'), python, forwardStderr: false } });
	instances.push(fusion);
	return fusion;
}

afterEach(async function() {
	await Promise.all(instances.splice(0).map(fusion => fusion.shutdown()));
});

test('numpy arrays arrive as the matching typed array', { skip }, async function() {
	const fusion = create();
	assert.deepEqual(await fusion.python('nptest.f32'), new Float32Array([0, 1.5, 3, 4.5, 6]));
	assert.deepEqual(await fusion.python('nptest.f64_2d'), new Float64Array([0, 1, 2, 3, 4, 5]));
	assert.ok(Buffer.isBuffer(await fusion.python('nptest.u8')));
	assert.deepEqual([...(await fusion.python('nptest.bools'))], [1, 0, 1]);
});

test('non contiguous arrays are sent in C order', { skip }, async function() {
	const fusion = create();
	assert.deepEqual(await fusion.python('nptest.strided'), new Int32Array([0, 2, 4, 6, 8]));
	assert.deepEqual(await fusion.python('nptest.transposed'), new Int16Array([0, 3, 1, 4, 2, 5]));
});

test('big-endian arrays are converted to little-endian', { skip }, async function() {
	const fusion = create();
	assert.deepEqual(await fusion.python('nptest.big_endian'), new Float32Array([1, 2, 3]));
});

test('numpy scalars and 0-d arrays are numbers', { skip }, async function() {
	const fusion = create();
	assert.deepEqual(await fusion.python('nptest.scalar'), { i: 7, f: 2.5, zero_d: 3, b: true });
});

test('a Float32Array is read in Python without copying and the result comes back typed', { skip }, async function() {
	const fusion = create();
	const result = await fusion.python('nptest.normalize', { values: new Float32Array([1, 2, 3, 4]) });
	assert.ok(result instanceof Float32Array);
	assert.deepEqual([...result].map(v => +v.toFixed(3)), [-1.342, -0.447, 0.447, 1.342]);
	assert.deepEqual(await fusion.python('nptest.inspect', { values: new Float32Array([1, 2, 3]) }), { len: 3, format: 'f', sum: 6, readonly: true });
});
