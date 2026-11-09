import { Component, EventEmitter, OnDestroy, OnInit, Output } from '@angular/core';

import { AuthService, SignedIn } from '../../services/auth.service';
import { appBase, arrivalLink } from '../../services/auth.util';
import { DataStoreService } from '../../services/datastore.service';
import { EngineService } from '../../services/engine.service';
import { NavigatorService } from '../../services/navigator.service';

type Mode =
  | 'opening' | 'login' | 'invitation' | 'forgot' | 'reset' | 'first'
  | 'setup' | 'signup' | 'signup-confirm';

/**
 * Signing in is one step: email and password. An address belongs to one
 * account, and a person joins an organization that exists by invitation.
 *
 * `setup` is the first-run page: a deployment nobody is in yet asks the
 * person who opens it, with the setup code, to name the organization and
 * become its administrator, once. `signup` asks for an organization of
 * one's own, where the deployment opened it; `signup-confirm` is how its
 * mailed link lands. `invitation` and `reset` are opened from mailed
 * links, `forgot` asks for a reset link. `opening` is the moment the page
 * asks which of these it is.
 */
@Component({
  selector: 'app-auth',
  templateUrl: './auth.component.html',
  styleUrls: ['./auth.component.css'],
  standalone: false,
})
export class AuthComponent implements OnInit, OnDestroy {
  mode: Mode = 'opening';

  email = '';
  password = '';
  /** Keep the sign-in on this device. What was chosen last is offered
   *  again, with the email it was chosen for. */
  remember = false;
  name = '';
  orgName = '';
  /** The first-run page's setup code. */
  code = '';

  /** A new organization may be asked for from the sign-in page. */
  signupOpen = false;
  /** This deployment sends mail: a forgotten password is reset by link. */
  mail = true;
  /** After asking for an organization: the link is on its way. */
  signupSent = false;

  /** The token of the link the page was opened by. */
  private token = '';
  inviteValid = false;
  resetValid = false;
  /** The link is being checked before anything is asked. */
  checking = false;

  /** After asking for a reset: the link is on its way, if there is an
   *  account at the address. */
  forgotSent = false;

  busy = false;
  /** What the server refused, said in one block above the button. */
  error = '';
  /** What the sign-in says before anything is typed: why it is shown. */
  notice = '';
  /** The refusal is a lockout, not a wrong password. */
  throttled = false;
  /** Seconds until a locked door opens, counted down; 0 when it is open. */
  lockedFor = 0;
  private lockTimer: ReturnType<typeof setInterval> | null = null;
  /** The button was pressed: what a field still needs is said under it. */
  tried = false;
  /** The password is shown as typed. */
  shown = false;

  /** Whether another engine may be chosen from here: the sign-in page
   *  says the engine's name, with the way to change it. */
  @Output() changeEngine = new EventEmitter<void>();

  constructor(
    private auth: AuthService,
    private datastore: DataStoreService,
    private navigator: NavigatorService,
    public engine: EngineService,
  ) {}

  ngOnInit(): void {
    const link = arrivalLink();
    this.token = link?.token ?? '';
    if (link?.kind === 'invitation') {
      void this.openInvitation();
    } else if (link?.kind === 'reset') {
      void this.openReset();
    } else if (link?.kind === 'signup') {
      this.mode = 'signup-confirm';
    } else {
      this.recallChoice();
      void this.openDoor();
    }
  }

  // ------------------------------------------------------------------
  // The first run, and sign-up
  // ------------------------------------------------------------------

  /** Which page this is: the first-run page while nobody is in this
   *  deployment, else the sign-in, offering sign-up where it is open. */
  private async openDoor(): Promise<void> {
    const status = await this.auth.setupStatus();
    this.signupOpen = status.signup;
    this.mail = status.mail;
    this.mode = status.setUp ? 'login' : 'setup';
  }

  /** What the organization's form still needs, field by field; '' for
   *  each that reads as done. The server checks the same. */
  get orgNameProblem(): string {
    return this.orgName.trim() ? '' : "Enter the organization's name.";
  }

  get nameProblem(): string {
    return this.name.trim() ? '' : 'Enter your name.';
  }

  get codeProblem(): string {
    return this.code.trim() ? '' : 'Enter the setup code.';
  }

  private get organizationFormProblem(): boolean {
    return !!(this.orgNameProblem || this.nameProblem || this.emailProblem
      || this.passwordProblem || (this.mode === 'setup' && this.codeProblem));
  }

  /** Name the organization and become its administrator. */
  async setUp(): Promise<void> {
    this.tried = true;
    this.error = '';
    if (this.organizationFormProblem) return;

    this.busy = true;
    try {
      const result = await this.auth.setup({
        organization: this.orgName.trim(),
        name: this.name.trim(),
        email: this.email.trim(),
        password: this.password,
        code: this.code.trim(),
      });
      if (result.ok) {
        this.enterApp();
        return;
      }
      this.refused(result, 'This DecentAI could not be set up.');
      // Somebody else finished first: what is left is to sign in.
      const status = await this.auth.setupStatus();
      if (status.setUp) {
        this.signupOpen = status.signup;
        this.mail = status.mail;
        this.clearForm();
        this.error = result.error || '';
        this.mode = 'login';
      }
    } finally {
      this.busy = false;
    }
  }

  startSignup(): void {
    this.clearForm();
    this.signupSent = false;
    this.mode = 'signup';
  }

  /** Ask for an organization: a link goes to the address. */
  async requestSignup(): Promise<void> {
    this.tried = true;
    this.error = '';
    if (this.organizationFormProblem) return;

    this.busy = true;
    try {
      const result = await this.auth.signup({
        organization: this.orgName.trim(),
        name: this.name.trim(),
        email: this.email.trim(),
        password: this.password,
      });
      if (result.ok) {
        this.password = '';
        this.signupSent = true;
        return;
      }
      this.refused(result, 'Could not ask for the organization.');
    } finally {
      this.busy = false;
    }
  }

  /** Follow a sign-up link: the organization asked for is made, and its
   *  administrator signed in. The link alone proves the mailbox. */
  async confirmSignup(): Promise<void> {
    this.error = '';
    this.busy = true;
    try {
      const result = await this.auth.confirmSignup(this.token);
      if (result.ok) {
        this.enterApp();
        return;
      }
      this.error = result.error || 'This link was used, or has ended.';
    } finally {
      this.busy = false;
    }
  }

  // ------------------------------------------------------------------
  // Login
  // ------------------------------------------------------------------

  async signIn(): Promise<void> {
    this.tried = true;
    this.error = '';
    if (this.emailProblem || !this.password) return;

    this.busy = true;
    this.throttled = false;

    try {
      const result = await this.auth.login({
        email: this.email.trim(),
        password: this.password,
        remember: this.remember,
      });

      if (result.ok) {
        this.keepChoice();
        this.enterApp();
        return;
      }
      if (result.changeRequired) {
        // Held until their own is chosen: it is asked for again then.
        this.handedPassword = this.password;
        this.password = '';
        this.tried = false;
        this.notice = '';
        this.mode = 'first';
        return;
      }
      this.refused(result, 'Email or password is incorrect.');
    } finally {
      this.busy = false;
    }
  }

  /** The password an administrator handed over, between signing in
   *  with it and choosing one's own. */
  private handedPassword = '';

  async chooseOwnPassword(): Promise<void> {
    this.tried = true;
    this.error = '';
    if (this.passwordProblem) return;

    this.busy = true;

    try {
      const result = await this.auth.firstPassword({
        email: this.email.trim(),
        current_password: this.handedPassword,
        new_password: this.password,
        remember: this.remember,
      });

      if (result.ok) {
        this.handedPassword = '';
        this.keepChoice();
        this.enterApp();
        return;
      }
      this.refused(result, 'Could not set your password.');
    } finally {
      this.busy = false;
    }
  }

  /** The key the remembered email is kept under on this device. */
  private static readonly REMEMBERED = 'decentai.remembered-email';

  /** Offer again what was chosen at the last sign-in on this device. */
  private recallChoice(): void {
    try {
      const email = localStorage.getItem(AuthComponent.REMEMBERED) || '';
      if (email && !this.email) {
        this.email = email;
        this.remember = true;
      }
    } catch {
      // Storage that cannot be read: the form starts empty, as it did.
    }
  }

  private keepChoice(): void {
    try {
      if (this.remember) {
        localStorage.setItem(AuthComponent.REMEMBERED, this.email.trim());
      } else {
        localStorage.removeItem(AuthComponent.REMEMBERED);
      }
    } catch {
      // Nothing is lost but the convenience.
    }
  }

  ngOnDestroy(): void {
    this.unlock();
  }

  /** A refusal said in one block; a lockout counted down. */
  private refused(result: SignedIn, fallback: string): void {
    this.throttled = !!result.throttled;
    this.error = result.error || fallback;
    if (result.retryAfter) this.lockFor(result.retryAfter);
  }

  /** The door is shut for this long: the button waits, and the notice
   *  counts the time down. */
  private lockFor(seconds: number): void {
    this.unlock();
    this.lockedFor = seconds;
    this.lockTimer = setInterval(() => {
      this.lockedFor -= 1;
      if (this.lockedFor > 0) return;
      this.unlock();
      this.error = '';
      this.throttled = false;
    }, 1000);
  }

  private unlock(): void {
    if (this.lockTimer) clearInterval(this.lockTimer);
    this.lockTimer = null;
    this.lockedFor = 0;
  }

  /** What is left of a lockout: "4:59". */
  get lockLeft(): string {
    return `${Math.floor(this.lockedFor / 60)}:${String(this.lockedFor % 60).padStart(2, '0')}`;
  }

  /** A mode starts clean: nothing refused, nothing pressed, no password. */
  private clearForm(): void {
    this.unlock();
    this.error = '';
    this.notice = '';
    this.throttled = false;
    this.tried = false;
    this.shown = false;
    this.password = '';
  }

  // ------------------------------------------------------------------
  // Forgotten password
  // ------------------------------------------------------------------

  startForgot(): void {
    this.mode = 'forgot';
    this.clearForm();
    this.forgotSent = false;
  }

  async requestReset(): Promise<void> {
    this.tried = true;
    this.error = '';
    if (this.emailProblem) return;

    this.busy = true;
    try {
      const result = await this.auth.forgotPassword(this.email.trim());
      // The same answer whether or not the account exists.
      if (result.ok) this.forgotSent = true;
      else this.error = result.error || 'Could not send a reset link.';
    } finally {
      this.busy = false;
    }
  }

  /** Check a reset link before asking for a new password. */
  private async openReset(): Promise<void> {
    this.mode = 'reset';
    this.checking = true;
    try {
      const result = await this.auth.resetInfo(this.token);
      this.resetValid = result.ok;
      if (result.ok) this.email = result.email ?? '';
      else this.error = result.error ?? '';
    } finally {
      this.checking = false;
    }
  }

  /** Set the new password. It signs nobody in, and every session of the
   *  account ends: the person signs in with it. */
  async setNewPassword(): Promise<void> {
    this.tried = true;
    this.error = '';
    if (this.passwordProblem) return;

    this.busy = true;
    try {
      const result = await this.auth.resetPassword({ token: this.token, password: this.password });
      if (result.ok) {
        this.backToLogin();
        this.notice = 'Your password is changed. Sign in with it.';
        return;
      }
      this.error = result.error || 'Could not set your password.';
    } finally {
      this.busy = false;
    }
  }

  /** Leave a link behind and sign in normally. */
  backToLogin(): void {
    this.clearTokenFromUrl();
    this.token = '';
    this.resetValid = false;
    this.handedPassword = '';
    this.clearForm();
    this.forgotSent = false;
    this.signupSent = false;
    this.mode = 'login';
    // Whether sign-up is offered is the deployment's to say, and a page
    // opened from a link has not asked yet.
    void this.openDoor();
  }

  // ------------------------------------------------------------------
  // Invitation
  // ------------------------------------------------------------------

  /**
   * Resolve the link before showing a form, so the screen can name the
   * organization and the invited address instead of asking for details the
   * invitation already carries.
   */
  private async openInvitation(): Promise<void> {
    this.mode = 'invitation';
    this.checking = true;
    try {
      const result = await this.auth.invitation(this.token);
      this.inviteValid = result.ok;
      if (result.ok) {
        this.email = result.email ?? '';
        this.orgName = result.organization ?? '';
      } else {
        this.error = result.error ?? '';
      }
    } finally {
      this.checking = false;
    }
  }

  async acceptInvitation(): Promise<void> {
    this.tried = true;
    this.error = '';
    if (!this.name.trim() || this.passwordProblem) return;

    this.busy = true;
    try {
      const result = await this.auth.acceptInvitation({
        token: this.token,
        name: this.name.trim(),
        password: this.password,
      });
      if (result.ok) {
        this.enterApp();
        return;
      }
      this.error = result.error || 'Could not accept this invitation.';
    } finally {
      this.busy = false;
    }
  }

  /**
   * Leave the invitation behind.
   *
   * Whoever is already signed in on this browser goes back to the app;
   * everyone else gets the sign-in form.
   */
  async dismissInvitation(): Promise<void> {
    this.inviteValid = false;
    this.name = '';
    this.email = '';
    if (await this.auth.refresh()) {
      this.enterApp();
      return;
    }
    this.backToLogin();
  }

  /** Drop a link's token from the address bar: it is a live credential
   *  and must not linger in history or a referrer header. A link's own
   *  path goes with it, back to the app's base. */
  private clearTokenFromUrl(): void {
    window.history?.replaceState?.({}, '', arrivalLink() ? appBase() : window.location.pathname);
  }

  // ------------------------------------------------------------------
  // Presentation helpers
  // ------------------------------------------------------------------

  /** What the email box still needs; '' when it reads as an address. */
  get emailProblem(): string {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(this.email.trim()) ? '' : 'Enter a valid email address.';
  }

  /** The rule a chosen password is held to, each part with whether
   *  what is typed meets it: the server checks the same. */
  get passwordRule(): { words: string; met: boolean }[] {
    return [
      { words: '10 to 256 characters', met: this.password.length >= 10 && this.password.length <= 256 },
      { words: 'No space at either end', met: !!this.password && this.password.trim() === this.password },
    ];
  }

  get passwordProblem(): string {
    if (!this.password) return 'Choose a password.';
    return this.passwordRule.every((part) => part.met) ? '' : 'It does not meet the rule below yet.';
  }

  get title(): string {
    switch (this.mode) {
      case 'opening':
        return 'Opening DecentAI…';
      case 'setup':
        return 'Set up DecentAI';
      case 'signup':
        return this.signupSent ? 'Check your email' : 'Create an organization';
      case 'signup-confirm':
        return 'Create your organization';
      case 'invitation':
        if (this.checking) return 'Checking your invitation…';
        return this.inviteValid ? `Join ${this.orgName}` : 'Invitation problem';
      case 'reset':
        if (this.checking) return 'Checking your link…';
        return this.resetValid ? 'Choose a new password' : 'Link problem';
      case 'forgot':
        return this.forgotSent ? 'Check your email' : 'Reset your password';
      case 'first':
        return 'Choose your own password';
      default:
        return 'Sign in';
    }
  }

  get subtitle(): string {
    switch (this.mode) {
      case 'opening':
        return '';
      case 'setup':
        return 'Nobody is in this DecentAI yet. Name your organization and '
          + 'choose how you sign in: you will be its administrator.';
      case 'signup':
        return this.signupSent
          ? `If ${this.email.trim()} can take one, a link is on its way to it. Follow it within an hour.`
          : 'Your own organization, with you as its administrator. We will '
            + 'email you a link to confirm the address first.';
      case 'signup-confirm':
        return 'Make the organization you asked for, with you as its administrator.';
      case 'invitation':
        if (this.checking) return '';
        return this.inviteValid
          ? `Set a password for ${this.email}`
          : this.error || 'Ask whoever invited you to send a new link.';
      case 'reset':
        if (this.checking) return '';
        return this.resetValid ? `For ${this.email}` : this.error || 'Ask for a new link and try again.';
      case 'forgot':
        return this.forgotSent
          ? `If an account has ${this.email.trim()}, a link to reset its password is on its way. It lasts an hour.`
          : 'We will email you a link to set a new one.';
      case 'first':
        return `The one you signed in with was given to you. Replace it with one only you know, for ${this.email}.`;
      default:
        return 'Enter your email and password.';
    }
  }

  // ------------------------------------------------------------------

  private enterApp(): void {
    this.datastore.setview('app');
    this.navigator.navigateToInitialRoute();

    // Strip the token AFTER navigating, not before: the router re-serialises
    // its own URL tree, which still carries the query, so clearing it first
    // just gets it written back. A used link's token must not be left in
    // the address bar, browser history, or the next referrer header.
    setTimeout(() => this.clearTokenFromUrl(), 0);
  }
}
