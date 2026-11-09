import { ChatStateService } from './chat-state.service';
import { Card, ChatMessage, ChatSnapshot, DEFAULT_CHAT_SETTINGS } from 'src/app/models/chat-protocol';

describe('ChatStateService', () => {
  const message = (seq: number, actor: ChatMessage['actor'], text: string, client_id = ''): ChatMessage =>
    ({ message_id: `m${seq}`, seq, actor, parts: [{ type: 'text', text }], files: [], client_id, at: '' });
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
    // Words being written carry the last kept number, and pass.
    expect(state.sequence(event(5, 'saying'))).toBe('take');
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
    expect(state.value.steps['k'].map((step) => step.text)).toEqual(['Looking at the calendar']);
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

  it('tells a call again in place, and an agent\'s latest line on its call', () => {
    const state = new ChatStateService();
    state.load(snapshot({ messages: [message(1, 'person', 'hi')] }));
    state.work({ id: 'w1', title: 'Saving the note', status: 'running' });
    state.progress('Notes', 'k1', 'Opening the notebook');
    state.progress('Notes', 'k1', 'Writing');
    state.work({ id: 'w1', title: 'Saving the note', status: 'done' });
    expect(state.value.steps['m1'].map((step) => [step.text, step.status])).toEqual([
      ['Saving the note', 'done'], ['Writing', undefined],
    ]);
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
    state.load(snapshot({ messages: [message(1, 'assistant', 'A schedule ran'), message(2, 'webhook', 'New order'),
      message(3, 'assistant', 'Filed it')] }));
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
});
