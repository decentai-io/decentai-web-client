import { appBase, arrivalLink, loginUrl, routerPath } from './auth.util';

describe('the app under a path of its own', () => {
  const root = 'https://ai.example.com/';
  const under = 'https://example.com/decentai/';

  it('signs in again at its own base, not the host root', () => {
    expect(loginUrl(root)).toBe('https://ai.example.com/');
    expect(loginUrl(under)).toBe('https://example.com/decentai/');
    expect(appBase('https://example.com/decentai/index.html')).toBe('https://example.com/decentai/');
  });

  it('gives the router the path under its base', () => {
    expect(routerPath('/ai/chats/c1', root)).toBe('/ai/chats/c1');
    expect(routerPath('/decentai/ai/chats/c1', under)).toBe('/ai/chats/c1');
    expect(routerPath('/decentai/', under)).toBe('/');
    expect(routerPath('/elsewhere/x', under)).toBe('/elsewhere/x');
  });
});

describe('the link a page was opened by', () => {
  const under = 'https://example.com/decentai/';
  const at = (pathname: string, search = '') => ({ pathname, search });

  it('reads a mailed link under the app base', () => {
    expect(arrivalLink(at('/decentai/invitation', '?token=t1'), under)).toEqual({ kind: 'invitation', token: 't1' });
    expect(arrivalLink(at('/decentai/reset', '?token=t2'), under)).toEqual({ kind: 'reset', token: 't2' });
    expect(arrivalLink(at('/decentai/signup', '?token=t3'), under)).toEqual({ kind: 'signup', token: 't3' });
    expect(arrivalLink(at('/decentai/reset'), under)).toBeNull();
    expect(arrivalLink(at('/decentai/ai/chats', '?token=t4'), under)).toBeNull();
  });

  it('reads a provider\'s return, and one that failed', () => {
    expect(arrivalLink(at('/decentai/oauth/done', '?state=s1'), under)).toEqual({ kind: 'oauth', token: 's1', failed: false });
    expect(arrivalLink(at('/decentai/oauth/done', '?failed=1'), under)).toEqual({ kind: 'oauth', token: '', failed: true });
  });
});
