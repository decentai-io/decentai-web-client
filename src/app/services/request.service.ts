import { Injectable } from '@angular/core';
import { EngineService } from './engine.service';
import { SessionTokenService } from './session-token.service';
import { ShellStatusService } from './shell-status.service';

/** A request the API server refused, or one that never got an answer: its
 *  message is the sentence to show as it is. Thrown by a service whose
 *  answer has no room for an error of its own. */
export class Refused extends Error {
  /** What a page says when loading failed: the refusal's own words, or,
   *  for anything else that went wrong, that the server was not reached. */
  static words(failed: unknown): string {
    return failed instanceof Refused ? failed.message : 'Could not reach the server. Check your connection.';
  }
}

@Injectable({
  providedIn: 'root',
})
export class RequestService {
  constructor(
    private shell: ShellStatusService,
    private engine: EngineService,
    private session: SessionTokenService,
  ) {}

  /**
   * One call: POST /app {endpoint, data} → the answer, or, for a refusal,
   * `{error, code}`: the API server's sentence for a person, its code
   * (`invalid`, `refused`, `not_found`, `conflict`, `too_many`, …), and
   * whatever it added beside them, such as `retry_after`.
   *
   * The session token rides on every call as a Bearer header: the API
   * server is on another origin, and no cookie crosses to it. Every
   * service goes through here so a refusal is read in one place.
   */
  async gateway<T = any>(endpoint: string, data: any = {}): Promise<T & Failure> {
    let response: Response;
    try {
      response = await fetch(this.engine.http('app'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...this.session.headers() },
        body: JSON.stringify({ endpoint, data }),
      });
    } catch {
      return { error: 'Could not reach the server. Check your connection.' } as T & Failure;
    }
    // Nobody is signed in any more. The page is left as it is, so nothing
    // typed is lost: the shell says so on every page, with the way to sign
    // in again.
    if (response.status === 401) {
      this.shell.sessionEnded();
      return { error: 'Your session ended. Sign in again to continue.', code: 'signed_out' } as T & Failure;
    }
    const answer = await response.json().catch(() => null);
    if (response.status === 200 && answer) return answer as T & Failure;
    const { message, ...rest } = answer?.error ?? {};
    return { ...rest, error: String(message || `Request failed (${response.status}).`) } as T & Failure;
  }
}

/** What a refused call carries beside its answer's own fields. */
export interface Failure {
  error?: string;
  code?: string;
  retry_after?: number;
}
