import { SettingsComponent } from './settings.component';

describe('SettingsComponent (Model providers)', () => {
  function connection(name: string) {
    return { connection_id: `c_${name}`, name, provider: 'anthropic', address: '', models: [], groups: [] } as any;
  }

  const peers = async () => ({ people: [], groups: [{ group_id: 'g1', name: 'Design' }], everyone: 'g0', mine: [] });

  it('reads the connections and reads them again when one was changed', async () => {
    const connections = [connection('Anthropic')];
    const component = new SettingsComponent(
      { list: async () => connections.slice(), providers: async () => [] } as any,
      { peers } as any,
      { can: () => false } as any,
    );
    await component.ngOnInit();
    expect(component.connections.map((c) => c.name)).toEqual(['Anthropic']);

    connections.push(connection('OpenAI'));
    await component.reload();
    expect(component.connections.map((c) => c.name)).toEqual(['Anthropic', 'OpenAI']);
  });

  it('lists every connection to an administrator, and offers Everyone first to share with', async () => {
    const asked: boolean[] = [];
    const component = new SettingsComponent(
      { list: async (all = false) => { asked.push(all); return []; }, providers: async () => [] } as any,
      { peers } as any,
      { can: (action: string) => action === 'settings:llm:create' } as any,
    );

    await component.ngOnInit();

    expect(asked).toEqual([true]);
    expect(component.groups).toEqual([{ group_id: 'g0', name: 'Everyone' }, { group_id: 'g1', name: 'Design' }]);
  });
});
