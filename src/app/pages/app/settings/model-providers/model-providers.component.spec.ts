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
  // What the catalog knows Anthropic to offer, newest first; it knows nothing of the others here.
  const claude = [{ id: 'claude-sonnet-5-5', name: 'Claude Sonnet 5.5' }, { id: 'claude-opus-5-5', name: 'Claude Opus 5.5' }];
  /** Until what the form asked for in the background has come. */
  const settled = () => new Promise((resolve) => setTimeout(resolve));

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
        models: async (id: string) => (id === 'anthropic' ? claude : []),
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

  it('sends the search to the page, which asks the server, and shows the rows it read', () => {
    const component = create([connection('Work'), connection('Home', { provider: 'together', address: 'https://api.together.xyz/v1' })]);
    const searched: string[] = [];
    component.searched.subscribe((query) => searched.push(query));

    component.onSearch('together');
    expect(searched).toEqual(['together']);
    expect(component.query).toBe('together');
    expect(component.visible.length).toBe(2);
    component.clearSearch();
    expect(searched).toEqual(['together', '']);
  });

  it('counts from the server where it counts, else from the rows given', () => {
    const component = create([connection('Work', { default: true }), connection('Home', { models: [] })]);
    expect([component.connectionCount, component.defaultName, component.modelCount, component.withoutModel])
      .toEqual([2, 'Work', 1, 1]);

    component.connectionTotal = 40;
    component.counts = { connections: 40, models: 55, without_models: 3, default_name: 'Main' };
    expect([component.connectionCount, component.defaultName, component.modelCount, component.withoutModel])
      .toEqual([40, 'Main', 55, 3]);
  });

  it('says a row’s provider, where it is, its models, and whose chats may use it', () => {
    const component = create();

    expect(component.summary(connection('Work'))).toBe('Anthropic · api.anthropic.com · claude-sonnet-5');
    expect(component.summary(connection('Anthropic', { models: [] }))).toBe('api.anthropic.com');
    expect(component.summary(connection('Work', { models: ['a', 'b', 'c'] })))
      .toBe('Anthropic · api.anthropic.com · a +2 more');
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

  it('asks only for the key once a provider is chosen, with the newest model chosen, shared with everyone', async () => {
    const calls: Record<string, any> = {};
    const component = create([], calls);
    component.startCreate();
    component.selectProvider(provider('anthropic'));
    await settled();

    expect(component.draft.address).toBe('https://api.anthropic.com');
    expect(component.draft.name).toBe('Anthropic');
    expect(component.draft.model).toBe('claude-sonnet-5-5');
    expect(component.models).toEqual(claude);
    expect(component.sharing).toBe('everyone');
    expect(component.blocker).toBe('Paste the API key.');

    component.setKey('sk-ant');
    await component.save();

    expect(calls['created']).toEqual([{
      name: 'Anthropic', provider: 'anthropic', address: 'https://api.anthropic.com', models: ['claude-sonnet-5-5'],
      groups: ['g0'], key: 'sk-ant',
    }]);
  });

  it('sends the default model first, then the others people may pick', async () => {
    const calls: Record<string, any> = {};
    const component = create([], calls);
    component.startEdit(connection('Work', { models: ['a', 'b', 'c'] }));

    expect(component.draft.model).toBe('a');
    expect(component.draft.others).toEqual(['b', 'c']);
    component.setModel('c');
    await component.save();
    expect(calls['updated'][0][1].models).toEqual(['c', 'b']);

    component.startEdit(connection('Empty', { models: [] }));
    component.setModel('');
    expect(component.blocker).toBe('Choose the model chats use.');
  });

  it('suggests a few of the catalog’s models not offered yet, each added with a click', async () => {
    const component = create();
    component.startCreate();
    component.selectProvider(provider('anthropic'));
    await settled();

    expect(component.suggested.map((model) => model.id)).toEqual(['claude-opus-5-5']);
    component.addOther('claude-opus-5-5');
    expect(component.draft.others).toEqual(['claude-opus-5-5']);
    expect(component.suggested).toEqual([]);
  });

  it('shares with everyone, or with the groups picked', () => {
    const component = create();
    component.startCreate();
    component.selectProvider(provider('anthropic'));

    component.setSharing('some');
    expect(component.draft.groups).toEqual([]);
    expect(component.someGroups.map((group) => group.group_id)).toEqual(['g1']);
    component.toggleGroup('g1');
    expect(component.draft.groups).toEqual(['g1']);
    expect(component.sharing).toBe('some');
    component.setSharing('everyone');
    expect(component.draft.groups).toEqual(['g0']);
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

  it('asks Azure for its endpoint whole, as the portal shows it, and keeps it as pasted', async () => {
    const calls: Record<string, any> = {};
    const component = create([], calls);
    const azure = { id: 'azure', name: 'Azure', protocol: 'openai',
                    endpoint: 'https://<azure-resource-name>.openai.azure.com/openai/v1' } as any;
    component.providers = [...catalog, azure];
    component.startCreate();
    component.selectProvider(azure);
    await settled();

    expect(component.asksEndpoint).toBeTrue();
    expect(component.blanks).toEqual([]);
    expect(component.draft.address).toBe('');
    expect(component.blocker).toBe('Paste your endpoint.');

    component.setEndpoint('https://foundry-dirir.cognitiveservices.azure.com/openai/v1/');
    component.setKey('k');
    expect(component.blocker).toBe('Choose the model chats use.');
    component.setModel('gpt-5.6-sol');
    await component.save();
    expect(calls['created'][0].address).toBe('https://foundry-dirir.cognitiveservices.azure.com/openai/v1/');
    expect(calls['created'][0].name).toBe('Azure');

    component.startEdit(connection('Azure', {
      provider: 'azure', address: 'https://foundry-dirir.cognitiveservices.azure.com/openai/v1/',
    }));
    expect(component.blanks).toEqual([]);
    expect(component.draft.address).toBe('https://foundry-dirir.cognitiveservices.azure.com/openai/v1/');
  });

  it('saves a server of one’s own with no key, and names it after where it is', async () => {
    const calls: Record<string, any> = {};
    const component = create([], calls);
    component.startCreate();
    component.selectProvider(provider('openai_compatible'));
    component.setEndpoint(component.ownServers[0].address);
    component.setModel('llama3.2');

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

  it('tests the connection as the form says it, saved or not, and says in the form whether it answered', async () => {
    const asked: any[] = [];
    const component = create([], {}, {
      check: async (draft: any, id: string) => {
        asked.push([id, draft]);
        return { ok: true, models: ['claude-sonnet-5', 'claude-new'], error: '' };
      },
    });
    component.startEdit(connection('Work'));
    await settled();

    await component.test();
    expect(asked[0][0]).toBe(component.editingId);
    expect(asked[0][1].key).toBeUndefined();
    expect(asked[0][1].models).toEqual(['claude-sonnet-5']);
    expect(component.tested).toEqual({ ok: true, text: 'It answered.' });
    expect(component.models.map((model) => model.id)).toContain('claude-new');

    component.setKey('sk-other');
    expect(component.tested).toBeNull();
  });

  it('takes the model a test found answering when none was chosen', async () => {
    const component = create([], {}, {
      check: async () => ({ ok: true, models: ['llama3.2', 'qwen3'], error: '' }),
    });
    component.startCreate();
    component.selectProvider(provider('openai_compatible'));
    component.setEndpoint(component.ownServers[0].address);

    await component.test();
    expect(component.draft.model).toBe('llama3.2');
  });

  it('says in the form why a test did not answer', async () => {
    const component = create([], {}, { check: async () => ({ ok: false, models: [], error: '401 Unauthorized' }) });
    component.startEdit(connection('Work'));

    await component.test();
    expect(component.tested).toEqual({ ok: false, text: 'It did not answer: 401 Unauthorized.' });
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
