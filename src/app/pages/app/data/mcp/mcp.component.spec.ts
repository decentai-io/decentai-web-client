import { McpComponent } from './mcp.component';
import { CredentialDraft, toolsWord } from './mcp-shared';

describe('McpComponent', () => {
  const ME = 'u1';

  function server(id: string, more: any = {}) {
    return {
      id, name: id, address: `https://${id}.test/mcp`, tools: [], owner: { groups: [], users: [ME] },
      created_by: ME, handing: null, ...more,
    } as any;
  }

  function create(listed: any = { items: [], handed: [] }, service: any = {}, confirm: any = {}) {
    const went: any[] = [];
    const component = new McpComponent(
      { list: async () => listed, refresh: async () => ({}), remove: async () => ({}), ...service } as any,
      { peers: async () => ({ people: [], groups: [], everyone: 'g0', mine: [] }) } as any,
      { can: () => true, user: { user_id: ME } } as any,
      { navigate: async (...args: any[]) => { went.push(args); return true; } } as any,
      { open: () => ({ afterClosed: () => ({ subscribe() {} }), close() {} }) } as any,
      { ask: async () => true, ...confirm } as any,
    );
    return { component, went };
  }

  it('says what a server offers, and that it was not read yet', () => {
    expect(toolsWord(server('a'))).toBe('Not read yet');
    expect(toolsWord(server('a', { read_at: '2026-10-01T00:00:00Z',
      tools: [{ name: 'find', description: '', on: true }, { name: 'wipe', description: '', on: false }] })))
      .toBe('2 tools, 1 on');
  });

  it('turns a credential into the headers a server is reached with', () => {
    const credential = new CredentialDraft();
    expect(credential.headers()).toEqual({});
    credential.kind = 'token';
    credential.token = ' abc ';
    expect(credential.headers()).toEqual({ Authorization: 'Bearer abc' });
    credential.kind = 'header';
    credential.header = 'X-Api-Key';
    credential.value = 'k';
    expect(credential.headers()).toEqual({ 'X-Api-Key': 'k' });
  });

  it('does not show a list that could not be read as an empty one', async () => {
    const { component } = create({ items: [], handed: [], error: 'The servers could not be read.' });
    await component.ngOnInit();
    expect(component.loadProblem).toBe('The servers could not be read.');
  });

  it('adds a server with its headers, and opens it to read its tools', async () => {
    let sent: any;
    const { component, went } = create(undefined, {
      create: async (fields: any) => { sent = fields; return { item: server('wiki') }; },
    });
    component.formName = 'Wiki';
    component.formUrl = 'https://wiki.test/mcp';
    component.credential.kind = 'token';
    component.credential.token = 'abc';

    await component.add();

    expect(sent).toEqual({ name: 'Wiki', address: 'https://wiki.test/mcp', headers: { Authorization: 'Bearer abc' } });
    expect(went[0][0]).toEqual(['/data/mcp', 'wiki']);
    expect(went[0][1].state.mcpAdded).toBeTrue();
  });

  it('says why the organization refused a server, in the dialog', async () => {
    const { component } = create(undefined, {
      create: async () => ({ error: 'This organization doesn\'t allow MCP servers.' }),
    });
    component.formName = 'Wiki';
    component.formUrl = 'https://wiki.test/mcp';
    await component.add();
    expect(component.addProblem).toContain('doesn\'t allow MCP servers');
  });

  it('changes only the servers that are the person\'s own', async () => {
    const { component } = create({ items: [server('a'), server('b', { created_by: 'u2' })], handed: [] });
    await component.ngOnInit();
    expect(component.mine(component.servers[0])).toBeTrue();
    expect(component.mine(component.servers[1])).toBeFalse();
  });

  it('removes a server only once that was agreed to', async () => {
    let removed = '';
    let answer = false;
    const { component } = create({ items: [server('a')], handed: [] },
      { remove: async (id: string) => { removed = id; return {}; } }, { ask: async () => answer });
    await component.ngOnInit();

    await component.askRemove(component.servers[0]);
    expect(removed).toBe('');
    answer = true;
    await component.askRemove(component.servers[0]);
    expect(removed).toBe('a');
    expect(component.servers).toEqual([]);
  });
});
