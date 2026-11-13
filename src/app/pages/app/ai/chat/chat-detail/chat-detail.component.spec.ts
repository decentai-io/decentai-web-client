import { Card, ChatEvent, DEFAULT_CHAT_SETTINGS } from 'src/app/models/chat-protocol';
import { ChatStateService } from 'src/app/services/chat-state.service';
import { TopBarService } from 'src/app/services/top-bar.service';
import { ChatDetailComponent } from './chat-detail.component';

describe('ChatDetailComponent', () => {
  const card: Card = {
    card_id: 'd1', chat_id: 'c1', call: 'k1', agent: 'mail', status: 'open', at: '',
    kind: 'question', request: { text: 'Which file?', expects: 'file' },
  };

  function componentWith(session: Record<string, any> = {}, files: Record<string, any> = {}) {
    const state = new ChatStateService();
    // The watch on chats left working: what the page tells it.
    const chatDone = jasmine.createSpyObj('ChatDoneService', ['began', 'working', 'idle', 'opened', 'closed']);
    const component = new ChatDetailComponent(
      session as any,
      {} as any, {} as any, {} as any, {} as any,
      // The socket: nothing is sent over it here.
      { send: () => true } as any,
      state,
      {} as any,
      // The voice: nothing here is said aloud.
      { arrived: jasmine.createSpy('arrived'), stop: () => {}, refresh: async () => false } as any,
      new TopBarService(),
      {} as any, { can: () => false } as any, {} as any,
      // The person's files, read when a message names one.
      { get: async () => null } as any,
      files as any,
      {} as any, {} as any, {} as any,
      chatDone,
    );
    component.chat_id = 'c1';
    state.state$.subscribe((value) => {
      component.cards = value.cards;
      component.turns = value.turns;
      component.saying = value.saying;
      component.working = value.working;
      component.inlineErrors = value.errors;
    });
    return { component, state, chatDone };
  }

  function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((done) => (resolve = done));
    return { promise, resolve };
  }

  it('answers a card once, and lets it go when the answer is kept', async () => {
    const answered = deferred<{ data: object }>();
    const decide = jasmine.createSpy('decide').and.returnValue(answered.promise);
    const { component, state } = componentWith({ decide });
    state.addCard({ ...card, kind: 'memory', request: { text: 'Likes tea' } });

    const first = component.onDecision({ card_id: 'd1', answer: { save: true } });
    const again = component.onDecision({ card_id: 'd1', answer: { save: true } });
    expect(decide).toHaveBeenCalledOnceWith('d1', { save: true });
    expect(component.answering.has('d1')).toBeTrue();

    answered.resolve({ data: {} });
    await Promise.all([first, again]);
    expect(component.cards).toEqual([]);
    expect(component.answering.has('d1')).toBeFalse();
  });

  it('uploads a file question\'s file first, and answers with its record', async () => {
    const decide = jasmine.createSpy('decide').and.resolveTo({ data: {} });
    const upload = jasmine.createSpy('upload').and.returnValue({ done: Promise.resolve({ record: { record_id: 'f9' } }) });
    const { component, state } = componentWith({ decide }, { upload });
    state.addCard(card);

    await component.onDecision({ card_id: 'd1', file: new File(['x'], 'a.txt') });
    expect(decide).toHaveBeenCalledOnceWith('d1', { file: 'f9' });
  });

  it('keeps a card whose answer was refused, and says why', async () => {
    const decide = jasmine.createSpy('decide').and.resolveTo({ error: 'Try again.', code: 'failed' });
    const { component, state } = componentWith({ decide });
    state.addCard(card);

    await component.onDecision({ card_id: 'd1', answer: { text: 'this one' } });
    expect(component.cards.length).toBe(1);
    expect(component.inlineErrors[0].message).toBe('Try again.');
  });

  it('stops one call alone, and says why when it could not', async () => {
    const stop = jasmine.createSpy('stop').and.resolveTo({ error: 'No such chat of yours.' });
    const { component } = componentWith({ stop });

    const stopping = component.stopWork('w7');
    expect(component.stoppingWork).toEqual(['w7']);
    await stopping;

    expect(stop).toHaveBeenCalledWith('c1', 'w7');
    expect(component.stoppingWork).toEqual([]);
    expect(component.inlineErrors[0].message).toBe('No such chat of yours.');
  });

  it('takes each event once, in order, and shows what is being written until the answer lands', () => {
    // Read again, the chat is still on its way when the test ends.
    const openChat = jasmine.createSpy('openChat').and.returnValue(new Promise(() => undefined));
    const { component, state } = componentWith({ openChat });
    state.load({
      chat: { chat_id: 'c1', title: '', preview: '', settings: {} as any, archived: false, working: false, held: true,
              webhook: '', created_at: '', updated_at: '' },
      messages: [], cards: [], events: 0, socket: '',
    });
    const on = (event: ChatEvent) => (component as any).onEvent(event);
    on({ seq: 1, at: '', event: 'working', data: {} });
    // Words being written carry the last kept number; a kept event
    // replayed is not taken again.
    on({ seq: 1, at: '', event: 'saying', data: { text: 'Hel' } });
    on({ seq: 1, at: '', event: 'working', data: {} });
    on({ seq: 1, at: '', event: 'saying', data: { text: 'lo' } });
    expect(component.saying).toBe('Hello');

    on({ seq: 2, at: '', event: 'message', data: { message_id: 'm1', seq: 1, actor: 'assistant',
      parts: [{ type: 'text', text: 'Hello' }], files: [], client_id: '', at: '' } });
    on({ seq: 3, at: '', event: 'idle', data: {} });
    expect(component.saying).toBe('');
    expect(component.working).toBeFalse();
    expect(component.turns[0].assistantMessages.length).toBe(1);
    expect(openChat).not.toHaveBeenCalled();

    // Events were missed: the chat is read again, and the event is not taken.
    on({ seq: 9, at: '', event: 'working', data: {} });
    expect(openChat).toHaveBeenCalledTimes(1);
    expect(component.working).toBeFalse();
  });

  it('gives the words back when a message could not be sent', async () => {
    jasmine.clock().install();
    try {
      const input = jasmine.createSpy('input').and.resolveTo({ error: 'The chat is gone.' });
      const { component } = componentWith({ input });
      await component.onPrompt({ query: 'hello', uploads: [] });
      jasmine.clock().tick(1);
      expect(input).toHaveBeenCalledWith('c1', 'hello', [], jasmine.any(String));
      expect(component.turns).toEqual([]);
      expect(component.composerDraft).toBe('hello');
      expect(component.inlineErrors[0].message).toBe('The chat is gone.');
    } finally {
      jasmine.clock().uninstall();
    }
  });

  describe('the live browser', () => {
    const frame = (call: string): ChatEvent => ({ seq: 0, at: '', event: 'screen',
      data: { agent: 'browser', call, screen: { image: 'iVBORw0', width: 1280, height: 800, tabs: [] } } });

    function browsing(call: jasmine.Spy) {
      const made = componentWith({ call });
      (made.component as any).agents = [{ agent_id: 'browser', name: 'Browser' }, { agent_id: 'mail', name: 'Mail' }];
      return made;
    }

    it('opens the browser agent\'s browser when no screen shows, and shows it with its first picture', async () => {
      const call = jasmine.createSpy('call').and.resolveTo({ data: {} });
      const { component } = browsing(call);
      expect(component.canBrowse).toBeTrue();
      expect(component.liveViewLabel).toBe('Open the live browser');

      await component.toggleLiveView();
      expect(call).toHaveBeenCalledOnceWith('c1', 'browser', 'browse_watch', { action: 'open' });
      expect(component.screenOpening).toBeTrue();
      expect(component.liveViewLabel).toBe('Opening the browser…');

      (component as any).onEvent(frame('k9'));
      expect(component.screenOpening).toBeFalse();
      expect(component.screen?.call).toBe('k9');
      expect(component.screenHidden).toBeFalse();

      // With a screen, the same control hides it and shows it again, asking nothing.
      await component.toggleLiveView();
      expect(component.screenHidden).toBeTrue();
      await component.toggleLiveView();
      expect(component.screenHidden).toBeFalse();
      expect(call).toHaveBeenCalledTimes(1);
    });

    it('says quietly why the browser could not be opened', async () => {
      const call = jasmine.createSpy('call').and.resolveTo({ error: 'That agent is not one this chat may use.' });
      const { component } = browsing(call);
      await component.toggleLiveView();
      expect(component.screenOpening).toBeFalse();
      expect(component.inlineErrors[0].message).toContain('That agent is not one this chat may use.');
    });

    it('is not offered where the chat cannot use the browser agent', () => {
      const { component } = browsing(jasmine.createSpy('call'));
      component.chat = { settings: { ...DEFAULT_CHAT_SETTINGS, agents: ['mail'] } } as any;
      expect(component.canBrowse).toBeFalse();
    });
  });

  it('opens the inspector on the chat\'s schedules from the clock, and closes it from there', () => {
    const { component } = componentWith();
    component.togglePanel('schedules');
    expect([component.panelOpen, component.panelTab]).toEqual([true, 'schedules']);
    component.togglePanel('schedules');
    expect(component.panelOpen).toBeFalse();
  });

  it('tells the watch on chats left working when the person sets this one going, and when it goes quiet', async () => {
    const input = jasmine.createSpy('input').and.resolveTo({ data: { message: { message_id: 'm1', seq: 1,
      actor: 'person', parts: [], files: [], client_id: '', at: '' } } });
    const { component, chatDone } = componentWith({ input });
    await component.onPrompt({ query: 'plan the trip', uploads: [] });
    expect(chatDone.began).toHaveBeenCalledWith('c1', '', false);

    (component as any).onEvent({ seq: 1, at: '', event: 'working', data: {} });
    (component as any).onEvent({ seq: 2, at: '', event: 'idle', data: {} });
    expect(chatDone.working).toHaveBeenCalledWith('c1');
    expect(chatDone.idle).toHaveBeenCalledWith('c1', '');
  });
});
