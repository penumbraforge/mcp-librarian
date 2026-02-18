#!/usr/bin/env node

/**
 * mcp-librarian-stdio — Thin NDJSON ↔ length-prefixed frame proxy.
 * Connects to the librarian Unix domain socket and translates between
 * stdio NDJSON (what MCP clients speak) and binary framing (what the server speaks).
 * Also handles HMAC authentication transparently.
 *
 * Part of MCP Librarian by Penumbra Forge
 * https://penumbraforge.com/librarian | MIT License
 */

import { connect } from 'node:net';
import { readFileSync } from 'node:fs';
import { createHmac } from 'node:crypto';
import { join } from 'node:path';
import { homedir } from 'node:os';

const LIB_DIR = join(homedir(), '.mcp-librarian');
const SOCKET_PATH = join(LIB_DIR, 'librarian.sock');
const SECRET_PATH = join(LIB_DIR, 'client.secret');

const HEADER_SIZE = 4;
const MAX_MESSAGE_SIZE = 2 * 1024 * 1024;

// Load client secret
let clientSecret;
try {
  clientSecret = readFileSync(SECRET_PATH, 'utf8').trim();
} catch {
  process.stderr.write(`[mcp-librarian-stdio] Cannot read ${SECRET_PATH}\n`);
  process.exit(1);
}

// Connect to UDS
const socket = connect(SOCKET_PATH);
let authenticated = false;
let socketBuffer = Buffer.alloc(0);
let stdinBuffer = '';

socket.on('error', (err) => {
  process.stderr.write(`[mcp-librarian-stdio] Socket error: ${err.message}\n`);
  process.exit(1);
});

socket.on('close', () => {
  process.exit(0);
});

// Decode length-prefixed frames from socket
socket.on('data', (chunk) => {
  socketBuffer = Buffer.concat([socketBuffer, chunk]);

  while (socketBuffer.length >= HEADER_SIZE) {
    const length = socketBuffer.readUInt32BE(0);
    if (length > MAX_MESSAGE_SIZE) {
      process.stderr.write('[mcp-librarian-stdio] Frame too large\n');
      process.exit(1);
    }
    if (socketBuffer.length < HEADER_SIZE + length) break;

    const payload = socketBuffer.subarray(HEADER_SIZE, HEADER_SIZE + length);
    socketBuffer = socketBuffer.subarray(HEADER_SIZE + length);

    let msg;
    try {
      msg = JSON.parse(payload.toString('utf8'));
    } catch {
      continue;
    }

    // Handle auth flow transparently
    if (msg.method === 'auth/challenge') {
      const nonce = Buffer.from(msg.params.nonce, 'hex');
      const hmac = createHmac('sha256', clientSecret).update(nonce).digest('hex');
      sendToSocket({ method: 'auth/response', params: { response: hmac } });
      continue;
    }

    if (msg.method === 'auth/success') {
      authenticated = true;
      // Flush any queued stdin messages
      continue;
    }

    if (msg.method === 'auth/failure') {
      process.stderr.write(`[mcp-librarian-stdio] Auth failed: ${msg.params?.error}\n`);
      process.exit(1);
    }

    // Forward to stdout as NDJSON
    process.stdout.write(JSON.stringify(msg) + '\n');
  }
});

// Read NDJSON from stdin
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  stdinBuffer += chunk;
  const lines = stdinBuffer.split('\n');
  stdinBuffer = lines.pop(); // Keep incomplete line

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const msg = JSON.parse(trimmed);
      sendToSocket(msg);
    } catch {
      process.stderr.write(`[mcp-librarian-stdio] Invalid JSON from stdin\n`);
    }
  }
});

process.stdin.on('end', () => {
  socket.end();
});

function sendToSocket(obj) {
  const payload = Buffer.from(JSON.stringify(obj), 'utf8');
  const header = Buffer.alloc(HEADER_SIZE);
  header.writeUInt32BE(payload.length, 0);
  socket.write(Buffer.concat([header, payload]));
}
