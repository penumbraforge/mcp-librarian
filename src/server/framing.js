/**
 * Length-prefixed binary framing for Unix domain socket.
 * Format: [4 bytes uint32 BE length][JSON payload]
 * Max message: 2 MB
 */

const MAX_MESSAGE_SIZE = 2 * 1024 * 1024; // 2 MB
const HEADER_SIZE = 4;

export class FrameDecoder {
  constructor() {
    this.buffer = Buffer.alloc(0);
  }

  push(chunk) {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    const frames = [];

    while (this.buffer.length >= HEADER_SIZE) {
      const length = this.buffer.readUInt32BE(0);

      if (length > MAX_MESSAGE_SIZE) {
        throw new Error(`Frame too large: ${length} bytes (max ${MAX_MESSAGE_SIZE})`);
      }

      if (this.buffer.length < HEADER_SIZE + length) {
        break; // Wait for more data
      }

      const payload = this.buffer.subarray(HEADER_SIZE, HEADER_SIZE + length);
      this.buffer = this.buffer.subarray(HEADER_SIZE + length);

      try {
        frames.push(JSON.parse(payload.toString('utf8')));
      } catch {
        throw new Error('Invalid JSON in frame');
      }
    }

    return frames;
  }

  reset() {
    this.buffer = Buffer.alloc(0);
  }
}

export function encodeFrame(obj) {
  const payload = Buffer.from(JSON.stringify(obj), 'utf8');
  if (payload.length > MAX_MESSAGE_SIZE) {
    throw new Error(`Payload too large: ${payload.length} bytes`);
  }
  const header = Buffer.alloc(HEADER_SIZE);
  header.writeUInt32BE(payload.length, 0);
  return Buffer.concat([header, payload]);
}
