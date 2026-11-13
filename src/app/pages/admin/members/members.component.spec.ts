import { fakeAsync, flush, tick } from '@angular/core/testing';

import { MembersComponent } from './members.component';

describe('MembersComponent', () => {
  const person = (id: string, more: any = {}) => ({
    user_id: id, email: `${id}@x.test`, name: id.toUpperCase(), groups: [], status: 'active', ...more,
  });
  const ADMINS = { group_id: 'g_admins', name: 'Administrators', everyone: false, administrators: true };

  function create(over: any = {}) {
    const asked: any[] = [];
    const members = {
      page: async (after: string, limit: number, filters: any) => {
        asked.push({ after, limit, ...filters });
        const rows = filters.status === 'active'
          ? [person('ann'), person('me'), person('bo')]
          : after ? [person('zed')] : [person('ann', { groups: ['g_admins'] }), person('bo')];
        return {
          rows, next: after || filters.status ? null : 'bo', total: 21, error: undefined,
          counts: { people: 66, administrators: 3, held: 2 }, groups: [ADMINS],
        };
      },
      invitations: async () => ({ rows: [], next: null, total: 4, groups: [] }),
      leaving: async () => ({ counts: { chats: 1 } }),
      ...over,
    };
    const component = new MembersComponent(
      members as any,
      { page: async () => ({ rows: [], next: null, total: 0, counts: { groups: 0, own: 0 }, policies: [] }) } as any,
      { can: () => true, user: { user_id: 'me' }, sendsEmail: true, setupStatus: async () => undefined } as any,
      { open: () => ({ afterClosed: () => ({ subscribe: () => undefined }), close: () => undefined }) } as any,
      { ask: async () => true } as any,
    );
    return { component, asked };
  }

  it('shows the server’s numbers of everyone, whatever the page shows', async () => {
    const { component } = create();
    await component.ngOnInit();

    expect(component.shown.length).toBe(2);
    expect([component.peopleCount, component.adminCount, component.heldCount]).toEqual([66, 3, 2]);
    expect(component.invitationPages.total).toBe(4);
    // The page's groups come with it: rows are named, and an administrator known.
    expect(component.isAdmin(component.shown[0])).toBeTrue();
    expect(component.isAdmin(component.shown[1])).toBeFalse();
    expect(component.groupList(['g_admins'])).toEqual(['Administrators']);
  });

  it('pages and searches on the server', fakeAsync(() => {
    const { component, asked } = create();
    void component.ngOnInit();
    flush();
    void component.pages.go(2);
    flush();
    expect(asked[1]).toEqual({ after: 'bo', limit: 20, q: '' });
    expect(component.shown.map((one) => one.user_id)).toEqual(['zed']);

    component.onSearch('an');
    component.onSearch('ann');
    tick(300);
    flush();
    expect(asked.length).toBe(3);
    expect(asked[2]).toEqual({ after: '', limit: 20, q: 'ann' });
    expect(component.pages.page).toBe(1);
  }));

  it('finds a successor among the active people, on the server, never the one leaving or oneself', fakeAsync(() => {
    const { component, asked } = create();
    void component.ngOnInit();
    flush();

    void component.requestRemove(person('bo') as any);
    flush();
    expect(asked[asked.length - 1]).toEqual({ after: '', limit: 20, status: 'active', q: '' });
    expect(component.successorChoices.map((choice) => choice.value)).toEqual(['', 'ann']);

    component.successorId = 'ann';
    component.onSuccessorSearch('zz');
    tick(300);
    flush();
    expect(asked[asked.length - 1].q).toBe('zz');
    // The one chosen stays offered while the search changes.
    expect(component.successorChoices.map((choice) => choice.value)).toEqual(['', 'ann']);
    component.ngOnDestroy();
  }));

  it('says why the people could not be read', async () => {
    const { component } = create({
      page: async () => ({ rows: [], next: null, total: 0, error: 'Not allowed.', counts: {}, groups: [] }),
    });
    await component.ngOnInit();

    expect(component.error).toBe('Not allowed.');
  });
});
