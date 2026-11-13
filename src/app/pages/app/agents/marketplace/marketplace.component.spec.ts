import { MarketplaceComponent } from './marketplace.component';

describe('MarketplaceComponent', () => {
  function source(id: string, overrides: any = {}) {
    return {
      source_id: id, url: `https://${id}.example.com/catalog.json`, credential: false, name: `${id} agents`,
      digest: `sha256:${id}`, read_at: new Date().toISOString(), error: '', agents: 1, ...overrides,
    } as any;
  }

  function offer(id: string, sourceId = 's1', overrides: any = {}) {
    return {
      source_id: sourceId, digest: `sha256:${sourceId}`, status: 'not_installed', machines: ['x86_64'], base: '',
      readme: '', errors: [],
      manifest: { schema: 3, agent: { id, name: id, version: '2.0.0', description: '' }, functions: [] },
      ...overrides,
    } as any;
  }

  function create(sources: any[], offers: any[], service: any = {}, confirm: any = undefined) {
    return new MarketplaceComponent(
      {
        sources: async () => ({ sources, reference: '' }),
        available: async () => offers,
        installed: async () => [],
        ...service,
      } as any,
      undefined, undefined, undefined, confirm,
    );
  }

  it('keeps agents under the source they came from, the first source shown until another is chosen', async () => {
    const component = create([source('s1'), source('s2')], [offer('a'), offer('b', 's2')]);
    await component.ngOnInit();
    expect(component.current?.source_id).toBe('s1');
    expect(component.shownOffers.map((one) => component.idOf(one))).toEqual(['a']);
    expect(component.sourceName(source('s3', { name: '' }))).toBe('s3.example.com');
  });

  it('narrows the chosen source by search and by what is installed, and orders it', async () => {
    const component = create([source('s1')], [
      offer('zeta', 's1', { status: 'installed' }), offer('alpha'), offer('mid', 's1', { status: 'update_available' }),
    ]);
    await component.ngOnInit();

    expect(component.filterGroups[1].items.map((item) => [item.name, item.count]))
      .toEqual([['All agents', 3], ['Not installed', 1], ['Installed', 2], ['Update available', 1]]);
    component.setFilter('installed');
    expect(component.shownOffers.map((one) => component.idOf(one))).toEqual(['zeta', 'mid']);
    component.setFilter('all');
    component.setSort('name');
    expect(component.shownOffers.map((one) => component.idOf(one))).toEqual(['alpha', 'mid', 'zeta']);
    component.search('ZET');
    expect(component.shownOffers.length).toBe(1);
  });

  it('installs only what has no errors and is not this version, nor another source\'s', () => {
    const component = create([], []);
    expect(component.installable(offer('a'))).toBeTrue();
    expect(component.installable(offer('a', 's1', { status: 'update_available' }))).toBeTrue();
    expect(component.installable(offer('a', 's1', { status: 'installed' }))).toBeFalse();
    expect(component.installable(offer('a', 's1', { status: 'other_source' }))).toBeFalse();
    expect(component.installable(offer('a', 's1', { errors: ['no network block'] }))).toBeFalse();
    expect(component.offerChip(offer('a', 's1', { errors: ['x'] }))?.word).toBe('Cannot be installed');
    expect(component.offerChip(offer('a', 's1', { status: 'other_source' }))?.word).toBe('From another source');
  });

  it('reads an update against what is installed, and only an update', async () => {
    const installed = [{ agent_id: 'a', version: '1.0.0', manifest: { functions: [] } }];
    const component = create([source('s1')], [], { installed: async () => installed });
    await component.ngOnInit();
    expect(component.approvedOf(offer('a', 's1', { status: 'update_available' }))).toBe(installed[0].manifest as any);
    expect(component.approvedOf(offer('a'))).toBeNull();
    expect(component.offerFacts(offer('a', 's1', { status: 'update_available' }))).toContain('v1.0.0 installed');
  });

  it('puts the ticked agents under one review, and installs each pinned to what was reviewed', async () => {
    const install = jasmine.createSpy('install').and.resolveTo({ agent: { agent_id: 'b' } });
    const component = create([source('s1')], [offer('a'), offer('b'), offer('c', 's1', { status: 'installed' })], { install });
    await component.ngOnInit();
    const s1 = component.sources[0];
    component.toggleSelect(s1, component.offers[0]);
    component.toggleSelect(s1, component.offers[1]);
    expect(component.selectedCount(s1)).toBe(2);

    component.reviewSelected(s1);
    expect(component.review?.offers.length).toBe(2);
    expect(install).not.toHaveBeenCalled();
    expect(component.approveLabel).toBe('Install 2');

    await component.approve();
    expect(install.calls.allArgs().map(([one]) => one.manifest.agent.id)).toEqual(['a', 'b']);
    expect(component.review).toBeNull();
  });

  it('keeps a refused install under review, read again, with why', async () => {
    let digest = 'sha256:old';
    const component = create([source('s1')], [], {
      available: async () => [offer('a', 's1', { digest })],
      install: async () => { digest = 'sha256:new'; return { error: 'The source changed since it was reviewed: review it again.' }; },
    });
    await component.ngOnInit();
    component.openReview(component.sources[0], [component.offers[0]]);

    await component.approve();
    expect(component.error).toContain('review it again');
    expect(component.review?.offers[0].digest).toBe('sha256:new');
  });

  it('uninstalls a source\'s agents with it, and only once that was agreed to', async () => {
    const deleteSource = jasmine.createSpy('deleteSource').and.resolveTo({});
    const asked: any[] = [];
    let answer = false;
    const component = create([source('s1')], [], {
      deleteSource,
      installed: async () => [{ agent_id: 'a', name: 'Notes', version: '1.0.0', source_id: 's1' }],
    }, { ask: async (question: any) => { asked.push(question); return answer; } });
    await component.ngOnInit();

    await component.askRemove(component.sources[0]);
    expect(asked[0].body).toContain('Notes 1.0.0');
    expect(asked[0].confirm).toBe('Delete and uninstall 1');
    expect(deleteSource).not.toHaveBeenCalled();

    answer = true;
    await component.askRemove(component.sources[0]);
    expect(deleteSource).toHaveBeenCalledWith('s1');
  });

  it('stays in the form when a save is refused, and when a saved catalog could not be read', async () => {
    let sources = [source('s1')];
    const component = create([], [], {
      sources: async () => ({ sources, reference: '' }),
      createSource: async () => ({ error: 'That address is not public.' }),
    });
    await component.ngOnInit();
    await component.saveSource({ url: 'https://10.0.0.1/c.json' });
    expect(component.formError).toBe('That address is not public.');

    sources = [source('s2', { error: 'The catalog is not JSON.' })];
    (component as any).service.createSource = async () => ({ source: { source_id: 's2' } });
    await component.saveSource({ url: 'https://s2.example.com/c.json' });
    expect(component.formError).toBe('Saved, but its catalog could not be read: The catalog is not JSON.');
    expect(component.editing?.source_id).toBe('s2');
  });

  it('says an agent no source offers anything newer for has nothing to review', async () => {
    const component = create([source('s1')], [offer('a', 's1', { status: 'installed' })]);
    await component.ngOnInit();
    await component.openReviewOf('a');
    expect(component.review).toBeNull();
    expect(component.error).toContain('nothing to review');
  });

  it('lists the sources, what to show and the tags in its column, and narrows by a tag', async () => {
    const tagged = (id: string, tags: string[]) => {
      const one = offer(id);
      one.manifest.agent.tags = tags;
      return one;
    };
    const component = create([source('s1'), source('s2', { error: 'Not JSON.' })],
      [tagged('a', ['mail', 'all']), tagged('b', ['notes', 'all']), tagged('c', ['mail', 'all'])]);
    await component.ngOnInit();

    const [sources, show, tags] = component.filterGroups;
    expect(sources.items.map((item) => [item.name, item.count, item.icon])).toEqual([
      ['s1 agents', 3, 'store'], ['s2 agents', 0, 'triangle-alert'],
    ]);
    expect(show.required).toBeTrue();
    expect(tags.items.map((item) => item.name)).toEqual(['Mail', 'Notes']);

    component.choose({ key: 'tag', value: 'mail' });
    expect(component.shownOffers.map((one) => component.idOf(one))).toEqual(['a', 'c']);
    expect(component.chosen).toEqual({ source: 's1', show: 'all', tag: 'mail' });
    component.choose({ key: 'source', value: 's2' });
    expect(component.current?.source_id).toBe('s2');
    expect(component.tag).toBe('');
  });
});
