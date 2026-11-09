import { Injectable } from '@angular/core';

import { AuthService } from './auth.service';
import { EngineService } from './engine.service';
import { RequestService } from './request.service';
import { SessionTokenService } from './session-token.service';

/**
 * Speech, as the organization set it up: a recording in and words back
 * (`POST /speech`), words in and audio back (Settings:Speech:speak).
 * Whether it is set up at all is what Auth:Me says (`speech`).
 */
@Injectable({ providedIn: 'root' })
export class SettingsSpeechService {
  constructor(
    private request: RequestService,
    private auth: AuthService,
    private engine: EngineService,
    private session: SessionTokenService,
  ) {}

  /** Whether the organization offers speech: a microphone, and replies
   *  said aloud. `fresh` reads who the person is again first, after the
   *  setting changed. */
  async offered(fresh = false): Promise<boolean> {
    if (fresh) await this.auth.refresh();
    return this.auth.identity?.speech === true;
  }

  /** A recording, as the browser made it, to words. */
  async transcribe(blob: Blob, language = ''): Promise<{ text?: string; error?: string }> {
    try {
      const query = language ? `?language=${encodeURIComponent(language)}` : '';
      const answer = await fetch(this.engine.http(`speech${query}`), {
        method: 'POST',
        headers: { 'Content-Type': blob.type || 'audio/webm', ...this.session.headers() },
        body: blob,
      });
      const body = await answer.json().catch(() => ({}));
      if (answer.ok) return { text: String(body.text || '') };
      return { error: body.error?.message || `Speech answered ${answer.status}.` };
    } catch {
      return { error: 'Could not reach the server. Check your connection.' };
    }
  }

  /** Words to audio: a file the page plays. */
  async speak(text: string, language = ''): Promise<{ audio?: Blob; error?: string }> {
    const r = await this.request.gateway('Settings:Speech:speak', { text, language });
    if (r.error) return { error: r.error };
    const raw = atob(String(r.audio || ''));
    const bytes = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
    return { audio: new Blob([bytes], { type: r.type || 'audio/mpeg' }) };
  }
}
