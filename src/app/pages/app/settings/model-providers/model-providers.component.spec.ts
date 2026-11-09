import { ModelProvidersComponent } from './model-providers.component';

describe('ModelProvidersComponent', () => {
  function connection(name: string, overrides: any = {}) {
    return {
      connection_id: `c_${name}`, name, provider: 'anthropic', address: 'https://api.anthropic.com',
      models: ['claude-sonnet-5'], groups: ['g0'], key: true, default: false, ...overrides,
    } as any;
  }

  // A few entries in the shape Settings:Llm:providers serves.
  const catalog = [
    { id: 'anthropic', name: 'Anthropic', protocol: 'anthropic', endpoint: 'https://api.anthropic.com', popular: 1 },
    { id: 'openrouter', name: 'OpenRouter', protocol: 'openai', endpoint: 'https://openrouter.ai/api/v1', popular: 3 },
    { id: 'together', name: 'Together AI', protocol: 'openai', endpoint: 'https://api.together.xyz/v1' },
    { id: 'amazon-bedrock', name: 'Amazon Bedrock', protocol: 'bedrock', endpoint: 'https://bedrock-runtime.<aws-region>.amazonaws.com', popular: 2 },
    { id: 'openai_compatible', name: 'Custom / OpenAI-compatible', protocol: 'openai', endpoint: '' },
  ] as any[];
  const provider = (id: string) => catalog.find((entry) => entry.id === id);
  const groups = [{ group_id: 'g0', name: 'Everyone' }, { group_id: 'g1', name: 'Design' }];

  function create(connections: any[] = [], calls: Record<string, any> = {}, service: any = {}) {
    const component = new ModelProvidersComponent(
      {
        create: async (draft: any) => {
          (calls['created'] ??= []).push(draft);
          return { connection: connection(draft.name) };
        },
        update: async (id: string, draft: any) => {
          (calls['updated'] ??= []).push([id, draft]);
          return { connection: connection(draft.name) };
        },
        setDefault: async (id: string) => {
          (calls['defaulted'] ??= []).push(id);
          return {};
        },
        remove: async (id: string) => {
          (calls['removed'] ??= []).push(id);
          return {};
        },
        check: async () => ({ ok: true, models: ['claude-sonnet-5', 'claude-opus-5-5'], error: '' }),
        ...service,
      } as any,
      { can: () => true } as any,
      undefined,
      { ask: async () => calls['sure'] ?? true } as any,
    );
    component.connections = connections;
    component.providers = catalog;
    component.groups = groups;
    return component;
  }

  it('filters across the name, the provider and the address', () => {
    const component = create([connection('Work'), connection('Home', { provider: 'together', address: 'https://api.together.xyz/v1' })]);

    component.query = 'together';
    expect(component.visible.map((c) => c.name)).toEqual(['Home']);
  });

  it('says a row’s provider, where it is and its models, and whose chats may use it', () => {
    const component = create();

    expect(component.summary(connection('Work'))).toBe('Anthropic · api.anthropic.com · 1 model');
    expect(component.summary(connection('Anthropic', { models: [] }))).toBe('api.anthropic.com · the provider’s models');
    expect(component.shareLabel(connection('Work'))).toBe('Everyone');
    expect(component.shareLabel(connection('Work', { groups: ['g1'] }))).toBe('1 group');
    expect(component.shareLabel(connection('Work', { groups: [] }))).toBe('Nobody yet');
  });

  it('offers the popular few first, the rest behind a search, and a server of one’s own apart', () => {
    const component = create();

    expect(component.offered.map((p) => p.id)).toEqual(['anthropic', 'amazon-bedrock', 'openrouter']);
    component.providerQuery = 'toge';
    expect(component.offered.map((p) => p.id)).toEqual(['together']);
    expect(component.custom?.id).toBe('openai_compatible');
  });

  it('asks only for the key once a provider is chosen, and shares a new one with everyone', async () => {
    const calls: Record<string, any> = {};
    const component = create([], calls);
    component.startCreate();
    component.selectProvider(provider('anthropic'));

    expect(component.draft.address).toBe('https://api.anthropic.com');
    expect(component.draft.name).toBe('Anthropic');
    expect(component.draft.groups).toEqual(['g0']);
    expect(component.blocker).toBe('Paste the API key.');

    component.draft.key = 'sk-ant';
    component.draft.models = ['claude-sonnet-5'];
    await component.save();

    expect(calls['created']).toEqual([{
      name: 'Anthropic', provider: 'anthropic', address: 'https://api.anthropic.com', models: ['claude-sonnet-5'],
      groups: ['g0'], key: 'sk-ant',
    }]);
  });

  it('names a second connection to the same provider apart from the first', () => {
    const component = create([connection('Anthropic')]);
    component.startCreate();
    component.selectProvider(provider('anthropic'));

    expect(component.draft.name).toBe('Anthropic 2');
  });

  it('asks for a region by name instead of an address to edit, and finds it again on an edit', () => {
    const component = create();
    component.startCreate();
    component.selectProvider(provider('amazon-bedrock'));

    expect(component.blanks).toEqual(['aws-region']);
    expect(component.draft.address).toBe('https://bedrock-runtime.us-east-1.amazonaws.com');
    component.setBlank('aws-region', 'eu-west-1');
    expect(component.draft.address).toBe('https://bedrock-runtime.eu-west-1.amazonaws.com');

    component.startEdit(connection('Bedrock', {
      provider: 'amazon-bedrock', address: 'https://bedrock-runtime.eu-central-1.amazonaws.com',
    }));
    expect(component.blankValues).toEqual({ 'aws-region': 'eu-central-1' });
  });

  it('saves a server of one’s own with no key, and names it after where it is', async () => {
    const calls: Record<string, any> = {};
    const component = create([], calls);
    component.startCreate();
    component.selectProvider(provider('openai_compatible'));
    component.setEndpoint(component.ownServers[0].address);

    expect(component.draft.name).toBe('host.docker.internal:11434');
    await component.save();
    expect(calls['created'][0].key).toBeUndefined();
  });

  it('keeps the key on an edit left blank, and asks for it again at a new address', async () => {
    const calls: Record<string, any> = {};
    const component = create([], calls);
    component.startEdit(connection('Work'));

    expect(component.draft.key).toBe('');
    await component.save();
    expect(calls['updated'][0][0]).toBe('c_Work');
    expect(calls['updated'][0][1].key).toBeUndefined();

    component.startEdit(connection('Work'));
    component.setEndpoint('https://gateway.example.com');
    expect(component.blocker).toBe('Give the key again: it is sent to the new address.');
  });

  it('checks the connection as the form says it, saved or not, and offers the models it finds', async () => {
    const asked: any[] = [];
    const component = create([], {}, {
      check: async (draft: any, id: string) => {
        asked.push([id, draft]);
        return { ok: true, models: ['claude-sonnet-5', 'claude-opus-5-5'], error: '' };
      },
    });
    component.startEdit(connection('Work'));

    await component.checkForm();
    expect(asked[0][0]).toBe(component.editingId);
    expect(asked[0][1].key).toBeUndefined();
    expect(component.offeredModels).toEqual(['claude-opus-5-5']);

    component.addModel('claude-opus-5-5');
    expect(component.draft.models).toEqual(['claude-sonnet-5', 'claude-opus-5-5']);
    expect(component.offeredModels).toEqual([]);
  });

  it('says whether a connection answered a runtime', async () => {
    const component = create([], {}, { check: async () => ({ ok: false, models: [], error: '401 Unauthorized' }) });

    await component.check(connection('Work'));

    expect(component.error).toContain('401 Unauthorized');
  });

  it('never re-sets the default that already is', async () => {
    const calls: Record<string, any> = {};
    const component = create([], calls);

    await component.makeDefault(connection('Work', { default: true }));
    expect(calls['defaulted']).toBeUndefined();

    await component.makeDefault(connection('Work'));
    expect(calls['defaulted']).toEqual(['c_Work']);
  });

  it('asks before removing, and removes only on a yes', async () => {
    const calls: Record<string, any> = { sure: false };
    const component = create([], calls);

    await component.askRemove(connection('Work'));
    expect(calls['removed']).toBeUndefined();

    calls['sure'] = true;
    await component.askRemove(connection('Work'));
    expect(calls['removed']).toEqual(['c_Work']);
  });

  it('says what is missing under its field, once Save was pressed', async () => {
    const component = create();
    component.startCreate();
    component.selectProvider(provider('anthropic'));

    expect(component.errorFor('key')).toBe('');
    await component.save();
    expect(component.errorFor('key')).toBe('Paste the API key.');
  });
});
