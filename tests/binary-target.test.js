'use strict';

// For which system is an executable? The doctor says so when a worker was built for another one.

const { test, describe, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const Path = require('path');
const Fs = require('fs');
const Os = require('os');
const { target, compatibility } = require('../lib/doctor');
const build = require('./go-build');
const { Fusion } = require('..');

const skip = build.skip();
const directories = [];
const instances = [];

// An executable that is only a header: what is needed to tell for which system it is
function header(bytes) {
	const directory = Fs.mkdtempSync(Path.join(Os.tmpdir(), 'totalfusion-target-'));
	directories.push(directory);
	const file = Path.join(directory, 'worker');
	Fs.writeFileSync(file, Buffer.concat([Buffer.from(bytes), Buffer.alloc(512)]));
	return file;
}

function elf(machine, osabi) {
	const bytes = Buffer.alloc(64);
	bytes.set([0x7f, 0x45, 0x4c, 0x46, 2, 1, 1, osabi || 0], 0);
	bytes.writeUInt16LE(machine, 18);
	return bytes;
}

function macho(cpu) {
	const bytes = Buffer.alloc(64);
	bytes.writeUInt32LE(0xfeedfacf, 0);
	bytes.writeUInt32LE(cpu, 4);
	return bytes;
}

function universal(cpus) {
	const bytes = Buffer.alloc(64 + cpus.length * 20);
	bytes.writeUInt32BE(0xcafebabe, 0);
	bytes.writeUInt32BE(cpus.length, 4);
	cpus.forEach((cpu, i) => bytes.writeUInt32BE(cpu, 8 + i * 20));
	return bytes;
}

function pe(machine) {
	const bytes = Buffer.alloc(256);
	bytes.set([0x4d, 0x5a], 0);
	bytes.writeUInt32LE(0x80, 0x3c);
	bytes.writeUInt32LE(0x4550, 0x80);
	bytes.writeUInt16LE(machine, 0x84);
	return bytes;
}

afterEach(async function() {
	await Promise.all(instances.splice(0).map(fusion => fusion.shutdown()));
	for (const directory of directories.splice(0))
		Fs.rmSync(directory, { recursive: true, force: true });
});

describe('the system of an executable, from its header', function() {

	test('ELF (Linux, FreeBSD)', function() {
		assert.deepEqual(target(header(elf(0x3e))), { os: 'linux', arch: ['x64'] });
		assert.deepEqual(target(header(elf(0xb7))), { os: 'linux', arch: ['arm64'] });
		assert.deepEqual(target(header(elf(0x3e, 9))), { os: 'freebsd', arch: ['x64'] });
	});

	test('Mach-O (macOS), and universal binaries', function() {
		assert.deepEqual(target(header(macho(0x0100000c))), { os: 'darwin', arch: ['arm64'] });
		assert.deepEqual(target(header(macho(0x01000007))), { os: 'darwin', arch: ['x64'] });
		assert.deepEqual(target(header(universal([0x01000007, 0x0100000c]))), { os: 'darwin', arch: ['x64', 'arm64'] });
	});

	test('PE (Windows)', function() {
		assert.deepEqual(target(header(pe(0x8664))), { os: 'win32', arch: ['x64'] });
		assert.deepEqual(target(header(pe(0xaa64))), { os: 'win32', arch: ['arm64'] });
	});

	test('what is not a native executable is unknown, not an error', function() {
		assert.equal(target(header(Buffer.from('#!/bin/sh\necho hi\n'))), null);
		assert.equal(target(Path.join(Os.tmpdir(), 'no-such-file-' + process.pid)), null);
		assert.equal(target(header([0x4d, 0x5a])), null);
	});

});

describe('can it run here', function() {

	test('the same system is fine', function() {
		assert.equal(compatibility({ os: 'linux', arch: ['x64'] }, 'linux', 'x64'), null);
		assert.equal(compatibility({ os: 'darwin', arch: ['x64', 'arm64'] }, 'darwin', 'arm64'), null);
		assert.equal(compatibility(null, 'linux', 'x64'), null);
	});

	test('another operating system or another architecture is an error', function() {
		assert.equal(compatibility({ os: 'linux', arch: ['x64'] }, 'darwin', 'arm64').status, 'error');
		assert.equal(compatibility({ os: 'win32', arch: ['x64'] }, 'linux', 'x64').status, 'error');
		assert.equal(compatibility({ os: 'linux', arch: ['arm64'] }, 'linux', 'x64').status, 'error');
		assert.equal(compatibility({ os: 'linux', arch: ['x64'] }, 'linux', 'arm64').status, 'error');
		assert.match(compatibility({ os: 'linux', arch: ['arm64'] }, 'darwin', 'arm64').message, /built for linux\/arm64 and this system is darwin\/arm64/);
	});

	test('x64 on Apple silicon or Windows on ARM runs emulated: a warning', function() {
		assert.equal(compatibility({ os: 'darwin', arch: ['x64'] }, 'darwin', 'arm64').status, 'warn');
		assert.equal(compatibility({ os: 'win32', arch: ['x64'] }, 'win32', 'arm64').status, 'warn');
		assert.match(compatibility({ os: 'darwin', arch: ['x64'] }, 'darwin', 'arm64').message, /emulated/);
	});

});

describe('the doctor, without any compiler', function() {

	// A file with the header of a program for another system: enough for the doctor, which does not run it
	function foreign() {
		const file = header(process.platform === 'win32' || process.platform === 'darwin' ? elf(0x3e) : pe(0x8664));
		Fs.chmodSync(file, 0o755);
		return file;
	}

	for (const [runtime, build] of [['go', 'go build'], ['rust', 'cargo build']]) {

		test('the doctor of ' + runtime + ' refuses a worker for another system', async function() {

			const fusion = new Fusion({ [runtime]: { binary: foreign(), forwardStderr: false } });
			instances.push(fusion);

			const report = await fusion.doctor(runtime);
			const check = report.checks.find(item => item.name === 'Binary');

			assert.equal(report.ok, false, report.text);
			assert.match(check.message, /It was built for .* and this system is /);
			assert.match(check.fix, new RegExp(build));
			assert.equal(report.checks.find(item => item.name === 'Functions'), undefined, 'it must not run a program that cannot run here');
		});
	}

});

describe('the doctor of Go', { skip }, function() {

	function create(binary) {
		const fusion = new Fusion({ go: { binary, forwardStderr: false } });
		instances.push(fusion);
		return fusion;
	}

	const system = process.platform === 'win32' ? 'windows' : process.platform;

	test('a worker that Go built for this system is recognized', function() {
		const found = target(build());
		assert.equal(found.os, process.platform);
		assert.ok(found.arch.includes(process.arch), found.arch.join());
	});

	test('workers built for other systems are recognized, from any system', function() {
		assert.deepEqual(target(build.cross('linux', 'amd64')), { os: 'linux', arch: ['x64'] });
		assert.deepEqual(target(build.cross('linux', 'arm64')), { os: 'linux', arch: ['arm64'] });
		assert.deepEqual(target(build.cross('windows', 'amd64')), { os: 'win32', arch: ['x64'] });
		assert.deepEqual(target(build.cross('darwin', 'arm64')), { os: 'darwin', arch: ['arm64'] });
	});

	test('a worker built for another system says which system it is for and how to build it', async function() {

		// the system that is not this one, and one of the others
		const foreign = process.platform === 'linux' ? build.cross('windows', 'amd64') : build.cross('linux', 'amd64');
		const copy = header(Buffer.alloc(0));
		Fs.copyFileSync(foreign, copy);
		Fs.chmodSync(copy, 0o755);

		const report = await create(copy).doctor('go');
		const check = report.checks.find(item => item.name === 'Binary');

		assert.equal(report.ok, false, report.text);
		assert.equal(check.status, 'error');
		assert.match(check.message, new RegExp('It was built for ' + (process.platform === 'linux' ? 'win32' : 'linux') + '/x64 and this system is ' + process.platform + '/' + process.arch));
		assert.match(check.fix, new RegExp('GOOS=' + system + ' GOARCH=\\w+ go build'));
	});

	test('the worker of this system is fine', async function() {
		const report = await create(build()).doctor('go');
		assert.equal(report.ok, true, report.text);
	});

});
