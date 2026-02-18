import { createChallenge, isChallengeExpired, verifyHmac } from '../security/hmac.js';

export class Authenticator {
  constructor(clientSecret, librarianSecret) {
    this.clientSecret = clientSecret;
    this.librarianSecret = librarianSecret;
  }

  beginAuth(conn) {
    const challenge = createChallenge();
    conn.challenge = challenge;
    conn.send({
      jsonrpc: '2.0',
      method: 'auth/challenge',
      params: { nonce: challenge.nonceHex },
    });
  }

  handleResponse(conn, params) {
    if (!conn.challenge) {
      return { ok: false, error: 'No pending challenge' };
    }

    if (isChallengeExpired(conn.challenge)) {
      conn.challenge = null;
      return { ok: false, error: 'Challenge expired' };
    }

    const { response: hmacHex } = params;
    if (typeof hmacHex !== 'string') {
      return { ok: false, error: 'Missing HMAC response' };
    }

    // Try librarian first, then client
    if (verifyHmac(this.librarianSecret, conn.challenge.nonce, hmacHex)) {
      conn.role = 'librarian';
      conn.authenticated = true;
      conn.challenge = null;
      return { ok: true, role: 'librarian' };
    }

    if (verifyHmac(this.clientSecret, conn.challenge.nonce, hmacHex)) {
      conn.role = 'client';
      conn.authenticated = true;
      conn.challenge = null;
      return { ok: true, role: 'client' };
    }

    conn.challenge = null;
    return { ok: false, error: 'Invalid HMAC' };
  }
}
