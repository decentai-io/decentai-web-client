import { convertToParamMap, ParamMap } from '@angular/router';
import { BehaviorSubject, of } from 'rxjs';

import { SchedulesComponent } from './schedules.component';

describe('SchedulesComponent', () => {
  const schedule = (id: string, more: any = {}) => ({
    schedule_id: id, chat_id: 'chat_a', what: { prompt: `Do ${id}` }, when: { every: 3600 },
    next_at: '2026-11-14T09:00:00Z', paused: false, by: 'person', trust: 1, runs: [], ...more,
  });

  function create(params: Record<string, string> = {}, opened = '') {
    const address = new BehaviorSubject<ParamMap>(convertToParamMap(params));
    const asked: any[] = [];
    const service = {
      schedule: async (id: string) => {
        asked.push({ endpoint: 'schedule', id });
        return id === 'far' ? schedule('far') : null;
      },
      list: async (after: string, limit: number) => {
        asked.push({ endpoint: 'cards', after, limit });
        return { cards: [], total: 9, next: null, schedules: [], counts: {}, chats_waiting: 0, waiting: {} };
      },
      schedulePage: async (after: string, limit: number, filters: any) => {
        asked.push({ endpoint: 'schedules', after, limit, ...filters });
        const rows = after === 's19' ? [schedule('s20')] : Array.from({ length: 20 }, (_, i) => schedule(`s${i}`));
        return {
          rows, next: after === 's19' ? null : 's19', total: 21,
          counts: { all: 30, active: 21, paused: 6, done: 2, failing: 1 },
          chats: [{ chat_id: 'chat_a', title: 'Mail', count: 21 }, { chat_id: 'chat_b', title: 'Notes', count: 9 }],
          upcoming: schedule('s0'),
        };
      },
      functions: async () => [],
    };
    const component = new SchedulesComponent(
      service as any,
      { listChats: async () => [] } as any,
      { stopped$: of(false) } as any,
      { can: () => true } as any,
      { events: of(), navigate: async () => true } as any,
      {
        queryParamMap: address, firstChild: null,
        snapshot: { firstChild: opened ? { paramMap: convertToParamMap({ id: opened }) } : null },
      } as any,
      {} as any,
      { ask: async () => true } as any,
    );
    return { component, asked, address };
  }

  it('reads the page the address names, narrowed on the server, and the server’s numbers', async () => {
    const { component, asked } = create({ state: 'active', chat: 'chat_a', q: 'mail', page: '2' });
    await component.ngOnInit();

    const pages = asked.filter((ask) => ask.endpoint === 'schedules');
    expect(pages.map((ask) => ask.after)).toEqual(['', 's19']);
    expect(pages[0]).toEqual(jasmine.objectContaining({ state: 'active', chat_id: 'chat_a', q: 'mail', limit: 20 }));
    expect(component.pages.page).toBe(2);
    expect(component.schedules.map((one) => one.schedule_id)).toEqual(['s20']);
    expect(asked.find((ask) => ask.endpoint === 'cards')).toEqual({ endpoint: 'cards', after: '', limit: 5 });
    expect(component.cardsTotal).toBe(9);

    expect(component.count('paused')).toBe(6);
    expect(component.upcoming?.schedule_id).toBe('s0');
    const column = component.filters;
    expect(column[0].items.map((item) => item.count)).toEqual([30, 21, 6, 2, 1]);
    expect(column[1].items.map((item) => [item.name, item.count])).toEqual([['Mail', 21], ['Notes', 9]]);
    expect(component.filters).toBe(column);
    component.ngOnDestroy();
  });

  it('reads a schedule opened from its address by its id when no page read holds it', async () => {
    const { component, asked } = create({}, 'far');
    await component.ngOnInit();
    await new Promise((resolve) => setTimeout(resolve));

    expect(asked).toContain({ endpoint: 'schedule', id: 'far' });
    expect(component.opened?.schedule_id).toBe('far');
    expect(component.error).toBe('');
    component.ngOnDestroy();
  });

  it('says a schedule opened from its address is gone when the server has none by that id', async () => {
    const { component } = create({}, 'gone');
    await component.ngOnInit();
    await new Promise((resolve) => setTimeout(resolve));

    expect(component.opened).toBeNull();
    expect(component.error).toContain('no longer on the clock');
    component.ngOnDestroy();
  });

  it('reads the first page again when the address names another filter', async () => {
    const { component, asked, address } = create();
    await component.ngOnInit();
    await component.pages.go(2);

    address.next(convertToParamMap({ state: 'paused' }));
    await new Promise((resolve) => setTimeout(resolve));
    const last = asked.filter((ask) => ask.endpoint === 'schedules').pop();
    expect(last).toEqual(jasmine.objectContaining({ after: '', state: 'paused' }));
    expect(component.pages.page).toBe(1);
    component.ngOnDestroy();
  });
});
