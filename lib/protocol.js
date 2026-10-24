'use strict';

const { FusionError } = require('./errors');

// Frame (protocol 2), all integers are uint32 big endian:
//
//   total | jsonLength | json | count | length_1 ... length_count | part_1 ... part_count
//
// `total` is the size of everything after it. Binary data (Buffer, typed arrays) never goes through JSON:
// it is replaced by { "$bin": index, "type": "Float32Array" } and travels raw, after the JSON.
//
// Node -> worker: { t: 'call', id, fn, args } | { t: 'cancel', id } | { t: 'ping', id } | { t: 'bye' }
// Worker -> Node: { t: 'ready', v } | { t: 'res', id, ok, data | error } | { t: 'pong', id }

const VERSION = 2;
const MAX_FRAME = 512 * 1024 * 1024;
const MAX_JSON = 64 * 1024 * 1024;

// Typed arrays are little endian on every platform Node.js and CPython run on (x64 and ARM64)
const TYPES = {
	Uint8Array: Uint8Array,
	Int8Array: Int8Array,
	Uint16Array: Uint16Array,
	Int16Array: Int16Array,
	Uint32Array: Uint32Array,
	Int32Array: Int32Array,
	Float32Array: Float32Array,
	Float64Array: Float64Array,
	BigInt64Array: BigInt64Array,
	BigUint64Array: BigUint64Array
};

exports.VERSION = VERSION;
exports.MAX_FRAME = MAX_FRAME;

// JSON.stringify calls Buffer.toJSON before any replacer, which builds an array with one element per byte
// (it falls out of V8's fast arrays at 32M elements and a 100 MB buffer took seconds). So the data is walked here
// first: binary data is moved to `parts` and replaced by a reference, and nothing else is touched.
function extract(value, parts, stack) {

	if (value === null || typeof(value) !== 'object')
		return value;

	if (value instanceof ArrayBuffer)
		value = new Uint8Array(value);

	if (ArrayBuffer.isView(value)) {

		if (value instanceof DataView)
			throw new FusionError('ENCODE_ERROR', 'DataView is not supported, send its buffer or a typed array');

		parts.push(new Uint8Array(value.buffer, value.byteOffset, value.byteLength));

		// Buffer is a Uint8Array
		return { $bin: parts.length - 1, type: TYPES[value.constructor.name] ? value.constructor.name : 'Uint8Array' };
	}

	// Date and other objects that know how to serialize themselves
	if (typeof(value.toJSON) === 'function')
		return value;

	if (stack.has(value))
		throw new TypeError('Converting circular structure to JSON');

	stack.add(value);

	let output;

	if (Array.isArray(value)) {
		output = new Array(value.length);
		for (let i = 0; i < value.length; i++)
			output[i] = extract(value[i], parts, stack);
	} else {

		output = {};

		for (const key of Object.keys(value)) {

			if (key === '$bin')
				throw new FusionError('ENCODE_ERROR', '"$bin" is a reserved key and cannot be used in the data');

			output[key] = extract(value[key], parts, stack);
		}
	}

	stack.delete(value);
	return output;
}

// Cheap check (no allocations) so that data without binary parts goes straight to JSON.stringify
function binary(value, stack) {

	if (value === null || typeof(value) !== 'object')
		return false;

	if (value instanceof ArrayBuffer || ArrayBuffer.isView(value))
		return true;

	if (typeof(value.toJSON) === 'function')
		return false;

	if (stack.has(value))
		return false;

	stack.add(value);

	let found = false;

	if (Array.isArray(value)) {
		for (let i = 0; i < value.length && !found; i++)
			found = binary(value[i], stack);
	} else {
		for (const key in value) {
			// "$bin" takes the slow path, which rejects it
			if (Object.prototype.hasOwnProperty.call(value, key) && ((found = key === '$bin') || (found = binary(value[key], stack))))
				break;
		}
	}

	stack.delete(value);
	return found;
}

// Returns the list of buffers of the frame. Binary parts are not copied: they are written as they are.
exports.encode = function(message) {

	const parts = [];
	const json = Buffer.from(JSON.stringify(binary(message, new Set()) ? extract(message, parts, new Set()) : message), 'utf8');

	if (json.length > MAX_JSON)
		throw new FusionError('ENCODE_ERROR', 'The JSON part of the message is larger than ' + (MAX_JSON / 1024 / 1024) + ' MB');

	const head = Buffer.allocUnsafe(8);
	const table = Buffer.allocUnsafe(4 + parts.length * 4);

	table.writeUInt32BE(parts.length, 0);

	let total = 4 + json.length + table.length;

	for (let i = 0; i < parts.length; i++) {
		table.writeUInt32BE(parts[i].byteLength, 4 + i * 4);
		total += parts[i].byteLength;
	}

	if (total > MAX_FRAME)
		throw new FusionError('ENCODE_ERROR', 'The message is larger than ' + (MAX_FRAME / 1024 / 1024) + ' MB');

	head.writeUInt32BE(total, 0);
	head.writeUInt32BE(json.length, 4);

	return [head, json, table, ...parts];
};

// The frame without its `total`, in one buffer: what travels between the host and a WebAssembly module (see wasm/host.js)
exports.encodeBody = function(message) {
	const chunks = exports.encode(message);
	chunks[0] = chunks[0].subarray(4);
	return Buffer.concat(chunks);
};

// Writes all the buffers of a frame in one go
exports.write = function(stream, chunks) {
	stream.cork();
	for (const chunk of chunks)
		stream.write(chunk);
	stream.uncork();
};

function typed(type, part) {

	if (type === 'Uint8Array')
		return part;

	// A copy: the part can start at any offset of the frame and typed arrays need an aligned buffer
	const copy = new Uint8Array(part.length);
	copy.set(part);
	return new TYPES[type](copy.buffer);
}

function decode(body) {

	const jsonLength = body.readUInt32BE(0);
	const count = body.readUInt32BE(4 + jsonLength);
	const parts = [];

	let offset = 8 + jsonLength + count * 4;

	for (let i = 0; i < count; i++) {
		const length = body.readUInt32BE(8 + jsonLength + i * 4);
		parts.push(body.subarray(offset, offset + length));
		offset += length;
	}

	if (offset !== body.length)
		throw new FusionError('PROTOCOL_MISMATCH', 'Invalid frame: the binary parts do not match its size');

	return JSON.parse(body.toString('utf8', 4, 4 + jsonLength), function(key, value) {

		if (value === null || typeof(value) !== 'object' || !Number.isInteger(value.$bin) || !TYPES[value.type] || !parts[value.$bin] || Object.keys(value).length !== 2)
			return value;

		const part = parts[value.$bin];

		// A small part of a big frame is copied, so keeping it does not keep the whole frame in memory
		if (value.type === 'Uint8Array')
			return part.length * 2 < body.length ? Buffer.from(part) : part;

		return typed(value.type, part);
	});
}

// Incremental frame parser: chunks are kept in a list and joined only
// when a whole frame is available, so big payloads are not re-copied per chunk.
class Decoder {

	constructor(onframe) {
		this.onframe = onframe;
		this.chunks = [];
		this.size = 0;
		this.need = 0;
	}

	push(chunk) {

		this.chunks.push(chunk);
		this.size += chunk.length;

		while (true) {

			if (!this.need) {

				if (this.size < 4)
					return;

				this.need = this.take(4).readUInt32BE(0);

				if (this.need < 8 || this.need > MAX_FRAME)
					throw new FusionError('PROTOCOL_MISMATCH', 'Invalid frame length: ' + this.need);
			}

			if (this.size < this.need)
				return;

			const body = this.take(this.need);
			this.need = 0;
			this.onframe(decode(body));
		}
	}

	take(length) {

		const buffer = this.chunks.length === 1 ? this.chunks[0] : Buffer.concat(this.chunks, this.size);
		const rest = buffer.subarray(length);

		this.chunks = rest.length ? [rest] : [];
		this.size = rest.length;

		return buffer.subarray(0, length);
	}

}

exports.Decoder = Decoder;
exports.decodeBody = decode;
