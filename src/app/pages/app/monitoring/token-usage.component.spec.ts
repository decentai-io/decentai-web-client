import { TokenUsageComponent, addUp } from './token-usage.component';

describe('TokenUsageComponent', () => {
  const row = (said: any = {}) => ({
    day: '2026-11-07', provider: 'anthropic', model: 'claude-sonnet-5', user_id: 'u1', person: 'Dana', agent: '',
    input: 0, output: 0, calls: 1, cost: 0, ...said,
  });

  function create(rows: any[], asked: any[] = [], mine = false) {
    const component = new TokenUsageComponent(
      {
        tokens: async (days: number) => { asked.push(['org', days]); return { usage: rows }; },
        mine: async (days: number) => { asked.push(['mine', days]); return { usage: rows }; },
      } as any,
    );
    component.mine = mine;
    return component;
  }

  it('adds rows up by what each is, the most tokens first', () => {
    const totals = addUp([row({ model: 'a', input: 5 }), row({ model: 'b', input: 50 }), row({ model: 'a', input: 10, cost: null })],
                         (one) => one.model);

    expect(totals.map((total) => [total.key, total.input, total.calls, total.unpriced])).toEqual([['b', 50, 1, 0], ['a', 15, 2, 10]]);
  });

  it('draws each day, in and out, against a top an axis can say', async () => {
    const component = create([
      row({ day: '2026-11-06', input: 600, output: 200, calls: 2 }),
      row({ day: '2026-11-07', input: 100, output: 100 }),
    ]);
    await component.ngOnInit();

    expect(component.top).toBe(1000);
    expect(component.columns.map((column) => column.day.key)).toEqual(['2026-11-06', '2026-11-07']);
    expect(component.columns[0].inHeight).toBe(60);
    expect(component.columns[0].outHeight).toBe(20);
    expect(component.columns[0].tip).toContain('800 tokens in 2 calls');
    expect(component.name(component.people[0])).toBe('Dana');
  });

  it('asks again for the days chosen, of the person’s own or the organization’s', async () => {
    const asked: any[] = [];
    const org = create([], asked);
    await org.ngOnInit();
    await org.choose(30);

    const mine = create([], asked, true);
    await mine.ngOnInit();
    expect(asked).toEqual([['org', 7], ['org', 30], ['mine', 7]]);
  });

  it('says an estimate as an estimate, and what it could not price', async () => {
    const component = create([row({ input: 100, cost: 12.5 }), row({ model: 'mine', input: 100, cost: null })]);
    await component.ngOnInit();

    expect(component.partlyPriced).toBeTrue();
    expect(component.money(12.5)).toContain('12.50');
    expect(component.money(0.004)).toBe('<$0.01');
    expect(component.money(0)).toBe('$0.00');
    // A row none of whose tokens has a price has no cost to say.
    expect(component.rowCost(component.models.find((total) => total.key.endsWith('mine'))!)).toBe('—');
  });

  it('says why nothing could be added up', async () => {
    const component = new TokenUsageComponent(
      { tokens: async () => ({ usage: [], error: 'You are not allowed to do this.' }) } as any,
    );
    await component.ngOnInit();
    expect(component.error).toBe('You are not allowed to do this.');
  });
});
