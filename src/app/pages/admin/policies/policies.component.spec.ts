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

  it('offers the endpoints by service, named in plain words, and leaves agents to their own pages', async () => {
    const component = await createComponent();
    expect(component.catalog.map((group) => group.key)).toEqual(['iam:user', 'iam:group']);
    expect(component.catalog.map((group) => group.label)).toEqual(['People', 'Groups']);
    expect(component.catalog[0].actions.map((a) => a.name)).toEqual(['See the organization\'s people', 'Remove a person']);
  });

  it('writes the ticked actions as one allow', async () => {
    const component = await createComponent();
    component.startCreate();
    component.selected.add('iam:user:list');
    component.selected.add('iam:group:list');
    expect(build(component)).toEqual([{ effect: 'allow', actions: ['iam:group:list', 'iam:user:list'] }]);
  });

  it('reads a plain allow back into the grid, a whole service as its wildcard', async () => {
    const component = await createComponent();
    component.startEdit(policy([{ effect: 'allow', actions: ['iam:user:*'] }]));
    expect(component.advanced).toBeFalse();
    expect(component.isActionOn(component.catalog[0], 'iam:user:delete')).toBeTrue();
    expect(component.isActionOn(component.catalog[1], 'iam:group:list')).toBeFalse();
  });

  it('keeps a policy naming an agent editable, as its document', async () => {
    const component = await createComponent();
    const statements = [{ effect: 'allow', actions: ['iam:user:list', 'agent:mail:*'] }];
    component.startEdit(policy(statements));
    expect(component.advanced).toBeTrue();
    expect(JSON.parse(component.advancedText)).toEqual(statements);
    expect(build(component)).toEqual(statements);
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

  it('says each statement in words, cut when long, and points to the agents it names', async () => {
    const component = await createComponent();
    const named = policy([
      { effect: 'allow', actions: ['iam:user:list', 'iam:group:*', '*'] },
      { effect: 'ask', actions: ['agent:mail:send'], scopes: { mailbox: ['work', 'home'] } },
      { effect: 'deny', actions: ['agent:gone:*'] },
    ]);
    expect(component.statementsOf(named)).toEqual([
      { effect: 'Allows', asks: false, items: ['See the organization\'s people', 'Everything in Groups', 'Everything'], scopes: '' },
      { effect: 'Asks first for', asks: true, items: ['Mail: Send a mail'], scopes: 'only where mailbox is work or home' },
      { effect: 'Doesn\'t allow', asks: false, items: ['All of Gone'], scopes: '' },
    ]);
    expect(component.agentsNamed(named)).toEqual([{ agent_id: 'mail', name: 'Mail' }]);

    const long = policy([{ effect: 'allow', actions: Array.from({ length: 9 }, (_, i) => `iam:user:a${i}`) }]);
    expect(component.statementsOf(long)[0].items.length).toBe(6);
    expect(component.hiddenCount(long)).toBe(3);
    component.toggleWhole(long);
    expect(component.statementsOf(long)[0].items.length).toBe(9);
    expect(component.hiddenCount(long)).toBe(0);

    component.toggleWhole(long);
    const many = policy(Array.from({ length: 7 }, (_, i) => ({ effect: 'allow', actions: [`iam:user:b${i}`] })));
    expect(component.statementsOf(many).length).toBe(4);
    expect(component.hiddenCount(many)).toBe(3);
    component.toggleWhole(many);
    expect(component.statementsOf(many).length).toBe(7);
  });

  it('finds a policy by what it says, in words', async () => {
    const component = await createComponent({
      list: async () => [policy([{ effect: 'allow', actions: ['iam:user:delete'] }])],
    });
    component.query = 'remove a person';
    expect(component.shown.length).toBe(1);
    component.query = 'webhooks';
    expect(component.shown.length).toBe(0);
  });
});
