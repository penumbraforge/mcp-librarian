import { EventEmitter } from 'node:events';

/**
 * StdioTransport — NDJSON framing over stdin/stdout (or any duplex pair).
 *
 * Each message is a single JSON value followed by a newline character (\n).
 * Handles partial chunks, multiple messages per chunk, and malformed JSON.
 * Emits an 'error' event for parse failures instead of crashing.
 */
export class StdioTransport extends EventEmitter {
  #input;
  #output;
  #buffer;
  #messageCallback;

  constructor(input = process.stdin, output = process.stdout) {
    super();
    this.#input = input;
    this.#output = output;
    this.#buffer = '';
    this.#messageCallback = null;

    this.#input.on('data', (chunk) => this.#onData(chunk));
  }

  /**
   * Register the single message handler.
   * Called with the parsed JSON object for each complete NDJSON line.
   */
  onMessage(callback) {
    this.#messageCallback = callback;
  }

  /**
   * Serialize object to JSON + newline and write to the output stream.
   * Respects backpressure: if write() returns false, the caller may need
   * to wait for 'drain', but we don't buffer here — callers are responsible
   * for flow control at the protocol layer.
   */
  send(object) {
    const line = JSON.stringify(object) + '\n';
    this.#output.write(line);
  }

  /**
   * End the output stream gracefully.
   */
  close() {
    this.#output.end();
  }

  // -------------------------------------------------------------------------
  // Internal

  #onData(chunk) {
    // Append incoming chunk to the incomplete-line buffer
    this.#buffer += chunk.toString();

    // Split on newlines — last element is the incomplete tail (may be '')
    const lines = this.#buffer.split('\n');

    // Everything except the last element is a complete line
    this.#buffer = lines.pop(); // keep the incomplete tail

    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed === '') continue; // skip blank separators

      try {
        const parsed = JSON.parse(trimmed);
        if (this.#messageCallback) {
          this.#messageCallback(parsed);
        }
      } catch (err) {
        // Emit parse error — don't crash, continue processing other lines
        this.emit('error', err);
      }
    }
  }
}
