import { SecretFormComponent } from './secret-form.component';

describe('SecretFormComponent', () => {
  const shape = {
    agent: 'jira', agent_name: 'Jira', id: 'connection', label: 'Connection', description: '',
    fields: [
      { name: 'service_url', label: 'Service URL', type: 'string', storage: 'keys', required: true },
      { name: 'api_token', label: 'API Token', type: 'secret', storage: 'values', required: true },
      { name: 'answers', label: 'What the site asks', type: 'form', storage: 'values' },
    ],
  } as any;
  const account = { agent: 'gmail', agent_name: 'Gmail', id: 'mailbox', label: 'Mailbox', fields: [], oauth: { provider: 'google' } } as any;

  function secret(overrides: any = {}) {
    return {
      record_id: 'sec_1', kind: 'secret', of: { agent: 'jira', resource: 'connection' },
      owner: { groups: [], users: ['me'] }, agents: [], keys: { service_url: 'https://old.example.com' },
      values: { api_token: null }, file: null, created_by: 'me', handing: null,
      ...overrides,
    } as any;
  }

  function create(data: any = {}, service: any = {}, oauth: any = {}) {
    const closed: any[] = [];
    const calls: any = {};
    const component = new SecretFormComponent(
      { shapes: [shape, account], ...data } as any,
      { close: (result: any) => closed.push(result), disableClose: false } as any,
      {
        create: async (kind: string, of: any, fields: any) => {
          calls.created = { kind, of, fields };
          return { record: secret({ record_id: 'sec_new', of }) };
        },
        update: async (kind: string, id: string, changes: any) => {
          calls.updated = { kind, id, changes };
          return { record: secret() };
        },
        ...service,
      } as any,
      { connect: async (id: string) => { calls.connected = id; return {}; }, ...oauth } as any,
    );
    component.ngOnInit();
    return { component, closed, calls };
  }

  it('asks for what the resource requires before a new secret is sent, and leaves form fields to a chat', async () => {
    const { component, calls, closed } = create();
    component.choose(shape);
    expect(component.formFields.map((field) => field.name)).toEqual(['service_url', 'api_token']);

    await component.save();
    expect(calls.created).toBeUndefined();
    expect(component.missing(shape.fields[0])).toBe('Enter Service URL.');

    component.fields['service_url'] = 'https://sync.example.com';
    component.fields['api_token'] = 's3cret';
    await component.save();
    expect(calls.created).toEqual({
      kind: 'secret', of: { agent: 'jira', resource: 'connection' },
      fields: { service_url: 'https://sync.example.com', api_token: 's3cret' },
    });
    expect(closed[0]).toEqual({ notice: 'Secret created.', id: 'sec_new' });
  });

  it('keeps a stored encrypted value when its box is left empty in a change', async () => {
    const { component, calls } = create({ secret: secret() });
    expect(component.fields['service_url']).toBe('https://old.example.com');
    expect(component.missing(shape.fields[1])).toBe('');

    await component.save();
    expect(calls.updated.changes).toEqual({ fields: { service_url: 'https://old.example.com' } });
  });

  it('makes an account\'s secret, then connects it on a click of its own', async () => {
    const { component, calls, closed } = create();
    component.choose(account);
    await component.save();

    expect(component.step).toBe('connect');
    expect(closed).toEqual([]);

    await component.connect();
    expect(calls.connected).toBe('sec_new');
    expect(closed[0]).toEqual({ notice: 'Google account connected.', id: 'sec_new' });
  });

  it('keeps the dialog and says why when the API server refuses', async () => {
    const { component, closed } = create({ secret: secret() }, {
      update: async () => ({ error: 'Service URL is text, at most 20000 characters.' }),
    });

    await component.save();

    expect(closed).toEqual([]);
    expect(component.problem).toBe('Service URL is text, at most 20000 characters.');
  });

  it('groups the resources by the agent each is for', () => {
    const { component } = create();
    expect(component.groups.map((group) => group.agent)).toEqual(['Gmail', 'Jira']);
    expect(component.aboutOf(shape)).toBe('2 fields');
    expect(component.aboutOf(account)).toBe('Sign in with Google');
    expect(component.firstSentenceOf({ ...shape, description: 'An account. A note for tests only.' })).toBe('An account.');
  });

  describe('the agents of a new secret, in the same form', () => {
    const sync = {
      agent: 'sync', agent_name: 'Sync', id: 'token', label: 'Token',
      fields: [{ name: 'api_token', type: 'secret', storage: 'values', required: true }],
    } as any;

    function filled(component: SecretFormComponent): void {
      component.fields['service_url'] = 'https://sync.example.com';
      component.fields['api_token'] = 's3cret';
    }

    it('offers the other agents that take it, and gives it to those ticked once it is made', async () => {
      const { component, calls, closed } = create({ shapes: [shape, account, sync] });
      component.choose(shape);
      expect(component.offersAgents).toBeTrue();
      expect(component.agentChoices.map((choice) => choice.key)).toEqual(['jira/connection', 'sync/token']);

      filled(component);
      component.chosenAgents = ['sync/token'];
      await component.save();
      expect(calls.updated).toEqual({
        kind: 'secret', id: 'sec_new',
        changes: { agents: [{ agent: 'jira', resource: 'connection' }, { agent: 'sync', resource: 'token' }] },
      });
      expect(closed[0]).toEqual({ notice: 'Secret created.', id: 'sec_new' });
    });

    it('sends one call when nothing else is ticked, and says what was refused once it is made', async () => {
      const quiet = create({ shapes: [shape, account, sync] });
      quiet.component.choose(shape);
      filled(quiet.component);
      await quiet.component.save();
      expect(quiet.calls.updated).toBeUndefined();

      const refused = create({ shapes: [shape, account, sync] }, { update: async () => ({ error: 'Not that one.' }) });
      refused.component.choose(shape);
      filled(refused.component);
      refused.component.chosenAgents = ['sync/token'];
      await refused.component.save();
      expect(refused.closed[0]).toEqual({ notice: 'Secret created. Its other agents were not added: Not that one.', id: 'sec_new' });
    });

    it('goes straight to the form when there is one thing it can be for, and offers no agents when changing', () => {
      expect(create({ shapes: [shape] }).component.step).toBe('form');
      expect(create({ shapes: [shape] }).component.canGoBack).toBeFalse();
      const { component } = create({ shapes: [shape, account, sync], secret: secret() });
      expect(component.offersAgents).toBeFalse();
    });
  });
});
