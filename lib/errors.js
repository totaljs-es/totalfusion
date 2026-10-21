'use strict';

// Every error produced by TotalFusion has a stable `code`:
// TIMEOUT, ABORTED, CANCELLED, QUEUE_FULL, CLOSED, WORKER_CRASHED, SPAWN_FAILED, START_FAILED, START_TIMEOUT,
// PROTOCOL_MISMATCH, ENCODE_ERROR, NOT_FOUND, NOT_SERIALIZABLE, STREAMING_FUNCTION, INVALID_CONFIG, ALREADY_STARTED
// and REMOTE_ERROR (the function failed: the `code` of the error it raised is used instead when it has one)
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
