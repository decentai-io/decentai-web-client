import { SkillsComponent } from './skills.component';

describe('SkillsComponent', () => {
  const ME = 'u1';

  function skill(id: string, name = id, more: any = {}) {
    return {
      id, name, description: `When ${name} applies.`, text: 'The text.',
      owner: { groups: [], users: [ME] }, created_by: ME, handing: null, at: '2026-10-01T00:00:00Z', updated_at: '2026-10-01T00:00:00Z', ...more,
    } as any;
  }

  function createComponent(items: any[] = [], service: any = {}, confirm: any = {}, handed: any[] = []) {
    return new SkillsComponent(
      {
        list: async () => ({ items, handed }),
        remove: async () => ({}),
        ...service,
      } as any,
      {
        peers: async () => ({
          people: [{ user_id: ME, name: 'Me', email: 'me@x' }, { user_id: 'u2', name: 'Dana', email: 'd@x' }],
          groups: [], everyone: 'g0', mine: [],
        }),
      } as any,
      { can: () => true, user: { user_id: ME } } as any,
      { events: { subscribe: () => ({ unsubscribe() {} }) }, navigate: async () => true } as any,
      { queryParamMap: { subscribe: () => ({ unsubscribe() {} }) }, snapshot: { firstChild: null } } as any,
      { ask: async () => true, ...confirm } as any,
    );
  }

  it('says who can use a skill by name, and whose somebody else\'s is', async () => {
    const component = createComponent();
    await component.ngOnInit();
    const shared = skill('sk_1', 'Reports', { owner: { groups: [], users: [ME, 'u2'] } });
    const theirs = skill('sk_2', 'Mail', { created_by: 'u2', owner: { groups: ['g0'], users: ['u2'] } });

    expect(component.sharing(skill('sk_1')).word).toBe('Private');
    expect(component.sharing(shared).word).toBe('Dana');
    expect(component.sharing(theirs).word).toBe('Shared by Dana');
    expect(component.author(theirs)).toBe('Dana');
    expect(component.mayChange(theirs)).toBeFalse();
  });

  it('narrows the list by whose a skill is, and orders it', async () => {
    const mine = skill('sk_1', 'Zebra', { updated_at: '2026-10-01T00:00:00Z' });
    const theirs = skill('sk_2', 'Apple', { created_by: 'u2', updated_at: '2026-10-05T00:00:00Z' });
    const component = createComponent([mine, theirs]);
    await component.ngOnInit();

    expect(component.shownSkills.map((s) => s.id)).toEqual(['sk_2', 'sk_1']);
    component.sort = 'name';
    expect(component.shownSkills.map((s) => s.name)).toEqual(['Apple', 'Zebra']);
    component.show = 'mine';
    expect(component.shownSkills.map((s) => s.id)).toEqual(['sk_1']);
    expect(component.filters[0].items.map((item) => item.count)).toEqual([2, 1, 1]);
  });

  it('shares through its own call, with the owner map', async () => {
    let sent: any;
    const component = createComponent([skill('sk_1')], {
      share: async (id: string, owner: any) => { sent = { id, owner }; return { item: skill(id) }; },
    });
    await component.ngOnInit();

    component.openShare(skill('sk_1'));
    component.share.mode = 'org';
    await component.saveShare();

    expect(sent).toEqual({ id: 'sk_1', owner: { groups: ['g0'], users: [ME] } });
    expect(component.notice).toBe('Sharing updated.');
  });

  it('accepts a skill handed over, and says whose it was', async () => {
    let accepted: any;
    const handed = skill('sk_9', 'Reports', { created_by: 'u2', handing: { to: ME, by: 'u2' } });
    const component = createComponent([], {
      accept: async (id: string, accept: boolean) => { accepted = { id, accept }; return {}; },
    }, {}, [handed]);
    await component.ngOnInit();

    expect(component.handedBy(handed)).toBe('Dana');
    await component.accept(handed, true);
    expect(accepted).toEqual({ id: 'sk_9', accept: true });
  });

  it('asks before deleting', async () => {
    let removed = '';
    let answer = false;
    const component = createComponent([skill('sk_1')], {
      remove: async (id: string) => { removed = id; return {}; },
    }, { ask: async () => answer });
    await component.ngOnInit();

    await component.askDelete(skill('sk_1'));
    expect(removed).toBe('');

    answer = true;
    await component.askDelete(skill('sk_1'));
    expect(removed).toBe('sk_1');
  });
});
