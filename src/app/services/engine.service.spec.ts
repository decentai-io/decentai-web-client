import { EngineService } from './engine.service';

describe('EngineService', () => {
  let kept: string | null;

  beforeEach(() => {
    kept = localStorage.getItem(EngineService.STORAGE_KEY);
    localStorage.removeItem(EngineService.STORAGE_KEY);
  });

  afterEach(() => {
    if (kept === null) localStorage.removeItem(EngineService.STORAGE_KEY);
    else localStorage.setItem(EngineService.STORAGE_KEY, kept);
  });

  describe('an address as a person types it', () => {
    it('is https unless said, and http on this computer', () => {
      expect(EngineService.normalize('decentai.example.com')).toBe('https://decentai.example.com');
      expect(EngineService.normalize('http://decentai.example.com/')).toBe('http://decentai.example.com');
      expect(EngineService.normalize('localhost:4280')).toBe('http://localhost:4280');
      expect(EngineService.normalize('127.0.0.1:4280/')).toBe('http://127.0.0.1:4280');
      expect(EngineService.normalize('  https://a.example/engine// ')).toBe('https://a.example/engine');
      expect(EngineService.normalize('')).toBe('');
    });
  });

  describe('resolving', () => {
    it('takes what the person chose over the deployment and the page', async () => {
      localStorage.setItem(EngineService.STORAGE_KEY, 'https://chosen.example');
      const engine = new EngineService();
      await engine.load();
      expect(engine.url).toBe('https://chosen.example');
      expect(engine.source).toBe('chosen');
      expect(engine.configured).toBeTrue();
      expect(EngineService.origin).toBe('https://chosen.example');
    });

    it('falls back to the page itself, which is not a configured engine', async () => {
      spyOn(window, 'fetch').and.resolveTo(new Response('not json', { status: 200 }));
      const engine = new EngineService();
      await engine.load();
      expect(engine.url).toBe(window.location.origin);
      expect(engine.source).toBe('origin');
      expect(engine.configured).toBeFalse();
    });

    it('reads the deployment\'s word from assets/config.json', async () => {
      spyOn(window, 'fetch').and.resolveTo(
        new Response(JSON.stringify({ engine: 'https://deployed.example/' }), {
          status: 200, headers: { 'Content-Type': 'application/json' },
        }));
      const engine = new EngineService();
      await engine.load();
      expect(engine.url).toBe('https://deployed.example');
      expect(engine.source).toBe('config');
      expect(engine.configured).toBeTrue();
    });

    it('keeps a choice for the next load, and forgets it when told', async () => {
      const engine = new EngineService();
      engine.choose('engine.example');
      expect(localStorage.getItem(EngineService.STORAGE_KEY)).toBe('https://engine.example');
      expect(engine.url).toBe('https://engine.example');
      engine.forget();
      expect(localStorage.getItem(EngineService.STORAGE_KEY)).toBeNull();
    });
  });

  describe('addresses under the engine', () => {
    it('builds http and ws addresses, and knows its own origin', () => {
      const engine = new EngineService();
      engine.choose('https://engine.example:8443/api');
      expect(engine.http('auth/me')).toBe('https://engine.example:8443/api/auth/me');
      expect(engine.http('/hooks/w1')).toBe('https://engine.example:8443/api/hooks/w1');
      expect(engine.ws('chats/c1')).toBe('wss://engine.example:8443/api/chats/c1');
      expect(engine.origin).toBe('https://engine.example:8443');
      expect(engine.label).toBe('engine.example:8443/api');
      expect(engine.isOwn('https://engine.example:8443/download/f')).toBeTrue();
      expect(engine.isOwn('https://elsewhere.example/download/f')).toBeFalse();
      engine.choose('http://localhost:4280');
      expect(engine.ws('chats/c1')).toBe('ws://localhost:4280/chats/c1');
      expect(engine.label).toBe('localhost:4280');
    });
  });

  describe('asking whether an engine answers', () => {
    it('knows an engine by what Auth:Join:status says', async () => {
      const fetched = spyOn(window, 'fetch').and.resolveTo(
        new Response(JSON.stringify({ set_up: true, mail: false, signup: false }), { status: 200 }));
      expect(await EngineService.probe('engine.example')).toBe('engine');
      expect(String(fetched.calls.mostRecent().args[0])).toBe('https://engine.example/app');
      expect(JSON.parse(String(fetched.calls.mostRecent().args[1]?.body)).endpoint).toBe('Auth:Join:status');
    });

    it('tells a page server from an engine, and nothing from either', async () => {
      const fetched = spyOn(window, 'fetch');
      fetched.and.resolveTo(new Response('<!doctype html>', { status: 200 }));
      expect(await EngineService.probe('https://pages.example')).toBe('not-engine');
      fetched.and.resolveTo(new Response('', { status: 404 }));
      expect(await EngineService.probe('https://pages.example')).toBe('not-engine');
      fetched.and.rejectWith(new TypeError('Failed to fetch'));
      expect(await EngineService.probe('https://nowhere.example')).toBe('unreachable');
      expect(await EngineService.probe('')).toBe('not-engine');
    });
  });
});
