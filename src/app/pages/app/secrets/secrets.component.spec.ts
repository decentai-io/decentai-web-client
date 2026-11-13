import { of } from 'rxjs';

import { SecretsComponent } from './secrets.component';

describe('SecretsComponent', () => {
  const ME = 'usr_me';

  function secret(id: string, overrides: any = {}) {
    return {
      record_id: id, kind: 'secret', of: { agent: 'jira', resource: 'connection' },
      owner: { groups: [], users: [ME] }, agents: [{ agent: 'jira', resource: 'connection' }],
      keys: {}, values: {}, file: null, created_by: ME, handing: null,
      ...overrides,
    } as any;
  }

  const shapes = [
    { agent: 'jira', agent_name: 'Jira', id: 'connection', label: 'Connection', fields: [] },
    { agent: 'gmail', agent_name: 'Gmail', id: 'mailbox', label: 'Mailbox', fields: [], oauth: { provider: 'google' } },
  ];

  async function create(records: any[], service: any = {}, more: any = {}) {
    const calls: any = {};
    const component = new SecretsComponent(
      {
        list: async () => ({ records, handed: more.handed ?? [] }),
        shapes: async () => shapes,
        update: async (kind: string, id: string, changes: any) => { calls.updated = { kind, id, changes }; return {}; },
        remove: async (kind: string, id: string) => { (calls.removed ||= []).push(id); return {}; },
        accept: async (kind: string, id: string, yes: boolean) => { calls.accepted = { id, yes }; return {}; },
        ...service,
      } as any,
      { peers: async () => ({ people: [{ user_id: 'usr_2', name: 'Dana', email: 'd@x' }], groups: [], everyone: 'g0', mine: [] }) } as any,
      { can: () => true, user: { user_id: ME } } as any,
      { ask: async () => true, ...more.confirm } as any,
      { connect: async () => ({}) } as any,
      { events: of(), navigate: async () => true } as any,
      { queryParamMap: of({ get: () => null }), snapshot: { firstChild: null } } as any,
      {} as any,
    );
    await component.ngOnInit();
    return { component, calls };
  }

  it('counts the list by whose a secret is and which agent may use it', async () => {
    const { component } = await create([
      secret('own', { agents: [{ agent: 'jira', resource: 'connection' }, { agent: 'gmail', resource: 'mailbox' }] }),
      secret('other'),
      secret('theirs', { created_by: 'usr_2' }),
    ]);

    const [whose, agents] = component.filters;
    expect(whose.items.map((item) => item.count)).toEqual([2, 1]);
    expect(agents.items.map((item) => `${item.name} ${item.count}`)).toEqual(['Gmail 1', 'Jira 2']);

    component.agent = 'gmail';
    expect(component.shown.map((each) => each.record_id)).toEqual(['own']);
  });

  it('names a secret by what it is for, and its kind by its resource and agent', async () => {
    const { component } = await create([]);
    expect(component.nameOf(secret('a', { keys: { account: 'dana@example.com' } }))).toBe('dana@example.com');
    expect(component.nameOf(secret('b'))).toBe('Connection');
    expect(component.kindOf(secret('b'))).toBe('Connection · Jira');
    // An agent no longer declaring it is named by its id.
    expect(component.kindOf(secret('c', { of: { agent: 'google_drive', resource: 'login' } }))).toBe('login · Google drive');
  });

  it('says an account is not connected yet', async () => {
    const { component } = await create([]);
    const mailbox = secret('m', { of: { agent: 'gmail', resource: 'mailbox' } });
    expect(component.notConnected(mailbox)).toBeTrue();
    expect(component.notConnected({ ...mailbox, keys: { account: 'dana@example.com' } })).toBeFalse();
    expect(component.notConnected(secret('j'))).toBeFalse();
  });

  it('deletes a secret once asked, and says what agents it leaves', async () => {
    const asked: any[] = [];
    const { component, calls } = await create([secret('one')], {}, {
      confirm: { ask: async (question: any) => { asked.push(question); return true; } },
    });

    await component.deleteOne(component.records[0]);
    expect(asked[0].title).toBe('Delete this secret?');
    expect(asked[0].body).toContain('The agents that use it can no longer.');
    expect(calls.removed).toEqual(['one']);
  });

  it('accepts what a colleague handed over, in their name', async () => {
    const handed = secret('h', { created_by: 'usr_2', handing: { to: ME, by: 'usr_2' } });
    const { component, calls } = await create([], {}, { handed: [handed] });

    expect(component.handedSay(handed)).toBe('Dana handed you the secret “Connection”.');
    await component.accept(handed, true);
    expect(calls.accepted).toEqual({ id: 'h', yes: true });
  });

  it('opens a secret to choose its agents in place, and saves them through its update', async () => {
    const { component, calls } = await create([secret('one')]);
    const navigate = spyOn((component as any).router, 'navigate').and.resolveTo(true);
    component.openAgents(component.records[0]);
    expect(navigate).toHaveBeenCalledWith(['/secrets', 'one'], { queryParamsHandling: 'preserve' });
    expect(component.agentsTarget?.record_id).toBe('one');
    await component.saveAgents([{ agent: 'jira', resource: 'connection' }, { agent: 'gmail', resource: 'mailbox' }]);

    expect(calls.updated).toEqual({
      kind: 'secret', id: 'one',
      changes: { agents: [{ agent: 'jira', resource: 'connection' }, { agent: 'gmail', resource: 'mailbox' }] },
    });
    expect(component.agentsTarget).toBeNull();
  });
});
