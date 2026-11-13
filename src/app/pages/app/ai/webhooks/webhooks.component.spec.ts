import { of } from 'rxjs';

import { WebhooksComponent } from './webhooks.component';

describe('WebhooksComponent', () => {
  function hook(id: string, more: any = {}) {
    return {
      webhook_id: id, name: id, path: `/hooks/${id}`, instruction: 'Do it', fields: { type: 'object' },
      enabled: true, chat_id: `chat_${id}`, trust: 0, require_signature: false,
      viewers: { groups: [], users: [] }, ...more,
    } as any;
  }

  function create(service: any = {}, confirm: any = {}) {
    const router = { events: of(), navigate: jasmine.createSpy('navigate').and.resolveTo(true) };
    const component = new WebhooksComponent(
      {
        list: async () => ({ webhooks: [hook('a')], shared: [hook('b', { role: 'viewer' })], handed: [], limit: 25 }),
        ...service,
      } as any,
      { peers: async () => ({ people: [{ user_id: 'u_ann', name: 'Ann', email: 'ann@x.test' }], groups: [], everyone: 'g0', mine: [] }) } as any,
      { can: () => true, user: { user_id: 'u_me' } } as any,
      router as any,
      { snapshot: { firstChild: null } } as any,
      {} as any,
      { ask: async () => true, ...confirm } as any,
    );
    return { component, router };
  }

  it('reads its own webhooks and those shared', async () => {
    const { component } = create();
    await component.ngOnInit();

    expect(component.webhooks.length).toBe(1);
    expect(component.shared.length).toBe(1);
    expect(component.foot).toBe('1 on · 1 of 25');
  });

  it('pages those shared on the server, keeping its own whole, and counts from the server', async () => {
    const asked: string[] = [];
    const { component } = create({
      list: async (after: string) => {
        asked.push(after);
        return {
          webhooks: [hook('a')], handed: [], limit: 25, total: 12,
          shared: after ? [hook('s10', { role: 'viewer' })] : Array.from({ length: 10 }, (_, i) => hook(`s${i}`, { role: 'viewer' })),
          next: after ? null : 's9', counts: { webhooks: 1, on: 1, signed: 0, shared: 12, handed: 0 },
        };
      },
    });
    await component.ngOnInit();
    expect(component.shared.length).toBe(10);
    expect(component.sharedPages.total).toBe(12);

    await component.sharedPages.go(2);
    expect(asked).toEqual(['', 's9']);
    expect(component.shared.map((one) => one.webhook_id)).toEqual(['s10']);
    expect(component.webhooks.length).toBe(1);
  });

  it('says the list could not be read instead of showing it empty', async () => {
    const { component } = create({ list: async () => ({ webhooks: [], shared: [], handed: [], limit: 0, error: 'Not allowed.' }) });
    await component.ngOnInit();

    expect(component.loadError).toBe('Not allowed.');
  });

  it('deletes a webhook only once that was agreed to, and says where its chat went', async () => {
    let removed = '';
    let answer = false;
    const { component } = create(
      { remove: async (id: string) => { removed = id; return {}; } },
      { ask: async () => answer },
    );
    await component.ngOnInit();

    await component.remove(component.webhooks[0]);
    expect(removed).toBe('');
    answer = true;
    await component.remove(component.webhooks[0]);
    expect(removed).toBe('a');
    expect(component.webhooks).toEqual([]);
    expect(component.notice).toContain('archived');
  });

  it('hands a webhook over, and takes one handed over, its chat with it', async () => {
    const calls: string[] = [];
    let handed = [hook('c', { role: 'handed', owner: { user_id: 'u_ann', name: 'Ann' } })];
    const { component } = create({
      list: async () => ({ webhooks: [hook('a')], shared: [], handed, limit: 25 }),
      transfer: async (id: string, user: string) => { calls.push(`transfer ${id} ${user}`); return {}; },
      accept: async (id: string, yes: boolean) => { calls.push(`accept ${id} ${yes}`); handed = []; return {}; },
    });
    await component.ngOnInit();
    expect(component.handed.map((one) => one.webhook_id)).toEqual(['c']);

    component.handing = component.webhooks[0];
    await component.handOver({ user_id: 'u_ann', name: 'Ann', email: 'ann@x.test' });
    expect(component.handing).toBeNull();
    expect(component.notice).toContain('once they accept');

    await component.accept(component.handed[0], true);
    expect(calls).toEqual(['transfer a u_ann', 'accept c true']);
    expect(component.handed).toEqual([]);
  });

  it('shares with viewers, never naming the owner among them', async () => {
    let sent: any = null;
    const { component } = create({
      share: async (_id: string, viewers: any) => { sent = viewers; return { webhook: hook('a', { viewers }) }; },
    });
    await component.ngOnInit();

    component.openShare(component.webhooks[0]);
    component.share.mode = 'people';
    component.share.toggleUser('u_ann');
    await component.saveShare();

    expect(sent).toEqual({ groups: [], users: ['u_ann'] });
    expect(component.webhooks[0].viewers?.users).toEqual(['u_ann']);
  });
});
