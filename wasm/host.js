'use strict';

// The process that runs a WebAssembly module for the pool. It speaks the protocol of lib/protocol.js with Node.js like any worker,
// and calls the module through its exports (the ABI is described in docs/webassembly.md).
//
//   node host.js module.wasm             a worker: waits for calls on the standard input
//   node host.js module.wasm --describe  prints the contracts of the module as JSON and exits
//
// The module is a sandbox: it can import nothing but WASI, and WASI gets no directories, no environment and no arguments.

const Fs = require('fs');
const Os = require('os');
const { Decoder, encode, encodeBody, decodeBody, write, VERSION } = require('../lib/protocol');

const ABI = 1;
const FILE = process.argv[2];
const DESCRIBE = process.argv.includes('--describe');

function fail(message) {
	console.error('totalfusion wasm: ' + message);
	process.exit(1);
}

// What the module has to export, and what it may import
const REQUIRED = ['memory', 'tf_abi', 'tf_alloc', 'tf_free', 'tf_call'];

function load(file) {

	let bytes;

	try {
		bytes = Fs.readFileSync(file);
	} catch (err) {
		fail('cannot read the module "' + file + '": ' + err.message);
	}

	let module;

	try {
		module = new WebAssembly.Module(bytes);
	} catch (err) {
		fail('"' + file + '" is not a valid WebAssembly module: ' + err.message);
	}

	const imports = WebAssembly.Module.imports(module);
	const exported = new Set(WebAssembly.Module.exports(module).map(item => item.name));

	for (const item of imports) {
		if (item.module !== 'wasi_snapshot_preview1')
			fail('the module imports ' + item.module + '.' + item.name + ': a sandboxed module can only import WASI (wasi_snapshot_preview1), and WASI here has no files, no network and no environment');
	}

	for (const name of REQUIRED) {
		if (!exported.has(name))
			fail('the module does not export "' + name + '", which the ABI of TotalFusion needs (see docs/webassembly.md)');
	}

	if (exported.has('_start'))
		fail('the module is a command (it exports _start): build it as a reactor, a library that exports its functions (Go: -buildmode=c-shared, Rust: crate-type cdylib)');

	return { module, wasi: imports.length > 0, initialize: exported.has('_initialize'), describes: exported.has('tf_describe') };
}

const loaded = load(FILE);

// WASI for the module: nothing to see. The standard output of this process carries the protocol, so what the module prints goes
// to the error output, and it reads from /dev/null.
let devnull = null;

function instantiate() {

	const imports = {};

	let wasi = null;

	if (loaded.wasi) {

		const { WASI } = require('node:wasi');

		if (devnull === null)
			devnull = Fs.openSync(Os.devNull, 'r');

		wasi = new WASI({ version: 'preview1', args: [], env: {}, preopens: {}, stdin: devnull, stdout: 2, stderr: 2, returnOnExit: true });
		imports.wasi_snapshot_preview1 = wasi.wasiImport;
	}

	const instance = new WebAssembly.Instance(loaded.module, imports);

	if (wasi)
		wasi.initialize(instance);

	const abi = instance.exports.tf_abi();

	if (abi !== ABI)
		fail('the module speaks version ' + abi + ' of the ABI and this version of TotalFusion speaks ' + ABI);

	return instance;
}

let instance = instantiate();

// A buffer that the module returns: a pointer to its length (uint32 little endian) and then the bytes. It is copied and freed.
function take(pointer) {

	pointer = pointer >>> 0;

	const memory = instance.exports.memory.buffer;
	const length = new DataView(memory).getUint32(pointer, true);
	const bytes = Buffer.from(new Uint8Array(memory, pointer + 4, length));

	instance.exports.tf_free(pointer, length + 4);
	return bytes;
}

// A buffer for the module: it is allocated by the module, filled here and freed after the call
function give(bytes) {

	const pointer = instance.exports.tf_alloc(bytes.length) >>> 0;

	// the memory of the module may have grown, which replaces its buffer
	new Uint8Array(instance.exports.memory.buffer, pointer, bytes.length).set(bytes);
	return pointer;
}

function describe() {

	if (!loaded.describes)
		return { actions: [], functions: 0, startups: [], errors: [], runtime: 'wasm', protocol: VERSION };

	return Object.assign(JSON.parse(take(instance.exports.tf_describe()).toString('utf8')), { runtime: 'wasm', protocol: VERSION });
}

if (DESCRIBE) {
	console.log(JSON.stringify(describe()));
	process.exit(0);
}

// A call: the name and the arguments (in the format of a frame) go in, a frame with { ok, data | error } comes out
function call(name, args) {

	const nameBytes = Buffer.from(name, 'utf8');
	const body = encodeBody(args === undefined ? null : args);
	const namePointer = give(nameBytes);
	const bodyPointer = give(body);

	let pointer;

	try {
		pointer = instance.exports.tf_call(namePointer, nameBytes.length, bodyPointer, body.length);
	} finally {
		// the module may have trapped halfway: whatever it holds is lost with the instance
		try {
			instance.exports.tf_free(namePointer, nameBytes.length);
			instance.exports.tf_free(bodyPointer, body.length);
		} catch {}
	}

	return decodeBody(take(pointer));
}

function memory() {
	return process.memoryUsage().rss;
}

// The state of an instance after a trap cannot be trusted: the next call gets a new one
function fresh() {
	try {
		instance = instantiate();
	} catch (err) {
		console.error('totalfusion wasm: cannot start the module again: ' + err.message);
		process.exit(1);
	}
}

function send(message) {
	write(process.stdout, encode(message));
}

function answer(message) {

	let result;

	try {
		result = call(message.fn, message.args);
	} catch (err) {

		// The WASI of Node.js ends a call to exit() by throwing a symbol
		const exit = typeof err === 'symbol';
		const trap = err instanceof WebAssembly.RuntimeError || err instanceof RangeError;
		const name = exit ? 'Exit' : trap ? 'Trap' : 'Error';
		const text = exit ? 'The module ended while it ran the function (it called exit)' : err && err.message ? err.message : String(err);

		send({ t: 'res', id: message.id, ok: false, error: { name, message: text, code: exit ? 'WASM_EXIT' : trap ? 'WASM_TRAP' : null }, mem: memory() });
		fresh();
		return;
	}

	if (result && result.ok) {

		// A function called as a stream is a stream of one chunk
		if (message.stream)
			send({ t: 'chunk', id: message.id, data: result.data });

		send({ t: 'res', id: message.id, ok: true, data: message.stream ? null : result.data, mem: memory() });

	} else
		send({ t: 'res', id: message.id, ok: false, error: result && result.error ? result.error : { name: 'Error', message: 'The module answered with something that is not a result' }, mem: memory() });
}

const decoder = new Decoder(function(message) {
	switch (message.t) {
		case 'call':
			answer(message);
			break;
		case 'ping':
			send({ t: 'pong', id: message.id, mem: memory() });
			break;
		case 'bye':
			process.exit(0);
	}
});

process.stdin.on('data', chunk => decoder.push(chunk));
process.stdin.on('end', () => process.exit(0));

send({ t: 'ready', v: VERSION, pid: process.pid, runtime: 'wasm', sdk: ABI });
