import { McpServerComponent } from './mcp-server.component';

describe('McpServerComponent', () => {
  const ME = 'u1';

  function tool(name: string, on = true) {
    return { name, description: `Does ${name}.`, on };
  }

  function server(tools: any[], more: any = {}) {
    return {
      id: 'mcp_1', name: 'Wiki', address: 'https://wiki.test/mcp', tools, read_at: '2026-10-01T00:00:00Z',
      owner: { groups: [], users: [ME] }, created_by: ME, handing: null, ...more,
    } as any;
  }

  async function create(stored: any, service: any = {}, confirm: any = {}) {
    const went: any[] = [];
    const component = new McpServerComponent(
      {
        get: async () => stored,
        update: async () => ({ item: stored }),
        refresh: async () => ({ item: stored }),
        remove: async () => ({}),
        ...service,
      } as any,
      { user: { user_id: ME } } as any,
      { snapshot: { paramMap: { get: () => 'mcp_1' }, queryParamMap: { get: () => null } } } as any,
      { navigate: async (...args: any[]) => { went.push(args); return true; } } as any,
      { open: () => ({ afterClosed: () => ({ subscribe() {} }), close() {} }) } as any,
      { ask: async () => true, ...confirm } as any,
    );
    await component.ngOnInit();
    return { component, went };
  }

  it('says a server that could not be opened could not be, and shows no tools', async () => {
    const { component } = await create(null);
    expect(component.problem).toContain('could not be opened');
    expect(component.tools).toEqual([]);
  });

  it('saves one tool on its own row, by its name, and says how it went there', async () => {
    const before = server([tool('search'), tool('wipe', false)]);
    const after = server([tool('search', false), tool('wipe', false)]);
    let sent: any;
    const { component } = await create(before, {
      update: async (_id: string, fields: any) => { sent = fields; return { item: after }; },
    });

    await component.setTool(component.tools[0], false);

    expect(sent).toEqual({ tools: { search: false } });
    expect(component.tools[0].on).toBeFalse();
    expect(component.saveOf(component.tools[0])).toBe('Saved');
    // The other row said nothing, and the page was not busy for it.
    expect(component.saveOf(component.tools[1])).toBe('');
    expect(component.busy).toBe('');
  });

  it('leaves a tool as it was when its save is refused, with the reason on its row', async () => {
    const { component } = await create(server([tool('search')]), {
      update: async () => ({ error: 'No such MCP server of yours.' }),
    });

    await component.setTool(component.tools[0], false);

    expect(component.tools[0].on).toBeTrue();
    expect(component.saveFailed(component.tools[0])).toBeTrue();
  });

  it('switches every tool in one save', async () => {
    let sent: any;
    const { component } = await create(server([tool('a'), tool('b')]), {
      update: async (_id: string, fields: any) => {
        sent = fields;
        return { item: server([tool('a', false), tool('b', false)]) };
      },
    });

    await component.setAll(false);

    expect(sent.tools).toEqual({ a: false, b: false });
    expect(component.onCount).toBe(0);
  });

  it('keeps the tools when a read fails, and says why', async () => {
    const { component } = await create(server([tool('search')]), {
      refresh: async () => ({ error: 'No runtime could be reached.' }),
    });

    await component.readAgain();

    expect(component.error).toBe('No runtime could be reached.');
    expect(component.tools.length).toBe(1);
  });

  it('says how many tools a read found that are new, and off', async () => {
    const { component } = await create(server([tool('search')]), {
      refresh: async () => ({ item: server([tool('search'), tool('wipe', false)]) }),
    });

    await component.readAgain();

    expect(component.notice).toContain('1 tool is new');
  });

  it('sends a new address with its credential again', async () => {
    let sent: any;
    const { component } = await create(server([tool('search')]), {
      update: async (_id: string, fields: any) => { sent = fields; return { item: server([]) }; },
    });

    component.changing = 'url';
    component.changeValue = 'https://wiki2.test/mcp';
    component.credential.kind = 'token';
    component.credential.token = 'abc';
    await component.saveChange();

    expect(sent).toEqual({ address: 'https://wiki2.test/mcp', headers: { Authorization: 'Bearer abc' } });
  });

  it('changes nothing of a server shared with the person', async () => {
    let called = false;
    const { component } = await create(server([tool('search')], { created_by: 'u2' }),
      { update: async () => { called = true; return {}; } });

    await component.setTool(component.tools[0], false);
    await component.setAll(false);

    expect(called).toBeFalse();
    expect(component.mine).toBeFalse();
  });

  it('goes back to the list after a removal that was agreed to', async () => {
    let answer = false;
    const { component, went } = await create(server([tool('search')]), {}, { ask: async () => answer });

    await component.askRemove();
    expect(went.length).toBe(0);

    answer = true;
    await component.askRemove();
    expect(went[0][0]).toEqual(['/data/mcp']);
    expect(went[0][1].state.mcpNotice).toBe('Wiki removed.');
  });
});
