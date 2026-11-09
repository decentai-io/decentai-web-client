import { OutboundComponent } from './outbound.component';

describe('OutboundComponent', () => {
  function address(id: string, more: any = {}) {
    return {
      id, name: id, url: 'https://example.test/in', format: 'json', events: ['reply.ready'],
      include_reply: false, paused: false, ...more,
    } as any;
  }

  function create(service: any = {}) {
    return new OutboundComponent(
      {
        list: async () => ({ addresses: [address('s')], events: [], formats: [] }),
        ...service,
      } as any,
      { can: () => true } as any,
      {} as any,
      { ask: async () => true } as any,
    );
  }

  it('reads the list, against the most a person keeps', async () => {
    const component = create();
    await component.ngOnInit();

    expect(component.addresses.length).toBe(1);
    expect(component.foot).toBe('1 of 10');
  });

  it('says the list could not be read instead of showing it empty', async () => {
    const component = create({
      list: async () => ({ addresses: [], events: [], formats: [], error: 'Not allowed.' }),
    });
    await component.ngOnInit();

    expect(component.loadError).toBe('Not allowed.');
  });

  it('pauses and resumes an address by its switch', async () => {
    const sent: any[] = [];
    const component = create({
      update: async (id: string, changes: any) => {
        sent.push(changes);
        return { address: address(id, changes) };
      },
    });
    await component.ngOnInit();

    await component.setOn(component.addresses[0], false);
    expect(sent).toEqual([{ paused: true }]);
    expect(component.addresses[0].paused).toBeTrue();
  });

  it('says a test is on its way, or why it was refused', async () => {
    const component = create({ test: async () => ({ error: 'Too many calls that reach outside.' }) });
    await component.ngOnInit();

    await component.test(component.addresses[0]);

    expect(component.error).toBe('Too many calls that reach outside.');
  });
});
