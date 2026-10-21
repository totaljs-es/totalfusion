'use strict';

const Fs = require('fs');
const Path = require('path');
const Crypto = require('crypto');

// How a file looks right now. Small files (the code) are compared by content too, because some file systems only keep the
// time of a change to the second.
function signature(file, stat) {

	let hash = '';

	if (stat.size <= 256 * 1024) {
		try {
			hash = Crypto.createHash('md5').update(Fs.readFileSync(file)).digest('hex');
		} catch {}
	}

	return stat.mtimeMs + ':' + stat.size + ':' + hash;
}

// What the files of the target are like: name -> signature
function snapshot(target) {

	const files = new Map();

	(function walk(directory, prefix) {

		let entries;

		try {
			entries = Fs.readdirSync(directory, { withFileTypes: true });
		} catch {
			return;
		}

		for (const entry of entries) {

			const name = prefix ? prefix + '/' + entry.name : entry.name;
			const file = Path.join(directory, entry.name);

			if (entry.isDirectory()) {
				if (target.recursive && !(target.skip && target.skip(entry.name)))
					walk(file, name);
			} else if (target.accept(name)) {
				try {
					files.set(name, signature(file, Fs.statSync(file)));
				} catch {}
			}
		}

	})(target.path, '');

	return files;
}

// Calls `onchange(files)` when the files that `target.accept()` like have really changed. The events of the system are only a hint:
// some of them are repeated, or are about a file that was written just before the watching began, so what has changed is
// found by comparing the files with how they were. Many writes in a row (an editor, a compiler) are one change: it fires
// when the files have been quiet for `debounce` ms. The watcher does not keep the process alive.
exports.watch = function(target, onchange, options) {

	const delay = options && options.debounce != null ? options.debounce : 200;
	let known = snapshot(target);
	let timer = null;

	const watcher = Fs.watch(target.path, { recursive: !!target.recursive, persistent: false }, function(event, filename) {

		// Some systems do not say which file changed
		if (filename && !target.accept(String(filename)))
			return;

		clearTimeout(timer);

		timer = setTimeout(function() {

			const current = snapshot(target);
			const files = [];

			for (const [name, value] of current) {
				if (known.get(name) !== value)
					files.push(name);
			}

			for (const name of known.keys()) {
				if (!current.has(name))
					files.push(name);
			}

			known = current;

			if (files.length)
				onchange(files);

		}, delay);

		timer.unref();
	});

	watcher.on('error', () => {});

	return {
		close() {
			clearTimeout(timer);
			watcher.close();
		}
	};
};
