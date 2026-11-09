import { Injectable } from '@angular/core';

import { RequestService } from './request.service';

/** What a connection attempt comes back with: the secret it connected,
 *  or the sentence to show. */
export interface ConnectResult {
  record?: any;
  error?: string;
}

/**
 * Connecting an account a secret's resource declares, instead of typing
 * a credential.
 *
 * The API server builds the provider's consent address
 * (Secrets:Oauth:start); this opens it in a popup. The provider sends the
 * popup back to the API server, which keeps its answer for the person who
 * started it and sends the popup on to this app's `/oauth/done`. There
 * the popup tells this page the state, and closes (AppComponent); this
 * page finishes under its own session (Secrets:Oauth:complete), which
 * proves the account goes to the person who chose Connect.
 *
 * The popup is opened on the click itself, before the round trip, because
 * a window opened later is a window a browser blocks.
 */
@Injectable({ providedIn: 'root' })
export class OauthConnectService {
  constructor(private request: RequestService) {}

  /** Connect the account of a secret of the person's own. */
  async connect(recordId: string): Promise<ConnectResult> {
    const popup = window.open('', 'decentai-oauth', 'width=540,height=700,popup=yes');
    const started = await this.request.gateway('Secrets:Oauth:start', { record_id: recordId });
    if (started.error || !started.url) {
      popup?.close();
      return { error: started.error || 'Could not start the connection.' };
    }
    if (!popup) {
      return { error: 'Your browser blocked the sign-in window. Allow popups for this site and try again.' };
    }
    // The window is still this page's own (about:blank, this origin):
    // only a web address is loaded into it, never one that would run here.
    if (!/^https?:$/.test(new URL(String(started.url), document.baseURI).protocol)) {
      popup.close();
      return { error: 'The provider\'s sign-in address is not a web address.' };
    }
    popup.location.href = started.url;
    const returned = await this.awaitPopup(popup);
    if (returned.error) return returned;
    const done = await this.request.gateway('Secrets:Oauth:complete', { state: returned.state });
    return done.error ? { error: done.error } : { record: done.record };
  }

  private awaitPopup(popup: Window): Promise<{ state?: string; error?: string }> {
    return new Promise((resolve) => {
      let timer = 0;
      const done = (result: { state?: string; error?: string }) => {
        window.removeEventListener('message', onMessage);
        window.clearInterval(timer);
        resolve(result);
      };
      const onMessage = (event: MessageEvent) => {
        const data = event.data;
        // Only this app's own page, in the window this attempt opened,
        // answers for it.
        if (!data || data.type !== 'decentai:oauth' || event.origin !== window.location.origin
            || event.source !== popup) return;
        done(data.failed || !data.state
          ? { error: 'The provider did not connect the account.' }
          : { state: String(data.state) });
      };
      window.addEventListener('message', onMessage);
      timer = window.setInterval(() => {
        if (popup.closed) done({ error: 'The sign-in window was closed before it finished.' });
      }, 500);
    });
  }
}
