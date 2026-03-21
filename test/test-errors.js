import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ERROR_CODES, McpError } from '../src/errors.js';

describe('errors', () => {
  it('defines all error codes as negative integers', () => {
    for (const [name, code] of Object.entries(ERROR_CODES)) {
      assert.equal(typeof code, 'number');
      assert.ok(code < 0, `${name} should be negative`);
    }
  });

  it('includes all required error codes', () => {
    const required = [
      'SKILL_NOT_FOUND', 'INVALID_INPUT', 'RATE_LIMITED',
      'CONTENT_GUARD', 'INTEGRITY_FAILED', 'PACK_NOT_FOUND',
      'PACK_FETCH_FAILED', 'VALIDATION_FAILED', 'CONFIG_ERROR',
      'PATH_VIOLATION', 'SERVER_ERROR'
    ];
    for (const name of required) {
      assert.ok(name in ERROR_CODES, `Missing error code: ${name}`);
    }
  });

  it('creates McpError with code, message, and context', () => {
    const err = new McpError(ERROR_CODES.SKILL_NOT_FOUND, 'not found', { skill: 'test' });
    assert.equal(err.code, -32001);
    assert.equal(err.message, 'not found');
    assert.deepEqual(err.context, { skill: 'test' });
    assert.ok(err instanceof Error);
  });

  it('generates JSON-RPC error response', () => {
    const err = new McpError(ERROR_CODES.INVALID_INPUT, 'bad input', { field: 'query' });
    const rpc = err.toJsonRpc(42);
    assert.equal(rpc.jsonrpc, '2.0');
    assert.equal(rpc.id, 42);
    assert.equal(rpc.error.code, -32002);
    assert.equal(rpc.error.message, 'bad input');
    assert.deepEqual(rpc.error.data, { field: 'query' });
  });
});
