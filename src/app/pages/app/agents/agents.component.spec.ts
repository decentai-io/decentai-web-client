import { convertToParamMap } from '@angular/router';
import { EMPTY } from 'rxjs';

import { AgentsComponent } from './agents.component';

describe('AgentsComponent', () => {
  function agent(id: string, overrides: any = {}) {
    return {
      agent_id: id,
      name: id,
      version: '1.0.0',
      state: 'ready',
      error: '',
      manifest: { schema: 3, agent: { id, name: id, version: '1.0.0', description: `The ${id} agent.` }, functions: [] },
      ...overrides,
    } as any;
  }

  /** What the page asked before uninstalling, and what it is told. */
  let questions: any[] = [];
  let answer = true;
  let saved: any[] = [];
  beforeEach(() => { questions = []; answer = true; saved = []; });

  function create(agents: any[], service: any = {}, can = (_action: string) => true, chat: any = {},
                  router: any = undefined, route: any = undefined) {
    return new AgentsComponent(
      {
        installed: async () => agents,
        available: async () => [],
        uninstall: async () => ({}),
        check: async () => ({}),
        ...service,
      } as any,
      { can } as any,
      {
        get: async () => ({ preferences: { chat } }),
        savePreferences: async (changes: any) => { saved.push(changes); return {}; },
      } as any,
      { ask: async (asked: any) => { questions.push(asked); return answer; } } as any,
      router,
      route,
    );
  }

  it('says where an installed agent stands in one word, the first that holds', async () => {
    const component = create([], {
      available: async () => [{ status: 'update_available', manifest: { agent: { id: 'b' } } }],
    });
    await component.ngOnInit();
    const word = (one: any) => component.standing(one).word;

    expect(word(agent('a'))).toBe('Ready');
    expect(word(agent('a', { state: 'checking' }))).toBe('Checking');
    expect(word(agent('a', { state: 'failed', error: 'no ready' }))).toBe('Failed');
    expect(word(agent('b'))).toBe('Update available');
    // Failing comes before anything else that is also true of it.
    expect(word(agent('b', { state: 'failed' }))).toBe('Failed');
  });

  it('reads what the sources offer only for whoever may install', async () => {
    const available = jasmine.createSpy('available').and.resolveTo([]);
    await create([agent('a')], { available }, (action) => action !== 'agents:agent:install').ngOnInit();
    expect(available).not.toHaveBeenCalled();
  });

  it('says how many each view of the list holds, and sums them under the grid', async () => {
    const component = create([agent('a'), agent('b', { state: 'failed' }), agent('c')], {
      available: async () => [{ status: 'update_available', manifest: { agent: { id: 'c' } } }],
    });
    await component.ngOnInit();

    expect(component.filterGroups[0].items.map((item) => [item.name, item.count]))
      .toEqual([['All agents', 3], ['Needs attention', 2], ['Updates', 1]]);
    expect(component.foot).toBe('3 installed · 2 ready · 3 in new chats');
    component.setFilter('attention');
    expect(component.shownAgents.map((one) => one.agent_id)).toEqual(['b', 'c']);
  });

  it('asks a runtime to check an agent again, and says how it went', async () => {
    let state = 'checking';
    const component = create([], {
      installed: async () => [agent('a', { state, error: state === 'failed' ? 'it said nothing' : '' })],
      check: async () => { state = 'failed'; return {}; },
    });
    await component.ngOnInit();
    await component.check(agent('a'));
    expect(component.error).toBe('a failed its check: it said nothing');
    component.ngOnDestroy();
  });

  // ── What new chats start with ───────────────────────────────────────

  it('treats no choice of agents as every agent being in new chats', async () => {
    const component = create([agent('a'), agent('b')]);
    await component.ngOnInit();
    expect(component.isDefault(agent('a'))).toBeTrue();
    expect(component.defaultCount).toBe(2);
  });

  it('saves the whole of what a new chat starts with the moment a switch moves', async () => {
    const component = create([agent('a'), agent('b')], {}, () => true, { trust: 2 });
    await component.ngOnInit();

    await component.toggleDefault(agent('a'));
    expect(saved).toEqual([{ chat: { trust: 2, agents: ['b'] } }]);
    expect(component.isDefault(agent('a'))).toBeFalse();

    // Every one on again is said as all, so a later install is in.
    await component.toggleDefault(agent('a'));
    expect(saved[1]).toEqual({ chat: { trust: 2, agents: null } });
  });

  it('switches off the last agent too: a new chat then uses none', async () => {
    const component = create([agent('a'), agent('b')], {}, () => true, { agents: ['a'] });
    await component.ngOnInit();
    await component.toggleDefault(agent('a'));
    expect(saved).toEqual([{ chat: { agents: [] } }]);
    expect(component.defaultCount).toBe(0);
  });

  it('puts the switch back when the save fails', async () => {
    const component = create([agent('a'), agent('b')]);
    await component.ngOnInit();
    (component as any).profile.savePreferences = async () => ({ error: 'No.' });
    await component.toggleDefault(agent('a'));
    expect(component.isDefault(agent('a'))).toBeTrue();
    expect(component.error).toBe('No.');
  });

  // ── Uninstalling ────────────────────────────────────────────────────

  it('asks before uninstalling, saying the records stay', async () => {
    const uninstall = jasmine.createSpy('uninstall').and.resolveTo({});
    const component = create([agent('a')], { uninstall });
    await component.ngOnInit();

    answer = false;
    await component.requestUninstall(agent('a'));
    expect(questions[0].body).toContain('records it kept stay');
    expect(uninstall).not.toHaveBeenCalled();
  });

  it('uninstalls everything ticked, and names what would not go, leaving it ticked', async () => {
    const component = create([agent('a'), agent('b')], {
      uninstall: async (id: string) => (id === 'b' ? { error: 'Refused.' } : {}),
    });
    await component.ngOnInit();
    component.toggleSelected(agent('a'));
    component.toggleSelected(agent('b'));

    await component.requestUninstallSelected();
    expect(questions.length).toBe(1);
    expect(component.error).toBe('Uninstalled 1. Still installed: b (Refused.)');
    expect([...component.selected]).toEqual(['b']);
  });

  // ── Addresses ───────────────────────────────────────────────────────

  function routed(ref: string, tab = '') {
    const params: Record<string, string> = ref ? { ref, ...(tab ? { tab } : {}) } : {};
    return { snapshot: { firstChild: { paramMap: convertToParamMap(params) } } };
  }

  it('opens the agent and the tab its address names', async () => {
    const router = { events: EMPTY, navigate: jasmine.createSpy('navigate') };
    const component = create([agent('a')], {}, () => true, {}, router, routed('a', 'functions'));
    await component.ngOnInit();
    expect(component.openAgent?.agent_id).toBe('a');
    expect(component.openTab).toBe('functions');

    component.openTabOf('overview');
    expect(router.navigate).toHaveBeenCalledWith(['/agents', 'a']);
  });

  it('says so, and goes back to the list, for an agent that is not installed', async () => {
    const router = { events: EMPTY, navigate: jasmine.createSpy('navigate') };
    const component = create([agent('a')], {}, () => true, {}, router, routed('gone'));
    await component.ngOnInit();
    expect(component.openAgent).toBeNull();
    expect(component.error).toContain('not installed here');
    expect(router.navigate).toHaveBeenCalledWith(['/agents'], { replaceUrl: true });
  });

  // ── Narrowing and ordering ──────────────────────────────────────────

  it('narrows by a tag the agents do not all share, and orders by name, attention or installing', async () => {
    const tagged = (id: string, tags: string[], overrides: any = {}) => {
      const one = agent(id, overrides);
      one.manifest.agent.tags = tags;
      return one;
    };
    const component = create([
      tagged('zeta', ['mail', 'work'], { installed_at: '2026-01-03T00:00:00Z' }),
      tagged('alpha', ['notes', 'work'], { installed_at: '2026-01-01T00:00:00Z', state: 'failed' }),
      tagged('mid', ['mail', 'work'], { installed_at: '2026-01-02T00:00:00Z' }),
    ]);
    await component.ngOnInit();

    // "work" is on every one: it tells none apart.
    expect(component.filterGroups[1].items.map((item) => [item.value, item.count])).toEqual([['mail', 2], ['notes', 1]]);
    expect(component.shownAgents.map((one) => one.agent_id)).toEqual(['alpha', 'mid', 'zeta']);
    component.setSort('recent');
    expect(component.shownAgents.map((one) => one.agent_id)).toEqual(['zeta', 'mid', 'alpha']);
    component.setSort('attention');
    expect(component.shownAgents[0].agent_id).toBe('alpha');

    component.choose({ key: 'tag', value: 'mail' });
    expect(component.shownAgents.map((one) => one.agent_id).sort()).toEqual(['mid', 'zeta']);
    expect(component.filterChosen).toEqual({ show: 'all', tag: 'mail' });
    component.showAll();
    expect(component.shownAgents.length).toBe(3);
  });

  it('remembers cards or a table on this device', async () => {
    const component = create([agent('a')]);
    component.setView('list');
    expect(create([]).view).toBe('list');
    component.setView('grid');
    expect(create([]).view).toBe('grid');
  });
});
