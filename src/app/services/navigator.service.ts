import { Injectable } from '@angular/core';
import { routerPath } from './auth.util';
import { NavigationEnd, Router } from '@angular/router';
import { filter } from 'rxjs/operators';

import { AuthService } from './auth.service';
import { AiSessionService } from './ai-session.service';
import { AttentionService } from './attention.service';
import { DataStoreService } from './datastore.service';
import { mainRoutes, adminRoutes, pageAllowed } from '../website/config/config';
import { ActiveRoute } from '../website/config/config.model';

const DEFAULT_ROUTE = 'ai/chats';
const CURRENT_URL_KEY = 'currentUrl';

@Injectable({
  providedIn: 'root',
})
export class NavigatorService {
  currentRoute: ActiveRoute = {
    primary: 'ai',
    secondary: 'ai/chats',
    tertiary: '',
  };

  /** Top-level segments we recognise as valid landing destinations:
   *  each section's, and each page's own (Monitoring and Audit sit in
   *  the Organization section and live at /monitoring and /audit). */
  private readonly knownPrimaries = new Set(
    [...mainRoutes, ...adminRoutes].flatMap((section) => [
      section.url,
      ...(section.children ?? []).map((page) => page.url.split('/')[0]),
    ]),
  );

  /** The address the person arrived at, kept until the app opens. The
   *  router rewrites the address bar before then: the root redirects to
   *  the chats, and a guard sends someone not yet signed in elsewhere.
   *  Its query is kept, since a page's filters and search are in it; its
   *  fragment is not, since a sign-in link carries its token there. The
   *  path is the router's: under the app's base, wherever it is served. */
  private arrival: string | null = routerPath(window.location.pathname) + window.location.search;

  /** Whether the app has opened on its first page. The last-visited page
   *  is only recorded from then on, so nothing the router did before
   *  sign-in is taken for a page the person chose. */
  private settled = false;

  constructor(
    private router: Router,
    public auth: AuthService,
    public datastore: DataStoreService,
    private attention: AttentionService,
    private aiSession: AiSessionService,
  ) {
    // The router URL is the single source of truth for the active route, so
    // the sidebar highlights correctly even after a refresh or deep link.
    this.router.events
      .pipe(filter((event) => event instanceof NavigationEnd))
      .subscribe((event: NavigationEnd) => {
        this.syncRouteFromUrl(event.urlAfterRedirects);
        this.rememberPage(event.urlAfterRedirects);
      });
  }

  getCurrentRoute(): ActiveRoute {
    return this.currentRoute;
  }

  /**
   * Open the app on its first page: the address the person arrived at
   * (a link from a notification, a bookmark), else the last page they
   * visited, else the default. Asked for by the sign-in screen and by
   * the shell; whichever comes second finds it already done.
   */
  navigateToInitialRoute(): void {
    if (this.settled) {
      return;
    }
    this.settled = true;

    const arrival = this.arrival;
    this.arrival = null;
    const stored = localStorage.getItem(CURRENT_URL_KEY);
    const target =
      [arrival, stored].find((url) => !!url && this.isKnownUrl(url)) ||
      DEFAULT_ROUTE;
    this.router.navigateByUrl(target);
  }

  /** Record the page for the next visit: the path alone. An invitation
   *  or reset link carries its token in the query, and a token must not
   *  be kept in the browser's storage. */
  private rememberPage(url: string): void {
    if (!this.settled || this.datastore.getview() !== 'app') {
      return;
    }
    localStorage.setItem(CURRENT_URL_KEY, url.split(/[?#]/)[0]);
  }

  private isKnownUrl(url: string): boolean {
    const primary = this.toSegments(url)[0];
    return !!primary && this.knownPrimaries.has(primary);
  }

  private toSegments(url: string): string[] {
    return url
      .split(/[?#]/)[0]
      .replace(/^\/+/, '')
      .split('/')
      .filter(Boolean);
  }

  /** Derive primary/secondary/tertiary from a concrete router URL. */
  private syncRouteFromUrl(url: string): void {
    const segments = this.toSegments(url);
    if (segments.length === 0) {
      return;
    }

    this.currentRoute = {
      primary: segments[0],
      secondary: segments.length >= 2 ? segments.slice(0, 2).join('/') : '',
      tertiary: segments.length >= 3 ? segments.slice(0, 3).join('/') : '',
    };

    // The breadcrumb follows the URL just like the sidebar highlight does —
    // back/forward, deep links, and workspace switches all keep it honest.
    const title = this.titleForSegments(segments);
    if (title) {
      this.datastore.changePageTitle(title);
    }

    // Keep the workspace (main vs. admin) aligned with the active URL.
    const shouldBeAdmin = segments[0] === 'admin';
    const isAdmin = this.datastore.getCurrentContentView() === 'admin';
    if (shouldBeAdmin !== isAdmin) {
      this.datastore.changecurrentContentView();
    }
  }

  /** The configured title of the deepest route node matching this URL. */
  private titleForSegments(segments: string[]): string {
    const candidates = [
      segments.slice(0, 3).join('/'),
      segments.slice(0, 2).join('/'),
      segments[0],
    ];
    for (const section of [...mainRoutes, ...adminRoutes]) {
      for (const page of section.children ?? []) {
        for (const leaf of page.children ?? []) {
          if (candidates.includes(leaf.url)) {
            return leaf.title || leaf.name;
          }
        }
        if (candidates.includes(page.url)) {
          return page.title || page.name;
        }
      }
    }
    return '';
  }

  /**
   * Ask the API server who this session is, without trying to become anyone.
   *
   * Reports the two failures the shell must not confuse: a session that is
   * gone (401), and a server that is not answering at all. Signing in is
   * a reasonable thing to offer for the first and useless for the second.
   */
  async checkStatus(): Promise<'signed-in' | 'signed-out' | 'unreachable'> {
    const { status } = await this.auth.me();
    if (status === 200) return 'signed-in';
    return status === 401 ? 'signed-out' : 'unreachable';
  }

  async logout() {
    try {
      // Ends the session server-side and drops the token here.
      await this.auth.logout();
      return true;
    } catch (error) {
      console.error('Logout request errored', error);
      return false;
    } finally {
      // Always clear locally and show the signed-out view, even if the
      // server call failed — we never surface an error dialog on sign-out.
      this.attention.stop();
      this.forgetPerson();
      this.settled = false;
      this.datastore.clear();
    }
  }

  /** What the browser kept about the person who is leaving — where they
   *  were, and their chat list — must not greet whoever signs in next
   *  on the same tab, nor anyone at another engine. */
  forgetPerson(): void {
    this.aiSession.forgetChats();
    try {
      localStorage.removeItem(CURRENT_URL_KEY);
      localStorage.removeItem('pageTitle');
    } catch {
      // Storage that cannot be reached holds nothing to forget.
    }
  }

  private performRouting(): void {
    const target =
      this.currentRoute.tertiary ||
      this.currentRoute.secondary ||
      this.currentRoute.primary;

    if (target) {
      this.router.navigateByUrl(target);
    }
  }

  changecurrentContentView(): void {
    if (this.datastore.getCurrentContentView() === 'admin') {
      this.currentRoute = {
        primary: 'admin',
        secondary: this.firstAdminPageUrl(),
        tertiary: '',
      };
    } else {
      this.currentRoute = {
        primary: 'ai',
        secondary: 'ai/chats',
        tertiary: '',
      };
    }
    this.performRouting();
  }

  /**
   * Where entering the admin console lands: the first page the person's
   * policy actually grants, never one that would only answer 403.
   */
  private firstAdminPageUrl(): string {
    for (const section of adminRoutes) {
      for (const child of section.children ?? []) {
        if (child.active && pageAllowed(child, (action) => this.auth.can(action))) {
          return child.url;
        }
      }
    }
    return 'admin/users';
  }
}
