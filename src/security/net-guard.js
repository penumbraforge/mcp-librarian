/**
 * net-guard — SSRF-safe HTTP(S) fetching for tools that accept URLs.
 *
 * The MCP server fetches URLs the model (or content the model read) chose.
 * Without a guard, that makes the server an in-network HTTP proxy:
 * cloud metadata endpoints (169.254.169.254), localhost services, and
 * RFC1918 hosts are one tool-call away. safeFetch():
 *
 *   1. allows only http:/https: URLs
 *   2. resolves the hostname and rejects if ANY address is private,
 *      loopback, link-local, CGNAT, or metadata-range
 *   3. pins the vetted IP for the actual request (DNS-rebinding TOCTOU)
 *   4. re-runs the full guard on every redirect hop
 *   5. aborts the stream the moment a byte cap is exceeded — no
 *      buffer-then-truncate
 *
 * Zero dependencies — node:https, node:http, node:dns only.
 *
 * @module net-guard
 */

import { get as httpsGet } from 'node:https';
import { get as httpGet } from 'node:http';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

import { McpError, ERROR_CODES } from '../errors.js';

const DEFAULT_MAX_BYTES = 5 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 15000;
const MAX_REDIRECTS = 5;

/**
 * True when an IP address (v4 or v6) must never be fetched.
 * Covers: loopback, RFC1918, link-local/metadata, CGNAT, unspecified,
 * IPv6 ULA/link-local, and IPv4-mapped IPv6 forms of all of the above.
 */
export function isPrivateAddress(addr) {
  if (!addr) return true;

  // Normalize IPv4-mapped IPv6 (::ffff:10.0.0.1 → 10.0.0.1)
  const mapped = addr.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i);
  if (mapped) addr = mapped[1];

  if (isIP(addr) === 4) {
    const octets = addr.split('.').map(Number);
    const [a, b] = octets;
    if (a === 0) return true;                    // 0.0.0.0/8 — "this network"
    if (a === 10) return true;                   // 10/8
    if (a === 127) return true;                  // loopback
    if (a === 169 && b === 254) return true;     // link-local + cloud metadata
    if (a === 172 && b >= 16 && b <= 31) return true; // 172.16/12
    if (a === 192 && b === 168) return true;     // 192.168/16
    if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT 100.64/10
    if (a >= 224) return true;                   // multicast + reserved
    return false;
  }

  // IPv6
  const lower = addr.toLowerCase();
  if (lower === '::' || lower === '::1') return true; // unspecified, loopback
  if (lower.startsWith('fe80')) return true;          // link-local
  if (lower.startsWith('fc') || lower.startsWith('fd')) return true; // ULA fc00::/7
  if (lower.startsWith('ff')) return true;             // multicast
  return false;
}

/**
 * Parse and vet a URL: protocol allowlist, hostname resolution, private
 * range rejection. Returns { parsed, address } with the pinned IP.
 */
async function vetUrl(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new McpError(ERROR_CODES.INVALID_INPUT, `Invalid URL: ${url}`);
  }

  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new McpError(ERROR_CODES.INVALID_INPUT, `Only http/https URLs are allowed, got: ${parsed.protocol}`, { url });
  }

  const hostname = parsed.hostname;

  // Literal IP in the URL — no DNS involved.
  if (isIP(hostname)) {
    if (isPrivateAddress(hostname)) {
      throw new McpError(ERROR_CODES.INVALID_INPUT, `Refusing to fetch private/internal address: ${hostname}`, { url });
    }
    return { parsed, address: hostname };
  }

  // Resolve and reject if ANY address is private — a hostname that mixes
  // public and private records is exactly the rebinding shape.
  let records;
  try {
    records = await lookup(hostname, { all: true, verbatim: true });
  } catch (err) {
    throw new McpError(ERROR_CODES.PACK_FETCH_FAILED, `DNS lookup failed for ${hostname}: ${err.code || err.message}`, { url });
  }

  if (records.length === 0) {
    throw new McpError(ERROR_CODES.PACK_FETCH_FAILED, `DNS returned no addresses for ${hostname}`, { url });
  }

  for (const record of records) {
    if (isPrivateAddress(record.address)) {
      throw new McpError(
        ERROR_CODES.INVALID_INPUT,
        `Refusing to fetch ${hostname} — it resolves to a private/internal address (${record.address})`,
        { url }
      );
    }
  }

  return { parsed, address: records[0].address, family: records[0].family };
}

/**
 * SSRF-guarded GET returning the body as a UTF-8 string.
 *
 * @param {string} url
 * @param {object} [options]
 * @param {number} [options.maxBytes]  — abort once exceeded (default 5 MB)
 * @param {number} [options.timeoutMs] — socket timeout (default 15 s)
 * @param {object} [options.headers]
 * @returns {Promise<string>}
 */
export async function safeFetch(url, options = {}) {
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const headers = { 'User-Agent': 'mcp-librarian/3.0.0', ...options.headers };

  let current = url;

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const { parsed, address, family } = await vetUrl(current);

    const result = await new Promise((resolve, reject) => {
      const getter = parsed.protocol === 'https:' ? httpsGet : httpGet;

      // Pin the vetted address: the request connects to the IP we checked,
      // not whatever a second DNS answer says (rebinding TOCTOU).
      const req = getter(parsed.href, {
        headers,
        timeout: timeoutMs,
        lookup: (host, opts, cb) => {
          if (typeof opts === 'function') { cb = opts; opts = {}; }
          const fam = family ?? (isIP(address) === 6 ? 6 : 4);
          if (opts && opts.all) return cb(null, [{ address, family: fam }]);
          cb(null, address, fam);
        },
      }, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume();
          let next;
          try {
            next = new URL(res.headers.location, parsed.href).href;
          } catch {
            return reject(new McpError(ERROR_CODES.PACK_FETCH_FAILED, `Invalid redirect location from ${parsed.href}`));
          }
          return resolve({ redirect: next });
        }

        if (res.statusCode < 200 || res.statusCode >= 300) {
          res.resume();
          return reject(new McpError(ERROR_CODES.PACK_FETCH_FAILED, `HTTP ${res.statusCode} fetching ${parsed.href}`, { url: parsed.href, status: res.statusCode }));
        }

        const chunks = [];
        let received = 0;
        res.on('data', (chunk) => {
          received += chunk.length;
          if (received > maxBytes) {
            req.destroy();
            return reject(new McpError(
              ERROR_CODES.PACK_FETCH_FAILED,
              `Response exceeded ${maxBytes} bytes fetching ${parsed.href}`,
              { url: parsed.href, maxBytes }
            ));
          }
          chunks.push(chunk);
        });
        res.on('end', () => resolve({ body: Buffer.concat(chunks).toString('utf8') }));
        res.on('error', (e) => reject(new McpError(ERROR_CODES.PACK_FETCH_FAILED, e.message, { url: parsed.href })));
      });

      req.on('timeout', () => { req.destroy(); reject(new McpError(ERROR_CODES.PACK_FETCH_FAILED, `Timeout fetching ${parsed.href}`, { url: parsed.href })); });
      req.on('error', (e) => reject(new McpError(ERROR_CODES.PACK_FETCH_FAILED, e.message, { url: parsed.href })));
    });

    if (result.redirect) {
      current = result.redirect; // next loop iteration re-vets the target
      continue;
    }
    return result.body;
  }

  throw new McpError(ERROR_CODES.PACK_FETCH_FAILED, 'Too many redirects', { url });
}
