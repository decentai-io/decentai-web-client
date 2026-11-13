import { ChatStateService } from './chat-state.service';
import { Card, ChatMessage, ChatSnapshot, DEFAULT_CHAT_SETTINGS } from 'src/app/models/chat-protocol';

describe('ChatStateService', () => {
  const message = (seq: number, actor: ChatMessage['actor'], text: string, client_id = '', at = ''): ChatMessage =>
    ({ message_id: `m${seq}`, seq, actor, parts: [{ type: 'text', text }], files: [], client_id, at });
  const card = (id: string): Card =>
    ({ card_id: id, chat_id: 'c1', call: 'k1', agent: 'mail', status: 'open', at: '', kind: 'memory', request: { text: 'x' } });

  function snapshot(more: Partial<ChatSnapshot> = {}): ChatSnapshot {
    return {
      chat: { chat_id: 'c1', title: '', preview: '', settings: DEFAULT_CHAT_SETTINGS, archived: false, working: false,
              held: false, webhook: '', created_at: '', updated_at: '' },
      messages: [], cards: [], events: 4, socket: '/chats/c1', ...more,
    };
  }

  it('loads the chat, and takes no event it has already', () => {
    const state = new ChatStateService();
    state.load(snapshot({ messages: [message(1, 'person', 'hi'), message(2, 'assistant', 'hello')], cards: [card('d1')] }));

    expect(state.value.loading).toBeFalse();
    expect(state.value.turns.length).toBe(1);
    expect(state.value.cards.length).toBe(1);
    const event = (seq: number, name = 'working') => ({ seq, event: name, data: {}, at: '' }) as any;
    expect(state.sequence(event(4))).toBe('skip');
    expect(state.sequence(event(5))).toBe('take');
    expect(state.value.latestEventSeq).toBe(5);
    // Words being written carry the last kept number, and pass; ones from before a kept event taken came late.
    expect(state.sequence(event(5, 'saying'))).toBe('take');
    expect(state.sequence(event(4, 'saying'))).toBe('skip');
    expect(state.value.latestEventSeq).toBe(5);
    expect(state.sequence(event(7))).toBe('gap');
    expect(state.value.latestEventSeq).toBe(5);
  });

  it('puts the words up at once, and the server\'s message takes their place', () => {
    const state = new ChatStateService();
    state.load(snapshot());
    state.startSubmission('k', 'is friday free?', ['f1']);
    expect(state.value.messages[0].message_id).toBe('pending:k');
    expect(state.value.turns[0].key).toBe('k');
    expect(state.value.working).toBeTrue();

    state.work({ id: 'w1', title: 'Looking at the calendar', status: 'running' });
    state.addMessage(message(7, 'person', 'is friday free?', 'k'));
    expect(state.value.messages.map((one) => one.message_id)).toEqual(['m7']);
    // The turn keeps its key, and its work, as its message lands.
    expect(state.value.turns[0].key).toBe('k');
    expect(state.value.turns[0].work.map((entry) => entry.title)).toEqual(['Looking at the calendar']);
  });

  it('takes the words back when the send never got through', () => {
    const state = new ChatStateService();
    state.startSubmission('k', 'is friday free?', []);
    state.dropSubmission('k');
    expect(state.value.messages.length).toBe(0);
    expect(state.value.working).toBeFalse();
  });

  it('shows what is being written until the answer lands, or the assistant goes quiet', () => {
    const state = new ChatStateService();
    state.load(snapshot({ messages: [message(1, 'person', 'hi')] }));
    state.setWorking(true);
    state.addSaying('Hel');
    state.addSaying('lo');
    expect(state.value.saying).toBe('Hello');
    state.addMessage(message(2, 'assistant', 'Hello'));
    expect(state.value.saying).toBe('');

    state.addSaying('More');
    state.setWorking(false);
    expect(state.value.saying).toBe('');
  });

  it('tells a piece of work again in place, with its agent\'s latest line on it', () => {
    const state = new ChatStateService();
    state.load(snapshot({ messages: [message(1, 'person', 'hi')] }));
    state.work({ id: 'w1', title: 'Saving the note', status: 'running' });
    state.progress('w1', 'Opening the notebook');
    state.progress('w1', 'Writing');
    state.progress('gone', 'Nobody hears this');
    state.work({ id: 'w1', title: 'Saving the note', status: 'done' });
    expect(state.value.turns[0].work.map((entry) => [entry.title, entry.status, entry.line])).toEqual([
      ['Saving the note', 'done', 'Writing'],
    ]);
  });

  it('places work in the turn it began in, and a run\'s in a block of its own', () => {
    const state = new ChatStateService();
    state.load(snapshot({ messages: [message(1, 'person', 'first', '', '2026-11-12T10:00:00Z'),
      message(2, 'person', 'second', '', '2026-11-12T10:05:00Z')] }));
    state.work({ id: 'c1', title: 'Early', status: 'done', started: '2026-11-12T10:01:00Z' });
    state.work({ id: 'c2', title: 'Late', status: 'done', started: '2026-11-12T10:06:00Z' });
    const run = { thread: 'r3', origin: 'schedule:s1', title: 'Daily report', message: 0 };
    state.work({ id: 'c4', title: 'Mail · Summarize', status: 'done', started: '2026-11-12T10:03:00Z', run });
    state.addMessage({ ...message(3, 'assistant', 'Two need you.', '', '2026-11-12T10:03:30Z'), run });

    expect(state.value.turns.map((turn) => [turn.key, turn.work.map((entry) => entry.id), turn.assistantMessages.length]))
      .toEqual([['m1', ['c1'], 0], ['run:r3', ['c4'], 1], ['m2', ['c2'], 0]]);
    expect(state.value.turns[1].run?.title).toBe('Daily report');
  });

  it('reads kept events back into work and notes, once each, in time with the turns', () => {
    const state = new ChatStateService();
    state.load(snapshot({ messages: [message(1, 'person', 'hi', '', '2026-11-12T10:00:00Z')] }));
    const events: any[] = [
      { seq: 1, at: '2026-11-12T09:00:00Z', event: 'settings_changed', data: { changes: { trust: 2, model_id: 'opus' } } },
      { seq: 2, at: '2026-11-12T10:00:01Z', event: 'work',
        data: { id: 'c1', title: 'Mail · Send', status: 'running', started: '2026-11-12T10:00:01Z' } },
      { seq: 3, at: '2026-11-12T10:00:02Z', event: 'progress', data: { agent: 'mail', call: 'r1', line: 'Sending', work: 'c1' } },
      { seq: 4, at: '2026-11-12T10:00:03Z', event: 'stopped', data: {} },
    ];
    state.replay(events);
    state.replay(events);

    expect(state.value.notes.map((note) => note.text)).toEqual(['Model: opus · Trust level: Trusted', 'Work stopped']);
    expect(state.value.timeline.map((item) => item.kind)).toEqual(['note', 'turn', 'note']);
    expect(state.value.turns[0].work.map((entry) => entry.line)).toEqual(['Sending']);
  });

  it('says what a thread is doing, until the assistant goes quiet', () => {
    const state = new ChatStateService();
    state.setDoing({ thread: '', kind: 'chat', run: null, what: 'thinking', step: 3, budget: 24, at: '' });
    expect(state.value.doing['']?.what).toBe('thinking');
    state.setWorking(false);
    expect(state.value.doing).toEqual({});
  });

  it('keeps the cards that are open, and none once the chat is stopped', () => {
    const state = new ChatStateService();
    state.addCard(card('d1'));
    state.addCard(card('d1'));
    state.addCard(card('d2'));
    state.closeCard('d1');
    expect(state.value.cards.map((one) => one.card_id)).toEqual(['d2']);

    state.stopped();
    expect(state.value.cards).toEqual([]);
    expect(state.value.working).toBeFalse();
  });

  it('starts a turn with a webhook\'s message, and one with none for what the assistant said first', () => {
    const state = new ChatStateService();
    const run = { thread: 'r4', origin: 'webhook', title: 'New order', message: 2 };
    state.load(snapshot({ messages: [message(1, 'assistant', 'Hello'), message(2, 'webhook', 'New order'),
      { ...message(3, 'assistant', 'Filed it'), run }] }));
    expect(state.value.turns.map((turn) => [turn.userMessage?.actor ?? null, turn.assistantMessages.length]))
      .toEqual([[null, 1], ['webhook', 1]]);
  });

  it('reads the chat again without losing what it holds', () => {
    const state = new ChatStateService();
    state.load(snapshot({ messages: [message(5, 'person', 'hi')] }));
    state.addOlder([message(2, 'person', 'earlier')]);
    state.startSubmission('k', 'still going', []);
    state.load(snapshot({ messages: [message(5, 'person', 'hi'), message(6, 'person', 'still going', 'k')], events: 9 }));
    expect(state.value.messages.map((one) => one.message_id)).toEqual(['m2', 'm5', 'm6']);
    expect(state.value.latestEventSeq).toBe(9);
  });

  it('puts each card answered between the assistant\'s messages, where it closed, as the person\'s turn', () => {
    const state = new ChatStateService();
    const question: Card = { ...card('d1'), at: '2026-11-13T10:01:00Z', kind: 'question',
      request: { text: 'Which day?', expects: 'choice', choices: ['Friday'] } };
    state.load(snapshot({ cards: [question], messages: [
      message(1, 'person', 'book a table', '', '2026-11-13T10:00:00Z'),
      message(2, 'assistant', 'Looking.', '', '2026-11-13T10:00:30Z'),
      message(3, 'assistant', 'Friday it is.', '', '2026-11-13T10:03:00Z'),
      message(4, 'assistant', 'Booked.', '', '2026-11-13T10:04:00Z'),
    ] }));
    // Open, it waits with the cards, not in the thread.
    expect(state.value.turns.length).toBe(1);

    const events: any[] = [
      { seq: 5, at: '2026-11-13T10:01:00Z', event: 'card_opened', data: question },
      { seq: 6, at: '2026-11-13T10:02:00Z', event: 'card_closed',
        data: { card_id: 'd1', kind: 'question', answer: { choice: 'Friday' }, at: '2026-11-13T10:02:00Z' } },
    ];
    state.replay(events);
    state.replay(events);
    state.closeCard('d1');
    expect(state.value.turns.map((turn) => [turn.key, turn.answer?.label ?? null,
      turn.assistantMessages.map((one) => one.message_id)])).toEqual([
      ['m1', null, ['m2']],
      ['card:d1', 'You answered: Friday', ['m3', 'm4']],
    ]);
    expect(state.value.turns[1].answer?.asked).toBe('Which day?');
  });

  it('says only "Answered" for a card an older server closed, and leaves out those older than the messages shown', () => {
    const state = new ChatStateService();
    state.load(snapshot({ messages: [message(9, 'person', 'go on', '', '2026-11-13T10:00:00Z'),
      message(10, 'assistant', 'Done.', '', '2026-11-13T10:02:00Z')] }));
    state.replay([
      { seq: 1, at: '2026-11-13T09:00:00Z', event: 'card_closed', data: { card_id: 'old' } },
      { seq: 2, at: '2026-11-13T10:01:00Z', event: 'card_closed', data: { card_id: 'd2' } },
    ] as any[]);
    expect(state.value.turns.map((turn) => [turn.key, turn.answer?.label ?? null])).toEqual([
      ['m9', null], ['card:d2', 'Answered'],
    ]);
  });
});
