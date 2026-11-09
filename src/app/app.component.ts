import { Component, OnDestroy, OnInit } from '@angular/core';
import { DataStoreService } from './services/datastore.service';
import { NavigatorService } from './services/navigator.service';
import { Subscription } from 'rxjs';
import { AppView } from './website/config/config.model';
import { AiSessionService } from './services/ai-session.service';
import { AuthService } from './services/auth.service';
import { arrivalLink } from './services/auth.util';
import { EngineService } from './services/engine.service';
import { SessionTokenService } from './services/session-token.service';
import { ThemeService } from './services/theme.service';

@Component({
  selector: 'app-root',
  templateUrl: './app.component.html',
  styleUrls: ['./app.component.css'],
  standalone: false,
})
export class AppComponent implements OnInit, OnDestroy {
  private subscriptions = new Subscription();

  view: AppView = 'loading';
  /** The API server has not answered for a while: the loading card says so. */
  unreachable = false;
  /** Which run of asking is the current one: "Try now" starts another. */
  private round = 0;
  /** The Connect screen was opened from the sign-in, to change the
   *  engine, rather than because none was named. */
  changingEngine = false;

  constructor(
    public datastore: DataStoreService,
    public navigator: NavigatorService,
    private auth: AuthService,
    private engine: EngineService,
    private session: SessionTokenService,
    private theme: ThemeService, // instantiating applies the saved theme
    private aiSession: AiSessionService,
  ) {}

  ngOnInit(): void {
    this.subscriptions.add(
      this.datastore.view$.subscribe((view) => {
        this.view = view;
      }),
    );

    // An invitation or reset link wins over an existing session. Someone
    // already signed in as one person may well be opening a link addressed to
    // another (a shared machine, or a second organization) — showing them the
    // app instead would swallow the link silently. It matters even more for a
    // reset: the usual reason to follow one is that the session in this
    // browser is not the account you are trying to recover. A sign-up
    // link makes a new organization and signs its administrator in, so
    // it wins for the same reason.
    const link = arrivalLink();
    if (link?.kind === 'oauth' && window.opener) {
      // A provider sent the sign-in window back: it tells the page that
      // opened it, which finishes the connection under its own session,
      // and closes.
      window.opener.postMessage({ type: 'decentai:oauth', state: link.token, failed: link.failed },
        window.location.origin);
      window.close();
      return;
    }
    const fromLink = !!link && link.kind !== 'oauth';

    // Which engine comes before who is signed in to it. EngineService
    // resolved the address before the app started; where neither the
    // person nor the deployment named one, the page's own origin is
    // asked whether an engine answers there (a one-origin install), and
    // the Connect screen is shown when none does.
    void this.resolveEngine().then((found) => {
      if (!found) {
        this.changingEngine = false;
        this.datastore.setview('connect');
        return;
      }
      if (fromLink) {
        this.datastore.setview('auth');
        return;
      }
      // Otherwise resolve the session before showing anything. Without one the
      // sign-in screen takes over the whole shell — there is no sidebar or
      // content to render for someone we cannot identify.
      void this.resolveSession();
    });
  }

  /** Whether an engine is known: named, or answering at this origin. */
  private async resolveEngine(): Promise<boolean> {
    if (this.engine.configured) return true;
    return (await EngineService.probe(this.engine.url)) === 'engine';
  }

  /** The Connect screen found an engine at an address. A session from
   *  another engine is no session there: it is ended where it was
   *  issued, with its own token, before the new address is kept — never
   *  sent to the new one. */
  engineChosen(address: string): void {
    this.round += 1;
    this.unreachable = false;
    this.datastore.setview('loading');
    const ended = this.session.present
      ? this.auth.logout().catch(() => undefined)
      : Promise.resolve();
    void ended.then(() => {
      // Nothing kept for a person at the old engine — their chat list,
      // the page they were on — greets anyone at the new one.
      this.navigator.forgetPerson();
      this.engine.choose(address);
      return this.resolveSession();
    });
  }

  /** The Connect screen was left as it was: back to the sign-in. */
  engineKept(): void {
    this.datastore.setview('auth');
  }

  /** The sign-in page's way to another engine. */
  changeEngine(): void {
    this.changingEngine = true;
    this.datastore.setview('connect');
  }

  /**
   * Decide what to show: the app, or the sign-in screen.
   *
   * A failed refresh has two very different causes, and /status is what
   * tells them apart. An expired session is the user's problem to solve
   * and the sign-in screen is the right answer. An API server that is not
   * answering is not — offering a sign-in form that cannot possibly
   * succeed invites someone to type a password and blame themselves. So
   * an unreachable API server is waited on (a restart takes seconds): in
   * silence for the first tries, then saying so on the loading card,
   * with a way to try at once.
   */
  private async resolveSession(attempt = 0, round = this.round): Promise<void> {
    if (round !== this.round) return;
    if (await this.readSession()) {
      this.datastore.setview('app');
      return;
    }

    const reachable = await this.navigator.checkStatus();
    // "Try now" started a round of its own while this one was asking.
    if (round !== this.round) return;

    // The probe found the session after all, so the read failed for some
    // other reason and nobody is signed out. The app is no use without the
    // permissions that read carries, though: it is asked for again, and
    // the app opens only once it answers.
    if (reachable === 'signed-in' && (await this.readSession())) {
      this.datastore.setview('app');
      return;
    }

    if (reachable !== 'signed-out') {
      this.unreachable = attempt + 1 >= AppComponent.QUIET_TRIES;
      await new Promise((resolve) =>
        setTimeout(resolve, AppComponent.BOOT_RETRY_MS),
      );
      return this.resolveSession(attempt + 1, round);
    }

    // Signed out: the sign-in screen. The chat list kept on this tab is
    // the last person's, and whoever signs in next is not shown it; the
    // page they were on is kept, for the sign-in to come back to.
    this.aiSession.forgetChats();
    this.datastore.setview('auth');
  }

  /** The loading card's button: ask again now, not in two seconds. */
  tryNow(): void {
    this.round += 1;
    void this.resolveSession(AppComponent.QUIET_TRIES);
  }

  private async readSession(): Promise<boolean> {
    try {
      return await this.auth.refresh();
    } catch {
      return false;
    }
  }

  /** An API server that is restarting is asked again every two seconds;
   *  after three tries the loading card says what it is waiting for. */
  private static readonly QUIET_TRIES = 3;
  private static readonly BOOT_RETRY_MS = 2000;

  ngOnDestroy(): void {
    this.subscriptions.unsubscribe();
  }
}
