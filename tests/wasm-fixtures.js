'use strict';

// Small WebAssembly modules written by hand, to test what a module can do wrong: they are assembled here, byte by byte,
// so the tests do not need a compiler for the cases that no compiler would produce.

function uleb(value) {
	const bytes = [];
	do {
		let byte = value & 0x7f;
		value >>>= 7;
		if (value)
			byte |= 0x80;
		bytes.push(byte);
	} while (value);
	return bytes;
}

function text(value) {
	return [...uleb(value.length), ...Buffer.from(value)];
}

function section(id, content) {
	return [id, ...uleb(content.length), ...content];
}

function vector(items) {
	return [...uleb(items.length), ...items.flat()];
}

const I32 = 0x7f;

const TYPES = {
	abi: [0x60, 0, 1, I32],
	alloc: [0x60, 1, I32, 1, I32],
	free: [0x60, 2, I32, I32, 0],
	call: [0x60, 4, I32, I32, I32, I32, 1, I32],
	start: [0x60, 0, 0]
};

// A module that follows the ABI and whose tf_call traps (unreachable). Options:
//   abi        the version that tf_abi returns (default 1)
//   imports    [{ module, name }]: functions it imports, with the signature of tf_abi
//   command    exports _start too
//   omit       the names of the exports to leave out
exports.module = function(options) {

	options = Object.assign({ abi: 1, imports: [], command: false, omit: [] }, options);

	const types = [TYPES.abi, TYPES.alloc, TYPES.free, TYPES.call, TYPES.start];
	const imported = options.imports.length;

	// the functions that the module defines, in order
	const defined = [
		{ name: 'tf_abi', type: 0, body: [0x41, ...sleb(options.abi)] },
		{ name: 'tf_alloc', type: 1, body: [0x41, ...sleb(1024)] },
		{ name: 'tf_free', type: 2, body: [] },
		{ name: 'tf_call', type: 3, body: [0x00] }
	];

	if (options.command)
		defined.push({ name: '_start', type: 4, body: [] });

	const exported = defined.filter(item => !options.omit.includes(item.name)).map(item => [...text(item.name), 0x00, ...uleb(imported + defined.indexOf(item))]);

	if (!options.omit.includes('memory'))
		exported.push([...text('memory'), 0x02, 0x00]);

	const bytes = [0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00];

	bytes.push(...section(1, vector(types)));

	if (imported)
		bytes.push(...section(2, vector(options.imports.map(item => [...text(item.module), ...text(item.name), 0x00, 0]))));

	bytes.push(...section(3, vector(defined.map(item => uleb(item.type)))));
	bytes.push(...section(5, vector([[0x00, 1]])));
	bytes.push(...section(7, vector(exported)));
	bytes.push(...section(10, vector(defined.map(function(item) {
		const body = [0x00, ...item.body, 0x0b];
		return [...uleb(body.length), ...body];
	}))));

	return Buffer.from(bytes);
};

function sleb(value) {
	const bytes = [];
	while (true) {
		const byte = value & 0x7f;
		value >>= 7;
		if ((value === 0 && !(byte & 0x40)) || (value === -1 && (byte & 0x40))) {
			bytes.push(byte);
			return bytes;
		}
		bytes.push(byte | 0x80);
	}
}
