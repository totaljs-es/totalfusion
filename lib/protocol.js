'use strict';

const { FusionError } = require('./errors');

// Frame: 4 bytes (uint32 big endian) with the length + the JSON body.
//
// Node -> worker: { t: 'call', id, fn, args } | { t: 'cancel', id } | { t: 'ping', id } | { t: 'bye' }
// Worker -> Node: { t: 'ready', v } | { t: 'res', id, ok, data | error } | { t: 'pong', id }

const VERSION = 1;
const MAX_FRAME = 64 * 1024 * 1024;

exports.VERSION = VERSION;
exports.MAX_FRAME = MAX_FRAME;

exports.encode = function(message) {

	const body = Buffer.from(JSON.stringify(message), 'utf8');

	if (body.length > MAX_FRAME)
		throw new FusionError('ENCODE_ERROR', 'The message is larger than ' + (MAX_FRAME / 1024 / 1024) + ' MB');

	const head = Buffer.allocUnsafe(4);
	head.writeUInt32BE(body.length, 0);
	return Buffer.concat([head, body]);
};

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

				if (!this.need || this.need > MAX_FRAME)
					throw new FusionError('PROTOCOL_MISMATCH', 'Invalid frame length: ' + this.need);
			}

			if (this.size < this.need)
				return;

			const body = this.take(this.need);
			this.need = 0;
			this.onframe(JSON.parse(body.toString('utf8')));
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
