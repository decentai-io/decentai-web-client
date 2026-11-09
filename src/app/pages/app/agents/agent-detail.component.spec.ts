import { SimpleChange } from '@angular/core';

import { AgentDetailComponent } from './agent-detail.component';

describe('AgentDetailComponent', () => {
  function agent(overrides: any = {}) {
    return {
      agent_id: 'notebook',
      name: 'Notebook',
      version: '1.0.0',
      state: 'ready',
      error: '',
      samples: false,
      samples_loaded: false,
      source_url: 'https://catalog.example/catalog.json',
      readme: '# Notebook\nSaves notes.',
      machines: ['x86_64'],
      base: '',
      manifest: {
        schema: 3,
        agent: { id: 'notebook', name: 'Notebook', version: '1.0.0' },
        functions: [
          { id: 'find', name: 'Find', level: 0 },
          { id: 'save', name: 'Save', level: 1 },
          { id: 'list', name: 'List', level: 0, calls: ['network.open'] },
        ],
        authorization: { scopes: { notebook: { description: 'Which notebook.' } } },
        network: { hosts: ['notes.example.com', { from_secret: 'mailbox.server' }] },
      },
      ...overrides,
    } as any;
  }

  function create(service: any = {}, can = (_action: string) => true) {
    const component = new AgentDetailComponent(
      { navigate: jasmine.createSpy('navigate') } as any,
      {
        samples: async () => ({ story: 'A week of notes', records: 3, files: 1 }),
        remembered: async () => [
          { id: 'r1', agent: 'notebook', function: 'save', record: '', allowed: true, at: '' },
          { id: 'r2', agent: 'mail', function: 'send', record: '', allowed: true, at: '' },
        ],
        forget: async () => ({}),
        ...service,
      } as any,
      { can } as any,
    );
    component.agent = agent();
    component.ngOnChanges({ agent: new SimpleChange(null, component.agent, true) });
    return component;
  }

  it('counts what it may do by the level that matters, and reads where it connects', () => {
    const component = create();
    expect(component.tally).toEqual([{ name: 'Reads', count: 2 }, { name: 'Changes', count: 1 }]);
    expect(component.network).toEqual({
      any: false, hosts: ['notes.example.com'], from_secrets: ['mailbox.server'], opens: true,
    });
    expect(component.networkNote).toContain('may ask to open others for one call');
    expect(component.scopes).toEqual([{ name: 'notebook', description: 'Which notebook.' }]);
    expect(component.tabs.map((tab) => tab.name)).toEqual(['Overview', 'Functions 3']);
  });

  it('puts a README\'s headings under the page\'s own', () => {
    expect(create().readme).toBe('### Notebook\nSaves notes.');
  });

  it('lists only this agent\'s remembered approvals, and takes one back', async () => {
    const forget = jasmine.createSpy('forget').and.resolveTo({});
    const component = create({ forget });
    await new Promise((resolve) => setTimeout(resolve));
    expect(component.remembered.map((approval) => approval.id)).toEqual(['r1']);

    await component.forget(component.remembered[0]);
    expect(forget).toHaveBeenCalledWith('r1');
    expect(component.remembered).toEqual([]);
  });

  it('reads the samples only of an agent that ships them, and offers to remove what was loaded', async () => {
    const samples = jasmine.createSpy('samples').and.resolveTo({ story: 'A week of notes', records: 3, files: 1 });
    const flashed: string[] = [];
    const component = create({ samples, loadSamples: async () => ({ loaded: 4 }), removeSamples: async () => ({ removed: 4 }) });
    expect(samples).not.toHaveBeenCalled();

    component.agent = agent({ agent_id: 'other', samples: true });
    component.ngOnChanges({ agent: new SimpleChange(agent(), component.agent, false) });
    await new Promise((resolve) => setTimeout(resolve));
    expect(component.samplesStory).toBe('A week of notes.');

    component.flashed.subscribe((line) => flashed.push(line));
    expect(component.samplesLoaded).toBeFalse();
    await component.loadSamples();
    expect(flashed[0]).toContain('4 items');
    expect(component.samplesLoaded).toBeTrue();
    await component.removeSamples();
    expect(component.samplesLoaded).toBeFalse();
  });

  it('asks for a tab rather than changing it: the address is whoever shows it’s to write', () => {
    const component = create();
    const asked: string[] = [];
    component.tabChange.subscribe((tab) => asked.push(tab));
    component.tabChange.emit('functions');
    expect(asked).toEqual(['functions']);
    expect(component.tab).toBe('overview');
  });

  it('points to the policies only for whoever may read them', () => {
    expect(create().canReadPolicies).toBeTrue();
    expect(create({}, () => false).canReadPolicies).toBeFalse();
  });
});
