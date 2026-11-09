import { PoliciesComponent } from './policies.component';

describe('PoliciesComponent', () => {
  const ACTIONS = [
    { action: 'iam:user:list', words: 'See the organization\'s people' },
    { action: 'iam:user:delete', words: 'Remove a person' },
    { action: 'iam:group:list', words: 'See the organization\'s groups' },
  ];
  const AGENT = {
    agent_id: 'mail', name: 'Mail',
    manifest: { functions: [{ id: 'send', name: 'Send a mail' }, { id: 'read', name: 'Read mail' }] },
  };

  async function createComponent(service: any = {}): Promise<PoliciesComponent> {
    const component = new PoliciesComponent(
      { list: async () => [], ...service } as any,
      { installed: async () => [AGENT] } as any,
      { can: () => true, catalog: ACTIONS, ensureLoaded: async () => undefined, refresh: async () => true } as any,
      // The editor's dialog and the question before a delete: not asked here.
      { open: () => ({ afterClosed: () => ({ subscribe: () => undefined }), close: () => undefined }) } as any,
      {} as any,
    );
    await component.ngOnInit();
    return component;
  }

  const policy = (statements: any[]) => ({ policy_id: 'p1', name: 'P', built_in: false, statements });

  function build(component: PoliciesComponent): any {
    return (component as any).buildStatements();
  }

  it('offers the endpoints by service in the server\'s words, and each agent by its functions', async () => {
    const component = await createComponent();
    expect(component.catalog.map((group) => group.key)).toEqual(['iam:user', 'iam:group', 'agent:mail']);
    expect(component.catalog[0].actions.map((a) => a.name)).toEqual(['See the organization\'s people', 'Remove a person']);
    expect(component.catalog[2].actions.map((a) => a.action)).toEqual(['agent:mail:send', 'agent:mail:read']);
  });

  it('writes the ticked actions as one allow', async () => {
    const component = await createComponent();
    component.startCreate();
    component.selected.add('iam:user:list');
    component.selected.add('agent:mail:send');
    expect(build(component)).toEqual([{ effect: 'allow', actions: ['agent:mail:send', 'iam:user:list'] }]);
  });

  it('reads a plain allow back into the grid, a whole agent as its wildcard', async () => {
    const component = await createComponent();
    component.startEdit(policy([{ effect: 'allow', actions: ['iam:user:list', 'agent:mail:*'] }]));
    expect(component.advanced).toBeFalse();
    expect(component.isActionOn(component.catalog[2], 'agent:mail:read')).toBeTrue();
    expect(component.isActionOn(component.catalog[1], 'iam:group:list')).toBeFalse();
  });

  it('falls back to the document for a deny, an ask or scopes', async () => {
    const component = await createComponent();
    for (const statement of [
      { effect: 'deny', actions: ['iam:user:delete'] },
      { effect: 'ask', actions: ['agent:mail:send'] },
      { effect: 'allow', actions: ['agent:mail:send'], scopes: { mailbox: ['work'] } },
    ]) {
      component.startEdit(policy([statement]));
      expect(component.advanced).withContext(statement.effect).toBeTrue();
      expect(JSON.parse(component.advancedText)).toEqual([statement]);
    }
  });

  it('falls back to the document for a pattern no box stands for', async () => {
    // `iam:*` allows two services and is neither of them.
    const component = await createComponent();
    component.startEdit(policy([{ effect: 'allow', actions: ['iam:*'] }]));
    expect(component.advanced).toBeTrue();
  });

  it('spreads a wildcard out when one action of it is turned off', async () => {
    const component = await createComponent();
    component.startCreate();
    component.toggleGroup(component.catalog[0]);
    expect([...component.selected]).toEqual(['iam:user:*']);
    component.toggleAction(component.catalog[0], 'iam:user:delete');
    expect([...component.selected]).toEqual(['iam:user:list']);
  });

  it('renames a policy whose name changed, then saves what it allows', async () => {
    const calls: string[] = [];
    const component = await createComponent({
      list: async () => [policy([{ effect: 'allow', actions: ['iam:user:list'] }])],
      rename: async (id: string, name: string) => { calls.push(`rename ${id} ${name}`); return {}; },
      update: async (id: string) => { calls.push(`update ${id}`); return {}; },
    });
    component.startEdit(component.policies[0]);
    component.formName = 'Readers';
    await component.save();
    expect(calls).toEqual(['rename p1 Readers', 'update p1']);

    calls.length = 0;
    component.startEdit(component.policies[0]);
    await component.save();
    expect(calls).toEqual(['update p1']);
  });

  it('names what a policy allows by its services and agents', async () => {
    const component = await createComponent();
    expect(component.summarise(policy([{ effect: 'allow', actions: ['iam:user:list', 'agent:mail:*'] }])))
      .toBe('iam:user, Mail');
    expect(component.summarise(policy([{ effect: 'allow', actions: ['*'] }, { effect: 'deny', actions: ['iam:*'] }])))
      .toBe('Everything · and asks or denies some');
  });
});
