import { trailPage } from 'src/app/services/audit.service';
import { AuditComponent } from './audit.component';
import { groupLines } from './trail-words';

describe('AuditComponent', () => {
  function line(id: string, more: any = {}) {
    return {
      line_id: id, at: '2026-11-08T10:00:00Z', who: 'me@x.test', kind: 'person', chat_id: '', what: 'ai:chat:input',
      outcome: 'success', ids: [], reason: '', details: {}, ...more,
    };
  }

  function create(asked: any[] = [], lines: any[] = [], can = (_: string) => true, chat = '') {
    return new AuditComponent(
      {
        mine: async (before: string, filters: any) => {
          asked.push({ before, ...filters });
          return trailPage(lines);
        },
        all: async (before: string, filters: any) => {
          asked.push({ before, ...filters, all: true });
          return trailPage(lines);
        },
      } as any,
      { can } as any,
      { navigate: async () => true } as any,
      { snapshot: { queryParamMap: { get: () => chat } } } as any,
      { peers: async () => ({ people: [{ user_id: 'u1', name: 'Dana', email: 'd@x.test' }], groups: [], everyone: '', mine: [] }) } as any,
    );
  }

  it('opens on the organization view only for someone who may read it', async () => {
    const asked: any[] = [];
    const component = create(asked);
    component.initialView = 'org';
    await component.ngOnInit();
    expect(component.tab).toBe('org');
    expect(asked[0].all).toBeTrue();
    expect(component.people.map((person) => person.name)).toEqual(['Everyone', 'Dana']);

    const plain: any[] = [];
    const member = create(plain, [], (action) => action === 'ai:audit:list');
    member.initialView = 'org';
    await member.ngOnInit();
    expect(member.tab).toBe('mine');
    expect(plain[0].all).toBeUndefined();
  });

  it('reads one person’s lines of the organization’s', async () => {
    const asked: any[] = [];
    const component = create(asked);
    component.initialView = 'org';
    await component.ngOnInit();

    component.choosePerson('u1');
    await Promise.resolve();

    expect(asked[asked.length - 1]).toEqual({ before: '', chat_id: '', what: '', outcome: '', user_id: 'u1', all: true });
  });

  it('reads the next page from the last line of a full one', async () => {
    const asked: any[] = [];
    const full = Array.from({ length: 100 }, (_, index) => line(`l${index}`));
    const component = create(asked, full);
    await component.ngOnInit();
    expect(component.before).toBe('l99');

    await component.loadMore();
    expect(asked[1].before).toBe('l99');
    expect(component.lines.length).toBe(200);
  });

  it('asks the API server for one chat\'s lines, what was done and how it ended', async () => {
    const asked: any[] = [];
    const component = create(asked, [], () => true, 'c1');
    await component.ngOnInit();
    expect(asked[0]).toEqual({ before: '', chat_id: 'c1', what: '', outcome: '' });
    expect(component.filtered).toBeTrue();

    component.what = ' AI:Chat ';
    component.chooseOutcome('refused');
    await Promise.resolve();
    expect(asked[asked.length - 1]).toEqual({ before: '', chat_id: 'c1', what: 'ai:chat', outcome: 'refused' });

    component.clearFilters();
    await Promise.resolve();
    expect(asked[asked.length - 1]).toEqual({ before: '', chat_id: '', what: '', outcome: '' });
    expect(component.filtered).toBeFalse();
  });

  it('says how a line ended, and why not', async () => {
    const component = create();

    expect(component.tone(line('a') as any)).toBe('ok');
    expect(component.more(line('a', { outcome: 'refused', reason: 'Sign in first.' }) as any)).toBe('Refused · Sign in first.');
  });
});

describe('groupLines', () => {
  const at = (seconds: number) => new Date(Date.UTC(2026, 10, 8, 10, 0, seconds)).toISOString();
  const line = (id: string, seconds: number, what = 'ai:chat:open') => ({
    line_id: id, at: at(seconds), who: 'me', kind: 'person', chat_id: 'c1', what, outcome: 'success',
    ids: [], reason: '', details: {},
  });

  it('makes one row of the same thing done again within a minute', () => {
    const groups = groupLines([line('3', 50), line('2', 30), line('1', 10), line('0', 5, 'ai:chat:input')]);

    expect(groups.map((group) => group.lines.length)).toEqual([3, 1]);
  });
});
