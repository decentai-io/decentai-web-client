import { GroupsComponent } from './groups.component';

describe('GroupsComponent', () => {
  const group = (id: string, more: any = {}) => ({
    group_id: id, name: id, policies: [], everyone: false, administrators: false, members: 2, ...more,
  });

  function create() {
    const asked: any[] = [];
    const groups = {
      page: async (after: string, limit: number, q: string) => {
        asked.push({ endpoint: 'groups', after, limit, q });
        return {
          rows: [group('Everyone', { everyone: true, policies: ['member'] }), group('Analysts', { policies: ['p_read'] })],
          next: null, total: 2, counts: { groups: 40, own: 38 },
          policies: [{ policy_id: 'member', name: 'Member', built_in: true }, { policy_id: 'p_read', name: 'Readers', built_in: false }],
        };
      },
      get: async (groupId: string, after: string) => {
        asked.push({ endpoint: 'people', groupId, after });
        return after
          ? { group: null, rows: [{ user_id: 'u3', name: 'Cy', email: 'cy@x.test' }], next: null, total: 3 }
          : { group: null, rows: [{ user_id: 'u1' }, { user_id: 'u2' }], next: 'u2', total: 3 };
      },
    };
    const policies = {
      page: async (after: string, limit: number, q: string) => {
        asked.push({ endpoint: 'policies', after, limit, q });
        return { rows: [{ policy_id: 'p_write', name: 'Writers', built_in: false, statements: [] }], next: null, total: 12, catalog: [] };
      },
    };
    const component = new GroupsComponent(
      groups as any, policies as any, { can: () => true, refresh: async () => true } as any,
      { open: () => ({ afterClosed: () => ({ subscribe: () => undefined }), close: () => undefined }) } as any,
      { ask: async () => true } as any,
    );
    return { component, asked };
  }

  it('counts the groups and the policies on the server, and names the policies a page gives', async () => {
    const { component, asked } = create();
    await component.ngOnInit();

    expect([component.counts.groups, component.ownCount, component.policyCount]).toEqual([40, 38, 12]);
    expect(asked.find((ask) => ask.endpoint === 'policies')).toEqual(jasmine.objectContaining({ after: '', limit: 1 }));
    expect(component.summarise(component.groups[1])).toBe('2 people · Readers');
    expect(component.summarise(component.groups[0])).toBe('Every person · Member');
  });

  it('offers the policies to give from a search of the server, named as it answers', async () => {
    const { component, asked } = create();
    await component.ngOnInit();

    const found = await component.searchPolicies('wri', '', 20);
    expect(asked[asked.length - 1]).toEqual({ endpoint: 'policies', after: '', limit: 20, q: 'wri' });
    expect(found.rows).toEqual([{ id: 'p_write', name: 'Writers', hint: '' }]);
    expect(component.policyName('p_write')).toBe('Writers');
  });

  it('shows a group’s people a page at a time', async () => {
    const { component, asked } = create();
    await component.ngOnInit();

    await component.startEdit(component.groups[1]);
    expect(component.people?.rows.length).toBe(2);
    expect(component.people?.total).toBe(3);
    expect(component.chosenPolicies).toEqual([{ id: 'p_read', name: 'Readers' }]);

    await component.people?.more();
    expect(asked[asked.length - 1]).toEqual({ endpoint: 'people', groupId: 'Analysts', after: 'u2' });
    expect(component.people?.rows.length).toBe(3);
  });
});
