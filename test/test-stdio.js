import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Readable, Writable } from 'node:stream';
import { StdioTransport } from '../src/transport/stdio.js';

// Helper: create a Readable that you can push data into manually.
function makeReadable() {
  return new Readable({ read() {} });
}

// Helper: create a Writable that collects all written chunks into .chunks[].
function makeWritable() {
  const chunks = [];
  const stream = new Writable({
    write(chunk, _encoding, cb) {
      chunks.push(chunk.toString());
      cb();
    },
  });
  stream.chunks = chunks;
  return stream;
}

describe('StdioTransport', () => {
  it('single NDJSON message — callback receives parsed object', (t, done) => {
    const input = makeReadable();
    const output = makeWritable();
    const transport = new StdioTransport(input, output);

    transport.onMessage((msg) => {
      assert.deepEqual(msg, { id: 1, method: 'ping' });
      done();
    });

    input.push('{"id":1,"method":"ping"}\n');
  });

  it('multiple messages in one chunk — callback called for each', (t, done) => {
    const input = makeReadable();
    const output = makeWritable();
    const transport = new StdioTransport(input, output);

    const received = [];
    transport.onMessage((msg) => {
      received.push(msg);
      if (received.length === 3) {
        assert.deepEqual(received[0], { id: 1 });
        assert.deepEqual(received[1], { id: 2 });
        assert.deepEqual(received[2], { id: 3 });
        done();
      }
    });

    input.push('{"id":1}\n{"id":2}\n{"id":3}\n');
  });

  it('partial line across two chunks — buffered and parsed when complete', (t, done) => {
    const input = makeReadable();
    const output = makeWritable();
    const transport = new StdioTransport(input, output);

    transport.onMessage((msg) => {
      assert.deepEqual(msg, { complete: true });
      done();
    });

    // Push the message in two halves (no newline in first chunk)
    input.push('{"comple');
    input.push('te":true}\n');
  });

  it('malformed JSON line — error emitted, does not crash, other messages still work', (t, done) => {
    const input = makeReadable();
    const output = makeWritable();
    const transport = new StdioTransport(input, output);

    const received = [];
    const errors = [];

    transport.onMessage((msg) => {
      received.push(msg);
    });

    transport.on('error', (err) => {
      errors.push(err);
      // After error, push a valid message and verify it still works
      if (errors.length === 1) {
        input.push('{"ok":true}\n');
      }
    });

    // Use setImmediate to check state after stream events settle
    input.push('not valid json\n');

    // Give enough time for the valid message pushed in the error handler
    setImmediate(() => {
      setImmediate(() => {
        assert.equal(errors.length, 1);
        assert.ok(errors[0] instanceof SyntaxError || errors[0] instanceof Error);
        assert.equal(received.length, 1);
        assert.deepEqual(received[0], { ok: true });
        done();
      });
    });
  });

  it('send(object) writes JSON + newline to output stream', () => {
    const input = makeReadable();
    const output = makeWritable();
    const transport = new StdioTransport(input, output);

    transport.send({ result: 'hello', id: 42 });

    assert.equal(output.chunks.length, 1);
    const written = output.chunks[0];
    assert.ok(written.endsWith('\n'), 'should end with newline');
    assert.deepEqual(JSON.parse(written), { result: 'hello', id: 42 });
  });

  it('close() ends the output stream', (t, done) => {
    const input = makeReadable();
    const output = makeWritable();
    const transport = new StdioTransport(input, output);

    output.on('finish', () => {
      done();
    });

    transport.close();
  });
});
