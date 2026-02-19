import { randomBytes } from 'node:crypto';
import { FrameDecoder, encodeFrame } from './framing.js';

export class Connection {
  constructor(socket) {
    this.id = randomBytes(8).toString('hex');
    this.socket = socket;
    this.decoder = new FrameDecoder();
    this.role = null;           // 'client' | 'librarian' — set after auth
    this.authenticated = false;
    this.challenge = null;      // pending HMAC challenge
    this.createdAt = Date.now();
  }

  send(obj) {
    if (this.socket.writable) {
      this.socket.write(encodeFrame(obj));
    }
  }

  close() {
    this.socket.destroy();
  }

  get isClient() {
    return this.role === 'client';
  }

  get isLibrarian() {
    return this.role === 'librarian';
  }
}
