import { Injectable } from '@angular/core';

import { EngineService } from './engine.service';

/**
 * The session token, which the web client holds itself.
 *
 * The engine is on another origin, so no cookie carries the session: the
 * sign-in answers with the token, and every request presents it as an
 * `Authorization: Bearer` header — the chat socket as a subprotocol,
 * since a browser lets a socket carry no header of its own. "Keep me
 * signed in" decides where it is kept: `localStorage` outlives the
 * browser being closed, `sessionStorage` goes with the tab.
 *
 * One key, two stores, never both: keeping a token in one store clears
 * the other, so a sign-in that was not to be kept leaves nothing behind.
 *
 * A token is kept with the engine that issued it, and is a token only
 * there: when the engine's address changes — the person chose another,
 * or the deployment's `assets/config.json` names another — the token is
 * not sent to the new one, and is dropped. One engine's session is never
 * shown to another.
 */
@Injectable({ providedIn: 'root' })
export class SessionTokenService {
  static readonly STORAGE_KEY = 'decentai.session';

  /** The WebSocket subprotocol the API server takes the token after
   *  (`chats/socket.py`). */
  static readonly WS_PROTOCOL = 'bearer';

  private held: Held | null | undefined;

  constructor(private engine: EngineService) {}

  /** The token, or null when nobody is signed in to this engine here. */
  get token(): string | null {
    if (this.held === undefined) this.held = this.recall();
    if (this.held && this.held.engine !== this.engine.url) {
      // Issued by another engine: never offered to this one.
      this.clear();
    }
    return this.held ? this.held.token : null;
  }

  /** Whether a token is held at all. */
  get present(): boolean {
    return !!this.token;
  }

  /** Keep a token the sign-in answered with, for the engine it came
   *  from. */
  keep(token: string, remember: boolean): void {
    if (!token) {
      this.clear();
      return;
    }
    this.held = { engine: this.engine.url, token };
    const kept = JSON.stringify(this.held);
    this.write(remember ? localStorage : sessionStorage, kept);
    this.write(remember ? sessionStorage : localStorage, '');
  }

  /** Forget it: on sign-out, a password change, a token the engine
   *  refused, or another engine chosen. */
  clear(): void {
    this.held = null;
    this.write(localStorage, '');
    this.write(sessionStorage, '');
  }

  /** The header every request carries while signed in. */
  headers(): Record<string, string> {
    const token = this.token;
    return token ? { Authorization: `Bearer ${token}` } : {};
  }

  /** What the chat socket offers: the protocol's name, then the token.
   *  Nothing while signed out — the handshake then names no protocol. */
  wsProtocols(): string[] {
    const token = this.token;
    return token ? [SessionTokenService.WS_PROTOCOL, token] : [];
  }

  // ------------------------------------------------------------------

  /** What a store keeps: the token and the engine it is for. Anything
   *  else found under the key — a bare token from before tokens named
   *  their engine, or something unreadable — is no session. */
  private recall(): Held | null {
    for (const store of [sessionStorage, localStorage]) {
      try {
        const found = store.getItem(SessionTokenService.STORAGE_KEY);
        if (!found) continue;
        const held = JSON.parse(found);
        if (held && typeof held.engine === 'string' && typeof held.token === 'string'
            && held.engine && held.token) {
          return { engine: held.engine, token: held.token };
        }
      } catch {
        // A store that cannot be read, or a value that is not ours,
        // holds nothing for us.
      }
    }
    return null;
  }

  private write(store: Storage, value: string): void {
    try {
      if (value) store.setItem(SessionTokenService.STORAGE_KEY, value);
      else store.removeItem(SessionTokenService.STORAGE_KEY);
    } catch {
      // Storage that cannot be written: the token holds for this page.
    }
  }
}

/** A kept session: the token, and the engine (its address) that issued it. */
interface Held {
  engine: string;
  token: string;
}
