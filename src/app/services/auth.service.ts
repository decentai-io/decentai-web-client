import { Injectable } from '@angular/core';

import { DataStoreService } from './datastore.service';
import { EngineService } from './engine.service';
import { RequestService } from './request.service';
import { SessionTokenService } from './session-token.service';
import { ShellStatusService } from './shell-status.service';

/** A person, as the API server shows one (`Users.public`). */
export interface Person {
  user_id: string;
  email: string;
  name: string;
  groups: string[];
  status: 'active' | 'disabled';
  /** They stopped everything of theirs (AI:Switch). */
  stopped?: boolean;
  /** They hold a password somebody handed them, and have not yet chosen
   *  their own. */
  must_change_password?: boolean;
  last_login?: string | null;
  created_at?: string | null;
}

export interface AuthOrganization {
  org_id: string;
  name: string;
}

/** What Auth:Me answers once a session exists. */
export interface Identity {
  person: Person;
  organization: AuthOrganization;
  /** Every endpoint action the person may take. */
  allowed: string[];
  /** Their organization is the operator's, and they may manage shared
   *  runtimes. */
  operator: boolean;
  /** The organization has speech set up: a microphone, and replies said
   *  aloud. */
  speech: boolean;
  /** Every action a policy may name, in words, for the policy editor. */
  catalog: CatalogAction[];
}

/** An action a policy may name, and what the policy editor says of it. */
export interface CatalogAction {
  action: string;
  words: string;
}

/** What the sign-in page asks before anything else (Auth:Join:status). */
export interface JoinStatus {
  /** First run is done: someone set this deployment up. */
  setUp: boolean;
  /** This deployment sends mail: invitations and reset links. */
  mail: boolean;
  /** Anyone may ask for an organization of their own. */
  signup: boolean;
}

/** How a call that signs in, or fails to, ends. */
export interface SignedIn {
  ok: boolean;
  error?: string;
  /** The password is one an administrator handed over: right, and not
   *  yet a way in. */
  changeRequired?: boolean;
  /** The door is shut for a while, for a right password as for a wrong one. */
  throttled?: boolean;
  /** How many seconds until it opens. */
  retryAfter?: number;
}

/**
 * The client half of signing in.
 *
 * The API server is on another origin, so no cookie carries the session:
 * signing in answers with a token, which SessionTokenService keeps and
 * every call presents as a Bearer header. What this service holds is the
 * resolved identity, and in particular `allowed`: the API server has
 * already walked person → groups → policies, so `can()` is a set
 * membership test rather than a second policy engine that could drift
 * from the real one.
 *
 * Hiding a control the person cannot use is a courtesy, not a security
 * boundary: every call is checked again on the server.
 */
@Injectable({ providedIn: 'root' })
export class AuthService {
  identity: Identity | null = null;

  /** Whether this deployment sends mail, as Auth:Join:status last said.
   *  One that has not said yet is taken to. */
  mail = true;

  private allowed = new Set<string>();

  /** Whether the session has been read at least once, and the in-flight read
   *  if one is happening — so a route guard that runs before boot finishes
   *  can await the same request instead of firing a second one. */
  private loaded = false;
  private inflight: Promise<boolean> | null = null;

  constructor(
    private datastore: DataStoreService,
    private engine: EngineService,
    private request: RequestService,
    private session: SessionTokenService,
    private shell: ShellStatusService,
  ) {}

  get user(): Person | null {
    return this.identity?.person ?? null;
  }

  get organization(): AuthOrganization | null {
    return this.identity?.organization ?? null;
  }

  /** Every action a policy may name, with its words. */
  get catalog(): CatalogAction[] {
    return this.identity?.catalog ?? [];
  }

  get operator(): boolean {
    return this.identity?.operator === true;
  }

  /** Whether this install sends email: invitations and reset links. */
  get sendsEmail(): boolean {
    return this.mail;
  }

  /** May the current person take this action? */
  can(action: string): boolean {
    return this.allowed.has(action);
  }

  // ------------------------------------------------------------------
  // Standing an organization up
  // ------------------------------------------------------------------

  /** Whether first run is done, whether mail is set up, and whether a new
   *  organization may be asked for. Unreachable, it says none of them. */
  async setupStatus(): Promise<JoinStatus> {
    const r = await this.request.gateway('Auth:Join:status');
    if (r.error) return { setUp: true, mail: this.mail, signup: false };
    this.mail = r.mail === true;
    return { setUp: r.set_up === true, mail: this.mail, signup: r.signup === true };
  }

  /** Set a fresh deployment up with its setup code, as its first
   *  administrator, and sign in. */
  async setup(payload: {
    organization: string; name: string; email: string; password: string; code: string;
  }): Promise<SignedIn> {
    return this.signedIn(await this.request.gateway('Auth:Join:setup', payload), false);
  }

  /** Ask for an organization of one's own: a link goes to the address. */
  async signup(payload: {
    organization: string; name: string; email: string; password: string;
  }): Promise<SignedIn> {
    const r = await this.request.gateway('Auth:Join:signup', payload);
    return r.error ? this.refused(r) : { ok: true };
  }

  /** Follow a sign-up link: the organization is made, and its
   *  administrator signed in. */
  async confirmSignup(token: string): Promise<SignedIn> {
    return this.signedIn(await this.request.gateway('Auth:Join:confirm', { token }), false);
  }

  // ------------------------------------------------------------------
  // Flow
  // ------------------------------------------------------------------

  /** Email and password. `remember` keeps the session 90 days on this
   *  device, past the browser being closed. */
  async login(payload: { email: string; password: string; remember?: boolean }): Promise<SignedIn> {
    const r = await this.request.gateway('Auth:Session:create', payload);
    if (r.change_required === true) return { ok: false, changeRequired: true };
    return this.signedIn(r, payload.remember === true);
  }

  /** Replace a password an administrator handed over with one of the
   *  person's own, and sign in. */
  async firstPassword(payload: {
    email: string; current_password: string; new_password: string; remember?: boolean;
  }): Promise<SignedIn> {
    return this.signedIn(await this.request.gateway('Auth:Session:first', payload), payload.remember === true);
  }

  /** What an invitation link is an invitation to. The token goes in the
   *  body, never a query string, which ends up in history and referrers. */
  async invitation(token: string): Promise<{ ok: boolean; email?: string; organization?: string; error?: string }> {
    const r = await this.request.gateway('Auth:Join:invitation', { token });
    return r.error ? { ok: false, error: r.error } : { ok: true, email: r.email, organization: r.organization };
  }

  /** Accept an invitation: become a person of the organization and sign
   *  in, in one step. */
  async acceptInvitation(payload: { token: string; name: string; password: string }): Promise<SignedIn> {
    return this.signedIn(await this.request.gateway('Auth:Join:accept', payload), false);
  }

  /** Ask for a password reset link. The API server answers the same
   *  whether or not the account exists. */
  async forgotPassword(email: string): Promise<{ ok: boolean; error?: string }> {
    const r = await this.request.gateway('Auth:Password:forgot', { email });
    return r.error ? { ok: false, error: r.error } : { ok: true };
  }

  /** Whether a reset link still works, and the account it is for. */
  async resetInfo(token: string): Promise<{ ok: boolean; email?: string; error?: string }> {
    const r = await this.request.gateway('Auth:Password:check', { token });
    if (r.error) return { ok: false, error: r.error };
    return r.valid === true ? { ok: true, email: r.email } : { ok: false, error: 'This reset link was used, or has ended.' };
  }

  /** Set a new password from a link. Every session of the account ends:
   *  the person signs in again with it. */
  async resetPassword(payload: { token: string; password: string }): Promise<{ ok: boolean; error?: string }> {
    const r = await this.request.gateway('Auth:Password:reset', payload);
    return r.error ? { ok: false, error: r.error } : { ok: true };
  }

  /**
   * Re-read the session. Called on boot to choose between app and sign-in,
   * and again as the app runs so a permission change takes effect without
   * a reload. Concurrent callers share one in-flight request.
   */
  refresh(): Promise<boolean> {
    if (this.inflight) return this.inflight;
    this.inflight = this.me()
      .then(({ status, data }) => {
        // Only an answer counts as having read the session: after a
        // failure to reach the API server, the next guard asks again.
        this.loaded = this.answered(status);
        // A token the API server no longer honours is dropped: it would
        // be sent with every call, and refused with each.
        if (status === 401) this.session.clear();
        if (status === 200 && data?.person) {
          this.adopt(data as Identity);
          return true;
        }
        // A server that did not answer says nothing about the session,
        // so what is held stays: a dropped connection or a restart must
        // not empty a signed-in person's permissions.
        if (this.answered(status)) this.forget();
        return false;
      })
      .finally(() => {
        this.inflight = null;
      });
    return this.inflight;
  }

  /**
   * Resolve once the session's permissions are known. A route guard calls this
   * so it never decides against an empty permission set while boot is still
   * fetching it.
   */
  async ensureLoaded(): Promise<void> {
    if (!this.loaded) await this.refresh();
  }

  async logout(): Promise<void> {
    try {
      await this.request.gateway('Auth:Session:end');
    } finally {
      // The token goes whether or not the server answered: nothing
      // signed in is left in this browser.
      this.session.clear();
      this.forget();
      this.loaded = false;
    }
  }

  /** Every other session of the person ends; this one goes on. */
  async changePassword(currentPassword: string, newPassword: string): Promise<{ ok: boolean; error?: string }> {
    const r = await this.request.gateway('Auth:Password:change', {
      current_password: currentPassword, new_password: newPassword,
    });
    return r.error ? { ok: false, error: r.error } : { ok: true };
  }

  /**
   * Auth:Me, asked directly rather than through RequestService: on boot,
   * nobody being signed in is no session that ended, and the shell is
   * not told so. Without a token, nobody is signed in, and nothing is
   * asked.
   */
  async me(): Promise<{ status: number; data: any }> {
    if (!this.session.present) return { status: 401, data: {} };
    try {
      const response = await fetch(this.engine.http('app'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...this.session.headers() },
        body: JSON.stringify({ endpoint: 'Auth:Me:get', data: {} }),
      });
      return { status: response.status, data: await response.json().catch(() => ({})) };
    } catch {
      return { status: 0, data: {} };
    }
  }

  // ------------------------------------------------------------------
  // Internals
  // ------------------------------------------------------------------

  /** Whether the API server answered for itself, as opposed to not being
   *  reached (0) or failing on its own account (5xx). */
  private answered(status: number): boolean {
    return status !== 0 && status < 500;
  }

  /** A call that answers with a session: its token kept, for as long as
   *  `remember` says, and who the person is read. */
  private async signedIn(r: any, remember: boolean): Promise<SignedIn> {
    if (r.error) return this.refused(r);
    this.session.keep(String(r.token || ''), remember);
    return (await this.refresh()) ? { ok: true } : { ok: false, error: 'Signed in, but who you are could not be read.' };
  }

  private refused(r: any): SignedIn {
    return r.code === 'too_many'
      ? { ok: false, error: r.error, throttled: true, retryAfter: Number(r.retry_after) || 0 }
      : { ok: false, error: r.error };
  }

  private adopt(identity: Identity): void {
    this.identity = identity;
    this.allowed = new Set<string>(identity.allowed ?? []);
    // The rest of the shell reads the person from the datastore.
    this.datastore.setUserInfo({
      ...identity.person,
      organization_id: identity.organization?.org_id ?? '',
      organization_name: identity.organization?.name ?? '',
    });
    // Whoever is signed in now, no session of theirs has ended: a refusal
    // heard before, signing out or on the sign-in page, says nothing of it.
    this.shell.sessionEnded$.next(false);
  }

  private forget(): void {
    this.identity = null;
    this.allowed = new Set<string>();
    this.datastore.setUserInfo(null);
  }
}
