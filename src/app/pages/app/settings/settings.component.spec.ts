import { fakeAsync, flush, tick } from '@angular/core/testing';

import { SettingsComponent } from './settings.component';

describe('SettingsComponent (Model providers)', () => {
  function connection(name: string) {
    return { connection_id: `c_${name}`, name, provider: 'anthropic', address: '', models: [], groups: [] } as any;
  }

  const peers = async () => ({ people: [], groups: [{ group_id: 'g1', name: 'Design' }], everyone: 'g0', mine: [] });

  /** Settings:Llm:list as the API server pages it: `q` in a name. */
  function service(connections: any[], asked: any[] = []) {
    return {
      page: async (after: string, limit: number, filters: any) => {
        asked.push({ after, limit, ...filters });
        const kept = connections.filter((one) => one.name.toLowerCase().includes((filters.q ?? '').toLowerCase()));
        return { rows: kept.slice(), next: null, total: kept.length, counts: null };
      },
      providers: async () => [],
    };
  }

  it('reads the connections and reads them again when one was changed', async () => {
    const connections = [connection('Anthropic')];
    const component = new SettingsComponent(service(connections) as any, { peers } as any, { can: () => false } as any);
    await component.ngOnInit();
    expect(component.connections.map((c) => c.name)).toEqual(['Anthropic']);
    expect(component.all).toBe(1);

    connections.push(connection('OpenAI'));
    await component.reload();
    expect(component.connections.map((c) => c.name)).toEqual(['Anthropic', 'OpenAI']);
  });

  it('lists every connection to an administrator, and offers Everyone first to share with', async () => {
    const asked: any[] = [];
    const component = new SettingsComponent(
      service([], asked) as any,
      { peers } as any,
      { can: (action: string) => action === 'settings:llm:create' } as any,
    );

    await component.ngOnInit();

    expect(asked).toEqual([{ after: '', limit: 20, q: '', all: true }]);
    expect(component.groups).toEqual([{ group_id: 'g0', name: 'Everyone' }, { group_id: 'g1', name: 'Design' }]);
  });

  it('asks the server for the search once the typing stops, keeping the count of all', fakeAsync(() => {
    const asked: any[] = [];
    const component = new SettingsComponent(
      service([connection('Anthropic'), connection('OpenAI')], asked) as any, { peers } as any, { can: () => false } as any,
    );
    void component.ngOnInit();
    flush();

    component.search('open');
    tick(300);
    flush();
    expect(asked[asked.length - 1].q).toBe('open');
    expect(component.connections.map((c) => c.name)).toEqual(['OpenAI']);
    expect(component.all).toBe(2);
    component.ngOnDestroy();
  }));
});
