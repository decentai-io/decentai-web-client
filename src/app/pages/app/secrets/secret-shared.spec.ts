import {
  agentChoices, editableFields, fits, identifier, isConnected, secretTitle, shownFields,
} from './secret-shared';

describe('what is read off a secret', () => {
  function secret(overrides: any = {}) {
    return {
      record_id: 'sec_1', kind: 'secret', of: { agent: 'jira', resource: 'connection' },
      owner: { groups: [], users: ['me'] }, agents: [{ agent: 'jira', resource: 'connection' }],
      keys: {}, values: {}, file: null, created_by: 'me', handing: null,
      ...overrides,
    } as any;
  }

  const shape = {
    agent: 'jira', agent_name: 'Jira', id: 'connection', label: 'Connection',
    fields: [
      { name: 'service_url', label: 'Service URL', type: 'string', storage: 'keys' },
      { name: 'api_token', label: 'API Token', type: 'secret', storage: 'values' },
      { name: 'answers', label: 'What the site asks', type: 'form', storage: 'values' },
    ],
  } as any;

  it('shows plain fields as text and encrypted ones as set or not, in the resource\'s order', () => {
    const stored = secret({ keys: { service_url: 'https://sync.example.com' }, values: { api_token: null } });
    expect(shownFields(stored, shape)).toEqual([
      { label: 'Service URL', value: 'https://sync.example.com', hidden: false, set: true },
      { label: 'API Token', value: '', hidden: true, set: true },
      { label: 'What the site asks', value: '', hidden: true, set: false },
    ]);
  });

  it('lists what a secret holds when its resource is no longer declared', () => {
    expect(shownFields(secret({ keys: { site: 'example.com' }, values: { password: null } }), null)).toEqual([
      { label: 'site', value: 'example.com', hidden: false, set: true },
      { label: 'password', value: '', hidden: true, set: true },
    ]);
  });

  it('is called by what it is for, else by its kind', () => {
    expect(identifier(secret({ keys: { service_url: 'https://sync.example.com' } }))).toBe('https://sync.example.com');
    expect(secretTitle(secret({ keys: { account: 'dana@example.com', site: 'x' } }), shape)).toBe('dana@example.com');
    expect(secretTitle(secret(), shape)).toBe('Connection');
    expect(secretTitle(secret(), null)).toBe('connection');
  });

  it('leaves a form field to the chat that asks it, and knows a connected account', () => {
    expect(editableFields(shape).map((field) => field.name)).toEqual(['service_url', 'api_token']);
    expect(isConnected(secret({ keys: { account: 'dana' } }))).toBeTrue();
    expect(isConnected(secret())).toBeFalse();
  });

  describe('the agents a secret may be given to', () => {
    const sync = {
      agent: 'sync', agent_name: 'Sync', id: 'token', label: 'Token',
      fields: [{ name: 'api_token', type: 'secret', storage: 'values', required: true }],
    } as any;
    const other = {
      agent: 'mail', agent_name: 'Mail', id: 'login', label: 'Login',
      fields: [{ name: 'password', type: 'secret', storage: 'values', required: true }],
    } as any;
    const google = { agent: 'drive', agent_name: 'Drive', id: 'account', label: 'Account', fields: [], oauth: { provider: 'google' } } as any;

    it('fits where every required field is there by name and type, and an account only its own provider', () => {
      expect(fits(shape, sync)).toBeTrue();
      expect(fits(shape, other)).toBeFalse();
      expect(fits(shape, google)).toBeFalse();
      expect(fits({ ...google, agent: 'gmail' }, google)).toBeTrue();
      expect(fits(null, other)).toBeTrue();
    });

    it('offers its own first, then the others that fit by name, and keeps any it already serves', () => {
      const choices = agentChoices({ agent: 'jira', resource: 'connection' }, [other, sync, shape, google],
        [{ agent: 'old', resource: 'key' }]);
      expect(choices.map((choice) => [choice.key, choice.name, choice.hint, choice.own])).toEqual([
        ['jira/connection', 'Jira', 'Made for it', true],
        ['sync/token', 'Sync', 'Token', false],
        ['old/key', 'Old', 'key', false],
      ]);
    });
  });
});
