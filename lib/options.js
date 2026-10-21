'use strict';

// The options of a runtime that configure its pool of workers (the same for every language)
const KEYS = ['workers', 'concurrency', 'timeout', 'maxQueue', 'startTimeout', 'cancelGrace', 'maxCalls', 'maxMemory', 'healthInterval', 'healthTimeout', 'forwardStderr'];

exports.KEYS = KEYS;

exports.poolOptions = function(name, config) {

	const options = { name };

	for (const key of KEYS)
		options[key] = config[key];

	return options;
};
