import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { FrameDecoder, encodeFrame } from '../src/server/framing.js';

describe('Framing', () => {
  it('should encode and decode a frame', () => {
    const obj = { jsonrpc: '2.0', method: 'test', id: 1 };
    const encoded = encodeFrame(obj);
    const decoder = new FrameDecoder();
    const frames = decoder.push(encoded);
    assert.equal(frames.length, 1);
    assert.deepEqual(frames[0], obj);
  });

  it('should handle multiple frames in one chunk', () => {
    const msg1 = { id: 1, method: 'a' };
    const msg2 = { id: 2, method: 'b' };
    const combined = Buffer.concat([encodeFrame(msg1), encodeFrame(msg2)]);
    const decoder = new FrameDecoder();
    const frames = decoder.push(combined);
    assert.equal(frames.length, 2);
    assert.deepEqual(frames[0], msg1);
    assert.deepEqual(frames[1], msg2);
  });

  it('should handle partial frames across chunks', () => {
    const obj = { method: 'test', data: 'x'.repeat(100) };
    const encoded = encodeFrame(obj);
    const decoder = new FrameDecoder();

    // Split in the middle
    const half = Math.floor(encoded.length / 2);
    const chunk1 = encoded.subarray(0, half);
    const chunk2 = encoded.subarray(half);

    const frames1 = decoder.push(chunk1);
    assert.equal(frames1.length, 0);

    const frames2 = decoder.push(chunk2);
    assert.equal(frames2.length, 1);
    assert.deepEqual(frames2[0], obj);
  });

  it('should reject oversized frames', () => {
    const decoder = new FrameDecoder();
    // Craft a header claiming 3 MB
    const header = Buffer.alloc(4);
    header.writeUInt32BE(3 * 1024 * 1024, 0);
    assert.throws(() => decoder.push(header), /too large/);
  });

  it('should reject oversized encode', () => {
    const huge = { data: 'x'.repeat(3 * 1024 * 1024) };
    assert.throws(() => encodeFrame(huge), /too large/);
  });
});
