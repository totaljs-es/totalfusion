'use strict';

// Every error produced by TotalFusion has a stable `code`:
// TIMEOUT, ABORTED, QUEUE_FULL, CLOSED, WORKER_CRASHED, SPAWN_FAILED, START_FAILED,
// START_TIMEOUT, PROTOCOL_MISMATCH, ENCODE_ERROR, NOT_FOUND, NOT_SERIALIZABLE, REMOTE_ERROR
class FusionError extends Error {

	constructor(code, message, extra) {
		super(message);
		this.name = 'FusionError';
		this.code = code;
		if (extra)
			Object.assign(this, extra);
	}

}

exports.FusionError = FusionError;
