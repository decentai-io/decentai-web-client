import { SimpleChange } from '@angular/core';

import { AgentFunctionsComponent } from './agent-functions.component';

describe('AgentFunctionsComponent', () => {
  function create(level: number | null = null) {
    const component = new AgentFunctionsComponent();
    component.manifest = {
      schema: 3,
      agent: { id: 'mail', name: 'Mail', version: '1.0.0' },
      functions: [
        { id: 'read', name: 'Read mail', level: 0, description: 'Reads the inbox.', inputs: { properties: { folder: { type: 'string' } }, required: ['folder'] } },
        { id: 'draft', name: 'Draft', level: 1, authorization: { mailbox: { from_input: 'box' } } },
        { id: 'send', name: '', level: 3, calls: ['chat', 'model', 'record.read:login'], schedulable: true },
      ],
    } as any;
    component.level = level;
    component.ngOnChanges({
      manifest: new SimpleChange(null, component.manifest, true), level: new SimpleChange(null, level, true),
    });
    return component;
  }

  it('reads each function as a row: its name, level, scopes and what it takes', () => {
    const component = create();
    expect(component.functions.map((row) => [row.title, row.level])).toEqual([
      ['Read mail', 'Reads'], ['Draft', 'Changes'], ['send', 'Outside action'],
    ]);
    expect(component.functions[0].params).toEqual([{ name: 'folder', type: 'string', required: true }]);
    expect(component.functions[1].scopes).toEqual([{ name: 'mailbox', from: 'box', required: true }]);
    expect(component.levels.map((choice) => choice.name)).toEqual(['All 3', 'Reads 1', 'Changes 1', 'Outside action 1']);
  });

  it('narrows by level and by a search, and starts at the level the page asks for', () => {
    const component = create(3);
    expect(component.shown.map((row) => row.fn.id)).toEqual(['send']);
    component.setFilter('all');
    component.search('INBOX');
    expect(component.shown.map((row) => row.fn.id)).toEqual(['read']);
    component.showAll();
    expect(component.shown.length).toBe(3);
    // A level it has no function at shows them all.
    expect(create(2).filter).toBe('all');
  });

  it('opens a row to what it takes, and pages a long list', () => {
    const component = create();
    const row = component.functions[0];
    expect(component.isOpen(row)).toBeFalse();
    component.toggle(row);
    expect(component.isOpen(row)).toBeTrue();

    component.manifest = {
      ...component.manifest,
      functions: Array.from({ length: 30 }, (_, index) => ({ id: `f${index}`, name: `F${index}`, level: 0 })),
    } as any;
    component.ngOnChanges({ manifest: new SimpleChange(null, component.manifest, false) });
    expect(component.paged.length).toBe(25);
    component.page = 2;
    expect(component.paged.length).toBe(5);
    expect(component.filterable).toBeFalse();
  });
});
