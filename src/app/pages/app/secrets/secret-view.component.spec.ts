import { SimpleChange } from '@angular/core';

import { SecretViewComponent } from './secret-view.component';

describe('SecretViewComponent', () => {
  const jira = {
    agent: 'jira', agent_name: 'Jira', id: 'connection', label: 'Connection',
    fields: [{ name: 'api_token', label: 'API Token', type: 'secret', storage: 'values', required: true }],
  } as any;
  const sync = {
    agent: 'sync', agent_name: 'Sync', id: 'token', label: 'Token',
    fields: [{ name: 'api_token', type: 'secret', storage: 'values', required: true }],
  } as any;
  const secret = {
    record_id: 'sec_1', kind: 'secret', name: '', of: { agent: 'jira', resource: 'connection' },
    owner: { groups: [], users: ['me'] }, agents: [{ agent: 'jira', resource: 'connection' }],
    keys: {}, values: { api_token: null }, file: null, created_by: 'me', handing: null,
  } as any;

  function view(): SecretViewComponent {
    const component = new SecretViewComponent();
    component.secret = secret;
    component.shape = jira;
    component.shapes = [jira, sync];
    component.ngOnChanges({ secret: new SimpleChange(null, secret, true), shapes: new SimpleChange(null, component.shapes, true) });
    return component;
  }

  it('never shows an encrypted value, only that it is set', () => {
    expect(view().fields).toEqual([{ label: 'API Token', value: '', hidden: true, set: true }]);
  });

  it('chooses its agents in place, from what it serves now, its own always kept', () => {
    const component = view();
    const saved: any[] = [];
    component.agentsSaved.subscribe((agents) => saved.push(agents));

    component.changingAgents = true;
    component.ngOnChanges({ changingAgents: new SimpleChange(false, true, false) });
    expect(component.choices.map((choice) => choice.key)).toEqual(['jira/connection', 'sync/token']);
    expect(component.chosen).toEqual(['jira/connection']);

    component.chosen = ['sync/token'];
    component.saveAgents();
    expect(saved).toEqual([[{ agent: 'jira', resource: 'connection' }, { agent: 'sync', resource: 'token' }]]);
  });
});
