import { createServer } from 'node:net';
import { unlinkSync, existsSync, chmodSync } from 'node:fs';
import { Connection } from './connection.js';
import { RateLimiter } from '../security/rate-limiter.js';

const MAX_CONNECTIONS = 20;

export class SocketServer {
  constructor(socketPath, authenticator, protocol, auditLog, opts = {}) {
    this.socketPath = socketPath;
    this.authenticator = authenticator;
    this.protocol = protocol;
    this.auditLog = auditLog;
    this.rateLimiter = new RateLimiter(opts.rateLimit);
    this.connections = new Map();
    this.server = null;
  }

  start() {
    return new Promise((resolve, reject) => {
      // Clean up stale socket — use exclusive listen to prevent race
      if (existsSync(this.socketPath)) {
        unlinkSync(this.socketPath);
      }

      this.server = createServer(socket => this._onConnection(socket));

      this.server.on('error', (err) => {
        if (err.code === 'EADDRINUSE') {
          reject(new Error(`Socket already in use: ${this.socketPath} — another instance may be running`));
        } else {
          reject(err);
        }
      });

      this.server.listen(this.socketPath, () => {
        chmodSync(this.socketPath, 0o600);
        this.auditLog?.log({ event: 'server_start', socket: this.socketPath });
        resolve();
      });
    });
  }

  _onConnection(socket) {
    if (this.connections.size >= MAX_CONNECTIONS) {
      socket.destroy();
      return;
    }

    const conn = new Connection(socket);
    this.connections.set(conn.id, conn);

    this.auditLog?.log({ event: 'connect', connId: conn.id });

    // Start auth with timeout (5s to complete auth or get disconnected)
    this.authenticator.beginAuth(conn);
    conn._authTimer = setTimeout(() => {
      if (!conn.authenticated) {
        this.auditLog?.log({ event: 'auth_timeout', connId: conn.id });
        conn.close();
      }
    }, 5000);

    socket.on('data', chunk => {
      try {
        const frames = conn.decoder.push(chunk);
        for (const msg of frames) {
          this._handleMessage(conn, msg).catch(e => {
            this.auditLog?.log({ event: 'dispatch_error', connId: conn.id, error: e.message });
            conn.close();
          });
        }
      } catch (e) {
        this.auditLog?.log({ event: 'frame_error', connId: conn.id, error: e.message });
        conn.close();
      }
    });

    socket.on('close', () => {
      clearTimeout(conn._authTimer);
      this.connections.delete(conn.id);
      this.rateLimiter.remove(conn.id);
      this.auditLog?.log({ event: 'disconnect', connId: conn.id });
    });

    socket.on('error', () => {
      this.connections.delete(conn.id);
      this.rateLimiter.remove(conn.id);
    });
  }

  async _handleMessage(conn, msg) {
    // Auth phase
    if (!conn.authenticated) {
      if (msg.method === 'auth/response') {
        const result = this.authenticator.handleResponse(conn, msg.params || {});
        if (result.ok) {
          conn.send({ jsonrpc: '2.0', method: 'auth/success', params: { role: result.role } });
          this.auditLog?.log({ event: 'auth_success', connId: conn.id, role: result.role });
        } else {
          conn.send({ jsonrpc: '2.0', method: 'auth/failure', params: { error: result.error } });
          this.auditLog?.log({ event: 'auth_failure', connId: conn.id, error: result.error });
          conn.close();
        }
        return;
      }
      // Only auth messages allowed before authenticated
      conn.send({ jsonrpc: '2.0', id: msg.id, error: { code: -32600, message: 'Not authenticated' } });
      return;
    }

    // Dispatch authenticated messages
    const response = await this.protocol.dispatch(conn, msg, this.rateLimiter);
    if (response) {
      conn.send(response);
    }
  }

  stop() {
    return new Promise(resolve => {
      for (const conn of this.connections.values()) {
        conn.close();
      }
      this.connections.clear();
      if (this.server) {
        this.server.close(resolve);
      } else {
        resolve();
      }
    });
  }
}
