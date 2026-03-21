/**
 * Rate Limiter Extended Tests
 *
 * Tests the sliding-window rate limiter built into Dispatcher.
 * Uses a low rateLimit (3) so we can hit the ceiling quickly without
 * sending hundreds of messages.
 *
 * Timestamp manipulation: because the Dispatcher's #checkRateLimit uses
 * Date.now() internally (a private field), we cannot directly inject
 * synthetic timestamps. Instead we rely on:
 *   - A tiny rateLimit so the budget is exhausted in ≤ 4 messages.
 *   - The 60-second window: we verify that requests within the window
 *     are blocked, then (for the window-expiry test) we hook into
 *     globalThis.Date to override Date.now() while the Dispatcher
 *     makes its filtering decision.
 */

import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import { Dispatcher } from '../src/protocol/dispatcher.js';

// ---------------------------------------------------------------------------
// MockTransport — collects all send() calls for inspection.
// ---------------------------------------------------------------------------
class MockTransport {
  constructor() { this.sent = []; }
  send(msg) { this.sent.push(msg); }
  clear() { this.sent.length = 0; }
}

// ---------------------------------------------------------------------------
// Factory helpers
// ---------------------------------------------------------------------------
function makeDispatcher(rateLimitOverride = 3) {
  const transport = new MockTransport();
  const config = { rateLimit: rateLimitOverride, logLevel: 'error' };
  const store = {};
  const dispatcher = new Dispatcher(store, config, transport);
  return { dispatcher, transport };
}

/**
 * Send a plain tools/list request (a rate-limited, non-exempt method).
 */
async function sendToolsList(dispatcher, id) {
  await dispatcher.handleMessage({
    jsonrpc: '2.0',
    id,
    method: 'tools/list',
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('Rate Limiter (extended)', () => {

  // -------------------------------------------------------------------------
  // 1. Requests under the limit are allowed
  // -------------------------------------------------------------------------
  it('requests under the limit are allowed (no rate-limit error)', async () => {
    const { dispatcher, transport } = makeDispatcher(3);

    // Send exactly 3 requests — all should succeed (result, not error).
    for (let i = 1; i <= 3; i++) {
      await sendToolsList(dispatcher, i);
    }

    assert.equal(transport.sent.length, 3, 'should have 3 responses');
    for (const resp of transport.sent) {
      assert.ok(!resp.error, `request ${resp.id} should not be rate-limited`);
      assert.ok(resp.result, `request ${resp.id} should have a result`);
    }
  });

  // -------------------------------------------------------------------------
  // 2. Request at exactly the limit is blocked
  // -------------------------------------------------------------------------
  it('request at exactly the limit (4th when limit=3) is blocked with -32003', async () => {
    const { dispatcher, transport } = makeDispatcher(3);

    // Exhaust the 3-request budget.
    for (let i = 1; i <= 3; i++) {
      await sendToolsList(dispatcher, i);
    }

    // The 4th request should be blocked.
    await sendToolsList(dispatcher, 4);

    const last = transport.sent[transport.sent.length - 1];
    assert.equal(last.id, 4);
    assert.ok(last.error, 'should have an error field');
    assert.equal(last.error.code, -32003, 'error code must be -32003 (RATE_LIMITED)');
    assert.ok(!last.result, 'should not have a result field');
  });

  // -------------------------------------------------------------------------
  // 3. After the window expires, requests are allowed again
  //
  // We override Date.now() so that the Dispatcher's internal filter sees the
  // existing timestamps as "outside the 60-second window" on the next call.
  // ---------------------------------------------------------------------------
  it('after window expires, requests are allowed again', async () => {
    const { dispatcher, transport } = makeDispatcher(3);
    const realDateNow = Date.now;

    try {
      const t0 = Date.now();

      // Use a real Date.now() that returns t0 for the first 3 requests.
      globalThis.Date.now = () => t0;

      for (let i = 1; i <= 3; i++) {
        await sendToolsList(dispatcher, i);
      }

      // Confirm budget is exhausted.
      await sendToolsList(dispatcher, 4);
      const blocked = transport.sent[transport.sent.length - 1];
      assert.equal(blocked.id, 4);
      assert.equal(blocked.error?.code, -32003, '4th request should be rate-limited');

      // Advance synthetic time by 61 seconds so all old timestamps fall out.
      globalThis.Date.now = () => t0 + 61_000;

      // This request should succeed because the window has rolled over.
      await sendToolsList(dispatcher, 5);
      const afterWindow = transport.sent[transport.sent.length - 1];
      assert.equal(afterWindow.id, 5);
      assert.ok(!afterWindow.error, 'request after window expiry should not be rate-limited');
      assert.ok(afterWindow.result, 'request after window expiry should have a result');
    } finally {
      // Always restore real Date.now, even on failure.
      globalThis.Date.now = realDateNow;
    }
  });

  // -------------------------------------------------------------------------
  // 4. `initialize`, `initialized`, and `ping` are NOT rate limited
  // -------------------------------------------------------------------------
  it('initialize is not rate limited even when budget is exhausted', async () => {
    const { dispatcher, transport } = makeDispatcher(1);

    // Exhaust the 1-request budget.
    await sendToolsList(dispatcher, 1);
    transport.clear();

    // initialize must bypass the rate limiter.
    await dispatcher.handleMessage({
      jsonrpc: '2.0',
      id: 2,
      method: 'initialize',
      params: { protocolVersion: '2025-03-26', clientInfo: { name: 'test' } },
    });

    assert.equal(transport.sent.length, 1);
    const resp = transport.sent[0];
    assert.ok(!resp.error, 'initialize should not be rate-limited');
    assert.ok(resp.result, 'initialize should return a result');
    assert.equal(resp.result.protocolVersion, '2025-03-26');
  });

  it('ping is not rate limited even when budget is exhausted', async () => {
    const { dispatcher, transport } = makeDispatcher(1);

    // Exhaust budget.
    await sendToolsList(dispatcher, 1);
    transport.clear();

    await dispatcher.handleMessage({
      jsonrpc: '2.0',
      id: 2,
      method: 'ping',
    });

    assert.equal(transport.sent.length, 1);
    const resp = transport.sent[0];
    assert.ok(!resp.error, 'ping should not be rate-limited');
    assert.deepEqual(resp.result, {});
  });

  it('initialized notification is not rate limited and produces no response', async () => {
    const { dispatcher, transport } = makeDispatcher(1);

    // Exhaust budget.
    await sendToolsList(dispatcher, 1);
    transport.clear();

    // `initialized` has no `id` — it is a notification.
    await dispatcher.handleMessage({
      jsonrpc: '2.0',
      method: 'initialized',
    });

    // Notifications never produce a response, rate-limited or not.
    assert.equal(transport.sent.length, 0, 'notifications must never produce a response');
  });

  // -------------------------------------------------------------------------
  // 5. Rate limit error includes useful information (code -32003, reset info)
  // -------------------------------------------------------------------------
  it('rate limit error response includes -32003 code and descriptive message', async () => {
    const { dispatcher, transport } = makeDispatcher(2);

    // Exhaust budget.
    await sendToolsList(dispatcher, 1);
    await sendToolsList(dispatcher, 2);

    // Trigger the rate limit.
    await sendToolsList(dispatcher, 3);

    const last = transport.sent[transport.sent.length - 1];

    // Must be a well-formed JSON-RPC error.
    assert.equal(last.jsonrpc, '2.0');
    assert.equal(last.id, 3);
    assert.ok(last.error, 'must have error object');
    assert.equal(last.error.code, -32003, 'code must be -32003 (RATE_LIMITED)');

    // The message should tell the caller how many requests per window and
    // when the window resets (ISO timestamp).
    const msg = last.error.message;
    assert.ok(typeof msg === 'string' && msg.length > 0, 'error message must be non-empty');
    assert.ok(
      msg.includes('Rate limit'),
      `error message should mention "Rate limit", got: "${msg}"`
    );
    assert.ok(
      msg.includes('2'),
      `error message should include the limit count (2), got: "${msg}"`
    );
    // Should include a reset timestamp in ISO format.
    assert.ok(
      /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(msg),
      `error message should include an ISO timestamp for the reset time, got: "${msg}"`
    );
  });

  // -------------------------------------------------------------------------
  // 6. Rate limiter resets per-instance (fresh Dispatcher starts clean)
  // -------------------------------------------------------------------------
  it('each Dispatcher instance has its own independent rate limit state', async () => {
    const { dispatcher: d1, transport: t1 } = makeDispatcher(1);
    const { dispatcher: d2, transport: t2 } = makeDispatcher(1);

    // Exhaust d1.
    await sendToolsList(d1, 1);
    await sendToolsList(d1, 2); // blocked

    // d2 is fresh — should not be affected.
    await sendToolsList(d2, 1);

    const d2resp = t2.sent[0];
    assert.ok(!d2resp.error, 'd2 should not be rate-limited (independent state)');
    assert.ok(d2resp.result, 'd2 should return a result');
  });

  // -------------------------------------------------------------------------
  // 7. Multiple blocked requests each return -32003
  // -------------------------------------------------------------------------
  it('multiple consecutive requests over the limit all return -32003', async () => {
    const { dispatcher, transport } = makeDispatcher(2);

    // Exhaust budget.
    await sendToolsList(dispatcher, 1);
    await sendToolsList(dispatcher, 2);

    // Send 3 more — all should be blocked.
    for (let i = 3; i <= 5; i++) {
      await sendToolsList(dispatcher, i);
    }

    const blocked = transport.sent.slice(2); // skip the 2 good ones
    assert.equal(blocked.length, 3, 'should have 3 blocked responses');
    for (const resp of blocked) {
      assert.equal(resp.error?.code, -32003, `request ${resp.id} should be -32003`);
    }
  });

});
