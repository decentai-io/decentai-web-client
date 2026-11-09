import { Injectable } from '@angular/core';

/** Where the engine's address was found. */
export type EngineSource = 'chosen' | 'config' | 'origin';

/** What asking an address whether an engine answers there found. */
export type EngineProbe = 'engine' | 'not-engine' | 'unreachable';

/**
 * The one place the engine's address is known.
 *
 * The web client is served on its own — its container, a static host,
 * `npm start` — and speaks to a DecentAI engine somewhere else, the way
 * the app on a phone does. Which engine is decided once, here, in this
 * order:
 *
 *   1. the deployment's own word, `assets/config.json` beside the app's
 *      files (`{"engine": "https://..."}`), written when the app is
 *      deployed: nobody is asked, and nobody can point this page at
 *      another engine to collect what is typed into it;
 *   2. the address the person entered, kept in this browser
 *      (`localStorage`), where the deployment names none;
 *   3. the page's own origin — for a deployment whose own reverse
 *      proxy serves the engine's paths beside the app's files on one
 *      address. The engine brings no such proxy; this only keeps one
 *      that a deployment chose working.
 *
 * `load()` runs before the app starts (`provideAppInitializer`), so
 * every service that builds an address finds `url` set. Nothing here
 * decides whether the last fallback is really an engine: the root
 * component asks (`probe`) and shows the Connect screen when it is not.
 */
@Injectable({ providedIn: 'root' })
export class EngineService {
  /** The key the chosen address is kept under in this browser. */
  static readonly STORAGE_KEY = 'decentai.engine';

  /** The deployment's word, beside the app's files. */
  static readonly CONFIG_FILE = 'assets/config.json';

  /** The engine's origin as last resolved, for code that cannot inject
   *  this service (a static check of an address in a chat message). */
  static origin = window.location.origin;

  /** The engine's address as last resolved, path included, for the same
   *  code: `https://example.com/decentai`. */
  static address = window.location.origin;

  /** The engine's address, no trailing slash: `https://api.example.com`. */
  url = window.location.origin;

  /** Where `url` came from. */
  source: EngineSource = 'origin';

  /** Whether an engine was named — by the person, or by the deployment —
   *  as opposed to the page's own origin being assumed. */
  get configured(): boolean {
    return this.source !== 'origin';
  }

  /** Whether the deployment named the engine: then it is not the
   *  person's to change here. */
  get pinned(): boolean {
    return this.source === 'config';
  }

  /** The engine's origin, `scheme://host[:port]`. */
  get origin(): string {
    return new URL(this.url).origin;
  }

  /** The engine as a person would say it: its host, and a port that is
   *  not the scheme's own. */
  get label(): string {
    const at = new URL(this.url);
    return at.host + (at.pathname !== '/' ? at.pathname.replace(/\/$/, '') : '');
  }

  /** Resolve the address, before the app starts. Never throws: a
   *  config file that is missing, or not JSON, means the file said
   *  nothing. */
  async load(): Promise<void> {
    const deployed = await this.deployed();
    if (deployed) {
      this.use(deployed, 'config');
      return;
    }
    const chosen = this.recall();
    if (chosen) {
      this.use(chosen, 'chosen');
      return;
    }
    this.use(window.location.origin, 'origin');
  }

  /** Keep the address the person entered, and use it from now on. */
  choose(address: string): void {
    const url = EngineService.normalize(address);
    try {
      localStorage.setItem(EngineService.STORAGE_KEY, url);
    } catch {
      // Storage that cannot be written: the choice holds for this page.
    }
    this.use(url, 'chosen');
  }

  /** Drop the person's choice: the next load asks the deployment, then
   *  the page's origin. */
  forget(): void {
    try {
      localStorage.removeItem(EngineService.STORAGE_KEY);
    } catch {
      // Nothing to forget, then.
    }
  }

  /** An absolute address under the engine: `http('app')`. */
  http(path: string): string {
    return new URL(path.replace(/^\/+/, ''), `${this.url}/`).toString();
  }

  /** The same, for a WebSocket: `ws:` under `http:`, `wss:` under `https:`. */
  ws(path: string): string {
    const at = new URL(this.http(path));
    at.protocol = at.protocol === 'https:' ? 'wss:' : 'ws:';
    return at.toString();
  }

  /** Whether an address is the engine's own: its origin. */
  isOwn(address: string): boolean {
    try {
      return new URL(address, document.baseURI).origin === this.origin;
    } catch {
      return false;
    }
  }

  /**
   * Ask an address whether a DecentAI API server answers there. It
   * answers Auth:Join:status to anybody, as JSON that says whether the
   * deployment is set up; a page server answers the page, or nothing.
   */
  static async probe(address: string): Promise<EngineProbe> {
    let url: string;
    try {
      url = new URL('app', `${EngineService.normalize(address)}/`).toString();
    } catch {
      return 'not-engine';
    }
    try {
      const answer = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ endpoint: 'Auth:Join:status', data: {} }),
        cache: 'no-store',
      });
      if (answer.status !== 200) return 'not-engine';
      const body = await answer.json().catch(() => null);
      return body && typeof body === 'object' && 'set_up' in body
        ? 'engine' : 'not-engine';
    } catch {
      return 'unreachable';
    }
  }

  /**
   * "decentai.example.com" → "https://decentai.example.com"; a
   * localhost address with no scheme is plain http, since that is what
   * an engine on one's own computer speaks; trailing slashes dropped.
   */
  static normalize(input: string): string {
    const trimmed = String(input || '').trim().replace(/\/+$/, '');
    if (!trimmed) return '';
    if (/^https?:\/\//i.test(trimmed)) return trimmed;
    const local = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?(\/|$)/i.test(trimmed);
    return `${local ? 'http' : 'https'}://${trimmed}`;
  }

  // ------------------------------------------------------------------

  private use(url: string, source: EngineSource): void {
    this.url = url.replace(/\/+$/, '');
    this.source = source;
    EngineService.origin = this.origin;
    EngineService.address = this.url;
  }

  private recall(): string {
    try {
      return EngineService.normalize(localStorage.getItem(EngineService.STORAGE_KEY) || '');
    } catch {
      return '';
    }
  }

  /** What `assets/config.json` beside the app says, or nothing. Asked
   *  afresh every time: it is the deployment's to change. */
  private async deployed(): Promise<string> {
    try {
      const answer = await fetch(new URL(EngineService.CONFIG_FILE, document.baseURI).toString(), {
        cache: 'no-store',
        headers: { Accept: 'application/json' },
      });
      if (!answer.ok) return '';
      const body = await answer.json();
      return EngineService.normalize(typeof body?.engine === 'string' ? body.engine : '');
    } catch {
      return '';
    }
  }
}
