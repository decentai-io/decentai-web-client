import { EMPTY } from 'rxjs';

import { trailPage } from 'src/app/services/audit.service';
import { MonitoringComponent } from './monitoring.component';

describe('MonitoringComponent', () => {
  function line(id: string, more: any = {}) {
    return {
      line_id: id, at: '2026-11-08T10:00:00Z', who: 'runtime r1', kind: 'runtime', chat_id: 'c1', what: 'chat.call',
      outcome: 'success', ids: [], reason: '', details: {}, ...more,
    };
  }

  function create(
    answers: any = {}, asked: string[] = [], can = (_: string) => true,
    address: { view?: string; went?: any[][] } = {},
  ) {
    return new MonitoringComponent(
      {
        usage: async () => answers.usage || { agents: [] },
        events: async (before = '') => {
          asked.push(before);
          return answers.events || trailPage([]);
        },
      } as any,
      { can } as any,
      {
        events: EMPTY,
        navigate: async (to: any[]) => {
          address.went?.push(to);
          return true;
        },
      } as any,
      { snapshot: { firstChild: { url: address.view ? [{ path: address.view }] : [] } } } as any,
    );
  }

  it('offers the views the person may open, and opens on the first', async () => {
    const component = create({}, [], (action) => action === 'ai:usage:mine' || action === 'agents:monitor:events');
    await component.ngOnInit();

    expect(component.views.map((view) => view.value)).toEqual(['mine', 'events']);
    expect(component.view).toBe('mine');
  });

  it('sends a view the person may not open back to /monitoring', async () => {
    const went: any[][] = [];
    const component = create({}, [], (action) => action === 'ai:usage:mine', { view: 'events', went });
    await component.ngOnInit();

    expect(went).toEqual([['/monitoring']]);
  });

  it('says what each running agent holds, against the most any holds', async () => {
    const component = create({
      usage: { agents: [{ agent: 'mail', processes: 2, memory: 1000 }, { agent: 'web', processes: 1, memory: 500 }] },
    });
    await component.readUsage();

    expect(component.processes).toBe(3);
    expect(component.memory).toBe(1500);
    expect(component.share(component.agents[1])).toBe(50);
    expect(component.updated).toBe('Updated just now');
  });

  it('reads the runtimes’ events a page at a time, alike ones together', async () => {
    const asked: string[] = [];
    const full = Array.from({ length: 100 }, (_, index) => line(`l${index}`, { what: index < 3 ? 'chat.call' : `chat.step${index}` }));
    const component = create({ events: trailPage(full) }, asked, () => true, { view: 'events' });
    await component.ngOnInit();

    expect(component.view).toBe('events');
    expect(component.days[0].items[0].lines.length).toBe(3);
    expect(component.before).toBe('l99');

    await component.older();
    expect(asked).toEqual(['', 'l99']);
  });

  it('says why the events could not be read', async () => {
    const component = create({ events: trailPage([], 'You are not allowed to do this.') }, [], () => true, { view: 'events' });
    await component.ngOnInit();

    expect(component.error).toBe('You are not allowed to do this.');
  });
});
