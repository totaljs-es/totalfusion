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

exports.Report = Report;
