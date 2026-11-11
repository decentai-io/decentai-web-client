import { ActivityOverviewComponent, byWhat, compact, niceTop } from './activity-overview.component';

describe('ActivityOverviewComponent', () => {
  const rows = [
    { what: 'ai:chat:input', outcome: 'success', count: 8 },
    { what: 'ai:chat:input', outcome: 'refused', count: 1 },
    { what: 'chat.call', outcome: 'failed', count: 1 },
  ];

  function create(summary: any, asked: number[] = []) {
    return new ActivityOverviewComponent({
      summary: async (days: number) => { asked.push(days); return summary; },
      usage: async () => ({ agents: [{ agent: 'mail', processes: 2, memory: 10, cpu: 0.5 }, { agent: 'web', processes: 1, memory: 5, cpu: 0 }] }),
    } as any);
  }

  it('adds the trail up by what was done, the most first', () => {
    expect(byWhat(rows)).toEqual([
      { what: 'ai:chat:input', success: 8, refused: 1, failed: 0, total: 9 },
      { what: 'chat.call', success: 0, refused: 0, failed: 1, total: 1 },
    ]);
  });

  it('says how things ended, and what runs now', async () => {
    const component = create({ summary: rows });
    await component.load();
    // What runs now is read beside the summary, not before it.
    await new Promise((resolve) => setTimeout(resolve));

    expect(component.total).toBe(10);
    expect(component.refused + component.failed).toBe(2);
    expect(component.okShare).toBe('80% succeeded');
    expect(component.running?.length).toBe(2);
    expect(component.processes).toBe(3);
    expect(component.share(9)).toBe(100);
  });

  it('asks again for the days chosen, and says why nothing could be added up', async () => {
    const asked: number[] = [];
    const component = create({ summary: [], error: 'You are not allowed to do this.' }, asked);
    await component.load();
    await component.choose(30);

    expect(asked).toEqual([7, 30]);
    expect(component.error).toBe('You are not allowed to do this.');
  });

  it('rounds an axis top to 1, 2 or 5 of a power of ten', () => {
    expect(niceTop(0)).toBe(0);
    expect(niceTop(7)).toBe(10);
    expect(niceTop(13)).toBe(20);
    expect(niceTop(48)).toBe(50);
    expect(niceTop(101)).toBe(200);
  });

  it('keeps small numbers whole and shortens large ones', () => {
    expect(compact(1284)).toBe((1284).toLocaleString());
    expect(compact(12_900)).toMatch(/12\.9/);
  });
});
