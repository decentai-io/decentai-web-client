import { WaitingComponent } from './waiting.component';

describe('WaitingComponent', () => {
  const card = (id: string, chat: string, kind = 'approval') => ({
    card_id: id, chat_id: chat, kind, call: '', agent: 'mail', request: { items: [] }, status: 'open', at: '', answer: null,
  });

  function create(decide: any = async () => ({})) {
    const asked: string[] = [];
    const refreshed: number[] = [];
    const activity = {
      list: async (after: string) => {
        asked.push(after);
        return after
          ? { cards: [card('c3', 'chat_b', 'question')], next: null, total: 3, chats: { chat_b: 'Second' },
              waiting: { chat_b: 1 }, chats_waiting: 2, schedules: [],
              counts: { approval: 2, network: 0, question: 1, form: 0, skill: 0, memory: 0 } }
          : { cards: [card('c1', 'chat_a'), card('c2', 'chat_a')], next: 'c2', total: 3, chats: { chat_a: 'First' },
              waiting: { chat_a: 2 }, chats_waiting: 2, schedules: [],
              counts: { approval: 2, network: 0, question: 1, form: 0, skill: 0, memory: 0 } };
      },
    };
    const component = new WaitingComponent(activity as any, { decide } as any,
      { refresh: async () => refreshed.push(1) } as any);
    return { component, asked, refreshed };
  }

  it('reads the oldest cards a page at a time, under their chats, counted by the server', async () => {
    const { component, asked } = create();
    await component.load();

    expect(component.groups.map((group) => [group.title, group.cards.length])).toEqual([['First', 2]]);
    expect(component.tiles.map((tile) => tile.value)).toEqual([3, 2, 1]);
    expect(component.chatsWaiting).toBe(2);
    expect(component.cards.hasMore).toBeTrue();

    await component.more();
    expect(asked).toEqual(['', 'c2']);
    expect(component.groups.map((group) => group.title)).toEqual(['First', 'Second']);
    expect(component.waitingIn(component.groups[1])).toBe(1);
    expect(component.cards.hasMore).toBeFalse();
  });

  it('keeps the groups it made while the cards read stay the same', async () => {
    const { component } = create();
    await component.load();
    expect(component.groups).toBe(component.groups);
  });

  it('takes an answered card out, and out of the numbers', async () => {
    const { component, refreshed } = create();
    await component.load();
    await component.more();

    await component.onDecision({ card_id: 'c3', answer: { allow: true } } as any);
    expect(component.cards.rows.map((one) => one.card_id)).toEqual(['c1', 'c2']);
    expect(component.cards.total).toBe(2);
    expect(component.counts.question).toBe(0);
    expect(component.chatsWaiting).toBe(1);
    expect(refreshed.length).toBe(1);
  });
});
