/**
 * The app's own address, wherever it is served: at a host's root
 * (`https://ai.example.com/`) or under a path
 * (`https://example.com/decentai/`, built with `--base-href /decentai/`).
 * The page's `<base href>` is the one word on it; nothing here assumes
 * the root.
 */
export function appBase(base: string = document.baseURI): string {
  return new URL('./', base).toString();
}

/**
 * Where to send someone who needs to (re)authenticate.
 *
 * The root component resolves the session on boot and shows the sign-in
 * screen when there isn't one, so "go authenticate" is simply "reload the
 * app" — at its own base, which is the host's root only where the app is
 * served there.
 */
export function loginUrl(base: string = document.baseURI): string {
  return appBase(base);
}

/**
 * An address bar's path as the router knows it: the part under the
 * app's base, from `/`. `/decentai/ai/chats` under `/decentai/` is
 * `/ai/chats`; a path outside the base is given back as it is.
 */
export function routerPath(pathname: string, base: string = document.baseURI): string {
  const root = new URL('./', base).pathname;
  return pathname.startsWith(root) ? `/${pathname.slice(root.length)}` : pathname;
}

/** A link the API server sent the person here by. */
export interface ArrivalLink {
  kind: 'invitation' | 'reset' | 'signup' | 'oauth';
  /** The link's token; for a provider's return, its state. */
  token: string;
  /** A provider's return that failed. */
  failed?: boolean;
}

/**
 * The link this page was opened by, if any: a mailed invitation, reset
 * or sign-up (`/invitation?token=…`, `/reset?token=…`, `/signup?token=…`),
 * or a provider's return after connecting an account (`/oauth/done?state=…`,
 * or `?failed=1`).
 */
export function arrivalLink(
  location: { pathname: string; search: string } = window.location,
  base: string = document.baseURI,
): ArrivalLink | null {
  const path = routerPath(location.pathname, base).replace(/\/+$/, '');
  const params = new URLSearchParams(location.search);
  if (path === '/oauth/done') {
    return { kind: 'oauth', token: params.get('state') || '', failed: params.has('failed') };
  }
  const kind = ({ '/invitation': 'invitation', '/reset': 'reset', '/signup': 'signup' } as const)[path];
  const token = params.get('token') || '';
  return kind && token ? { kind, token } : null;
}
