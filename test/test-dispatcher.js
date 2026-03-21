import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Dispatcher } from '../src/protocol/dispatcher.js';

// Mock transport that collects all send() calls.
class MockTransport {
  constructor() { this.sent = []; }
  send(msg) { this.sent.push(msg); }
}

// Minimal mock store and config for Dispatcher construction.
function makeConfig(overrides = {}) {
  return { rateLimit: 200, logLevel: 'info', ...overrides };
}

function makeDispatcher(configOverrides = {}) {
  const transport = new MockTransport();
  const store = {};
  const config = makeConfig(configOverrides);
  const dispatcher = new Dispatcher(store, config, transport);
  return { dispatcher, transport, store, config };
}

describe('Dispatcher', () => {

  // -------------------------------------------------------------------------
  // 1. initialize
  // -------------------------------------------------------------------------
  it('initialize request → returns server info with correct protocolVersion and capabilities', async () => {
    const { dispatcher, transport } = makeDispatcher();

    await dispatcher.handleMessage({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: { protocolVersion: '2025-03-26', clientInfo: { name: 'test' } },
    });

    assert.equal(transport.sent.length, 1);
    const resp = transport.sent[0];
    assert.equal(resp.jsonrpc, '2.0');
    assert.equal(resp.id, 1);
    assert.equal(resp.result.protocolVersion, '2025-03-26');
    assert.deepEqual(resp.result.serverInfo, { name: 'mcp-librarian', version: '3.0.0' });
    assert.ok(resp.result.capabilities, 'must include capabilities');
    assert.ok('tools' in resp.result.capabilities);
    assert.ok('resources' in resp.result.capabilities);
    assert.ok('prompts' in resp.result.capabilities);
    assert.ok('logging' in resp.result.capabilities);
  });

  // -------------------------------------------------------------------------
  // 2. initialized notification (no id) → no response
  // -------------------------------------------------------------------------
  it('initialized notification (no id) → no response sent', async () => {
    const { dispatcher, transport } = makeDispatcher();

    await dispatcher.handleMessage({
      jsonrpc: '2.0',
      method: 'initialized',
    });

    assert.equal(transport.sent.length, 0, 'notification must never produce a response');
  });

  // -------------------------------------------------------------------------
  // 3. ping → returns empty result
  // -------------------------------------------------------------------------
  it('ping → returns empty result', async () => {
    const { dispatcher, transport } = makeDispatcher();

    await dispatcher.handleMessage({
      jsonrpc: '2.0',
      id: 42,
      method: 'ping',
    });

    assert.equal(transport.sent.length, 1);
    const resp = transport.sent[0];
    assert.equal(resp.jsonrpc, '2.0');
    assert.equal(resp.id, 42);
    assert.deepEqual(resp.result, {});
  });

  // -------------------------------------------------------------------------
  // 4. Unknown method → -32601 error
  // -------------------------------------------------------------------------
  it('unknown method → returns -32601 Method not found error', async () => {
    const { dispatcher, transport } = makeDispatcher();

    await dispatcher.handleMessage({
      jsonrpc: '2.0',
      id: 99,
      method: 'nonexistent/method',
    });

    assert.equal(transport.sent.length, 1);
    const resp = transport.sent[0];
    assert.equal(resp.jsonrpc, '2.0');
    assert.equal(resp.id, 99);
    assert.equal(resp.error.code, -32601);
  });

  // -------------------------------------------------------------------------
  // 5. logging/setLevel → changes level, returns success
  // -------------------------------------------------------------------------
  it('logging/setLevel with debug → changes level and returns empty result', async () => {
    const { dispatcher, transport } = makeDispatcher();

    await dispatcher.handleMessage({
      jsonrpc: '2.0',
      id: 5,
      method: 'logging/setLevel',
      params: { level: 'debug' },
    });

    assert.equal(transport.sent.length, 1);
    const resp = transport.sent[0];
    assert.equal(resp.jsonrpc, '2.0');
    assert.equal(resp.id, 5);
    assert.deepEqual(resp.result, {});
  });

  // -------------------------------------------------------------------------
  // 6. Rate limiting: 201st request gets -32003
  // -------------------------------------------------------------------------
  it('rate limiting: 201st request gets -32003 error', async () => {
    // Use a tiny window so timestamps won't expire during the test.
    const { dispatcher, transport } = makeDispatcher({ rateLimit: 200 });

    // Send 200 tools/list requests (below the limit).
    for (let i = 1; i <= 200; i++) {
      await dispatcher.handleMessage({
        jsonrpc: '2.0',
        id: i,
        method: 'tools/list',
      });
    }

    // The 201st should be rate-limited.
    await dispatcher.handleMessage({
      jsonrpc: '2.0',
      id: 201,
      method: 'tools/list',
    });

    // Last response should be a -32003 error.
    const last = transport.sent[transport.sent.length - 1];
    assert.equal(last.id, 201);
    assert.equal(last.error.code, -32003);
  });

  // -------------------------------------------------------------------------
  // 7. initialize and ping are NOT rate limited
  // -------------------------------------------------------------------------
  it('initialize and ping are exempt from rate limiting', async () => {
    // Set the window very high so normal requests accumulate.
    const { dispatcher, transport } = makeDispatcher({ rateLimit: 1 });

    // This first non-exempt request consumes the 1-request budget.
    await dispatcher.handleMessage({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/list',
    });

    // Reset sent so we only check the next calls.
    transport.sent.length = 0;

    // initialize should NOT be blocked.
    await dispatcher.handleMessage({
      jsonrpc: '2.0',
      id: 2,
      method: 'initialize',
      params: { protocolVersion: '2025-03-26' },
    });

    assert.equal(transport.sent.length, 1);
    assert.ok(transport.sent[0].result, 'initialize should succeed, not error');
    assert.ok(!transport.sent[0].error, 'initialize should not return error');

    transport.sent.length = 0;

    // ping should NOT be blocked.
    await dispatcher.handleMessage({
      jsonrpc: '2.0',
      id: 3,
      method: 'ping',
    });

    assert.equal(transport.sent.length, 1);
    assert.deepEqual(transport.sent[0].result, {});
    assert.ok(!transport.sent[0].error, 'ping should not return error');
  });

  // -------------------------------------------------------------------------
  // 8. Malformed request (no method field) → -32600 Invalid Request
  // -------------------------------------------------------------------------
  it('malformed request (no method field) → returns -32600 Invalid Request', async () => {
    const { dispatcher, transport } = makeDispatcher();

    await dispatcher.handleMessage({
      jsonrpc: '2.0',
      id: 77,
      // no 'method' field
      params: {},
    });

    assert.equal(transport.sent.length, 1);
    const resp = transport.sent[0];
    assert.equal(resp.jsonrpc, '2.0');
    assert.equal(resp.id, 77);
    assert.equal(resp.error.code, -32600);
  });

  // -------------------------------------------------------------------------
  // Bonus: tools/list stub returns an array
  // -------------------------------------------------------------------------
  it('tools/list → returns result with tools array', async () => {
    const { dispatcher, transport } = makeDispatcher();

    await dispatcher.handleMessage({
      jsonrpc: '2.0',
      id: 10,
      method: 'tools/list',
    });

    assert.equal(transport.sent.length, 1);
    const resp = transport.sent[0];
    assert.equal(resp.jsonrpc, '2.0');
    assert.equal(resp.id, 10);
    assert.ok(Array.isArray(resp.result.tools), 'result.tools must be an array');
  });

  // -------------------------------------------------------------------------
  // Bonus: initialized (notification) is NOT rate limited
  // -------------------------------------------------------------------------
  it('initialized notification is exempt from rate limiting and produces no response', async () => {
    const { dispatcher, transport } = makeDispatcher({ rateLimit: 1 });

    // Exhaust budget.
    await dispatcher.handleMessage({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/list',
    });

    transport.sent.length = 0;

    // initialized is a notification — should never produce a response regardless of rate limit.
    await dispatcher.handleMessage({
      jsonrpc: '2.0',
      method: 'initialized',
    });

    assert.equal(transport.sent.length, 0, 'notifications never produce a response');
  });

});
