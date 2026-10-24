'use strict';

// The result of fusion.doctor(): a list of checks, each one with a status ('ok', 'warn' or 'error'),
// a message and, when there is something to do, the exact thing to do about it.
class Report {

	constructor(runtime) {
		this.runtime = runtime;
		this.checks = [];
		this.python = null;
	}

	add(status, name, message, fix) {
		this.checks.push(fix ? { status, name, message, fix } : { status, name, message });
		return this;
	}

	// false when something has to be fixed. Warnings are advice.
	get ok() {
		return !this.checks.some(check => check.status === 'error');
	}

	get text() {

		const marks = { ok: '[ok]   ', warn: '[warn] ', error: '[error]' };
		const width = Math.max(...this.checks.map(check => check.name.length));
		const lines = ['TotalFusion doctor: ' + this.runtime, ''];

		for (const check of this.checks) {
			lines.push(marks[check.status] + ' ' + check.name.padEnd(width) + '  ' + check.message);
			if (check.fix)
				lines.push(' '.repeat(8 + width + 2) + 'Fix: ' + check.fix);
		}

		const errors = this.checks.filter(check => check.status === 'error').length;
		const warnings = this.checks.filter(check => check.status === 'warn').length;

		lines.push('');
		lines.push(errors ? errors + (errors === 1 ? ' problem' : ' problems') + ' to fix' + (warnings ? ', ' + warnings + (warnings === 1 ? ' warning' : ' warnings') : '') : 'Everything is in order' + (warnings ? ' (' + warnings + (warnings === 1 ? ' warning' : ' warnings') + ')' : ''));

		return lines.join('\n');
	}

	toJSON() {
		return { runtime: this.runtime, ok: this.ok, python: this.python, checks: this.checks, text: this.text };
	}

}

// A path or a command as it should be typed in a terminal
exports.shell = function(value) {
	return /[\s"'$&;|<>()]/.test(value) ? '"' + value.replace(/(["\\$`])/g, '\\$1') + '"' : value;
};

// For which system a native executable was built, read from its header: { os, arch } with the names of Node.js
// (process.platform and process.arch), or null when the file is not one that is known (a script, for example).
// A universal binary of macOS lists every architecture it holds.
exports.target = function(file) {

	const Fs = require('fs');
	let head;

	try {
		const descriptor = Fs.openSync(file, 'r');
		head = Buffer.alloc(512);
		head = head.subarray(0, Fs.readSync(descriptor, head, 0, 512, 0));
		Fs.closeSync(descriptor);
	} catch {
		return null;
	}

	if (head.length < 64)
		return null;

	// ELF: the machine is at 18, in the endianness of the file
	if (head.readUInt32BE(0) === 0x7f454c46) {

		const little = head[5] === 1;
		const machine = little ? head.readUInt16LE(18) : head.readUInt16BE(18);
		const arch = { 0x3e: 'x64', 0xb7: 'arm64', 0x03: 'ia32', 0x28: 'arm', 0xf3: 'riscv64', 0x15: 'ppc64', 0x16: 's390x' }[machine];

		return { os: head[7] === 9 ? 'freebsd' : 'linux', arch: [arch || 'machine ' + machine] };
	}

	// Mach-O of 32 or 64 bits, in either order of bytes
	const magic = head.readUInt32LE(0);
	const MACHO = { 0xfeedface: false, 0xfeedfacf: false, 0xcefaedfe: true, 0xcffaedfe: true };

	if (magic in MACHO) {
		const cpu = head.readUInt32LE(4);
		return { os: 'darwin', arch: [{ 0x01000007: 'x64', 0x0100000c: 'arm64', 0x07: 'ia32', 0x0c: 'arm' }[cpu] || 'cpu ' + cpu] };
	}

	// Universal binary: cputype of each of the architectures, big endian
	if (head.readUInt32BE(0) === 0xcafebabe && head.readUInt32BE(4) > 0 && head.readUInt32BE(4) < 8) {

		const arch = [];

		for (let i = 0; i < head.readUInt32BE(4); i++)
			arch.push({ 0x01000007: 'x64', 0x0100000c: 'arm64', 0x07: 'ia32', 0x0c: 'arm' }[head.readUInt32BE(8 + i * 20)] || 'cpu');

		return { os: 'darwin', arch };
	}

	// PE (Windows): the header is where e_lfanew says
	if (head[0] === 0x4d && head[1] === 0x5a) {

		const offset = head.readUInt32LE(0x3c);

		if (offset + 6 > head.length || head.readUInt32LE(offset) !== 0x4550)
			return null;

		return { os: 'win32', arch: [{ 0x8664: 'x64', 0xaa64: 'arm64', 0x14c: 'ia32', 0x1c4: 'arm' }[head.readUInt16LE(offset + 4)] || 'machine'] };
	}

	return null;
};

// What to tell about an executable that was built for another system: null when it can run here, { status, message } when not.
// A Mac with Apple silicon runs x64 programs (Rosetta), and Windows on ARM too: that is a warning, not an error.
exports.compatibility = function(target, platform, arch) {

	if (!target)
		return null;

	const built = target.os + '/' + target.arch.join('+');
	const here = platform + '/' + arch;

	if (target.os !== platform)
		return { status: 'error', message: 'It was built for ' + built + ' and this system is ' + here };

	if (target.arch.includes(arch))
		return null;

	if (arch === 'arm64' && target.arch.includes('x64') && (platform === 'darwin' || platform === 'win32'))
		return { status: 'warn', message: 'It was built for ' + built + ' and this system is ' + here + ': it runs emulated, much slower' };

	return { status: 'error', message: 'It was built for ' + built + ' and this system is ' + here };
};

exports.Report = Report;
