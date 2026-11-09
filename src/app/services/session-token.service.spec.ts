import { EngineService } from './engine.service';
import { SessionTokenService } from './session-token.service';

describe('SessionTokenService', () => {
  const KEY = SessionTokenService.STORAGE_KEY;
  let engine: EngineService;
  const made = () => new SessionTokenService(engine);

  beforeEach(() => {
    engine = { url: 'https://a.example' } as EngineService;
    localStorage.removeItem(KEY);
    sessionStorage.removeItem(KEY);
  });

  afterEach(() => {
    localStorage.removeItem(KEY);
    sessionStorage.removeItem(KEY);
  });

  it('holds nothing until a sign-in, and then the header every request carries', () => {
    const session = made();
    expect(session.token).toBeNull();
    expect(session.present).toBeFalse();
    expect(session.headers()).toEqual({});
    expect(session.wsProtocols()).toEqual([]);

    session.keep('tok.en', false);
    expect(session.token).toBe('tok.en');
    expect(session.headers()).toEqual({ Authorization: 'Bearer tok.en' });
    expect(session.wsProtocols()).toEqual([SessionTokenService.WS_PROTOCOL, 'tok.en']);
  });

  it('keeps a remembered sign-in past the tab, and one not remembered with it', () => {
    const session = made();
    session.keep('kept', true);
    expect(JSON.parse(localStorage.getItem(KEY)!)).toEqual({ engine: 'https://a.example', token: 'kept' });
    expect(sessionStorage.getItem(KEY)).toBeNull();

    session.keep('tab', false);
    expect(JSON.parse(sessionStorage.getItem(KEY)!)).toEqual({ engine: 'https://a.example', token: 'tab' });
    expect(localStorage.getItem(KEY)).toBeNull();
  });

  it('is read back from either store by a fresh instance', () => {
    localStorage.setItem(KEY, JSON.stringify({ engine: 'https://a.example', token: 'from-before' }));
    expect(made().token).toBe('from-before');
    localStorage.removeItem(KEY);
    sessionStorage.setItem(KEY, JSON.stringify({ engine: 'https://a.example', token: 'this-tab' }));
    expect(made().token).toBe('this-tab');
  });

  it('clears both stores on sign-out', () => {
    const session = made();
    session.keep('kept', true);
    session.clear();
    expect(session.token).toBeNull();
    expect(localStorage.getItem(KEY)).toBeNull();
    expect(sessionStorage.getItem(KEY)).toBeNull();
  });

  it('is a token only at the engine that issued it, and is dropped elsewhere', () => {
    const session = made();
    session.keep('for.a', true);
    expect(session.token).toBe('for.a');

    engine.url = 'https://b.example';
    expect(session.token).toBeNull();
    expect(session.headers()).toEqual({});
    expect(session.wsProtocols()).toEqual([]);
    expect(localStorage.getItem(KEY)).toBeNull();

    engine.url = 'https://a.example';
    expect(made().token).toBeNull();
  });

  it('is read back only for the engine named beside it', () => {
    localStorage.setItem(KEY, JSON.stringify({ engine: 'https://b.example', token: 'for.b' }));
    expect(made().token).toBeNull();
    expect(localStorage.getItem(KEY)).toBeNull();

    localStorage.setItem(KEY, JSON.stringify({ engine: 'https://a.example', token: 'for.a' }));
    expect(made().token).toBe('for.a');
  });

  it('takes a bare token, kept before tokens named their engine, as no session', () => {
    localStorage.setItem(KEY, 'bare.token');
    expect(made().token).toBeNull();
  });
});
