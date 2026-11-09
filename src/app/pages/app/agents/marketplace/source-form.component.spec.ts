import { SimpleChange } from '@angular/core';

import { SourceDraft, SourceFormComponent } from './source-form.component';

describe('SourceFormComponent', () => {
  const kept = { source_id: 's1', url: 'https://agents.example.com/c.json', credential: true } as any;

  function create(source: any = null) {
    const component = new SourceFormComponent();
    component.source = source;
    component.ngOnChanges({ source: new SimpleChange(undefined, source, true) });
    const saved: SourceDraft[] = [];
    component.save.subscribe((draft) => saved.push(draft));
    return { component, saved };
  }

  it('starts empty when adding, and with the address when editing', () => {
    expect(create().component.url).toBe('');
    expect(create(kept).component.url).toBe(kept.url);
  });

  it('demands what the chosen kind of credential needs, and sends it as the API server takes it', () => {
    const { component, saved } = create();
    component.url = ' https://agents.example.com/c.json ';
    component.kind = 'header';
    component.submit();
    expect(component.missing('header')).toBe('Enter the header\'s name.');
    expect(saved).toEqual([]);

    component.header = 'X-Key';
    component.value = ' v ';
    component.submit();
    expect(saved).toEqual([{ url: 'https://agents.example.com/c.json', credential: { header: 'X-Key', value: 'v' } }]);
  });

  it('leaves a kept credential out of the save unless it is changed, and None removes it', () => {
    const { component, saved } = create(kept);
    expect(component.asksCredential).toBeFalse();
    component.submit();
    expect(saved[0]).toEqual({ url: kept.url, credential: undefined });

    component.changeCredential = true;
    component.kind = 'none';
    component.submit();
    expect(saved[1].credential).toBeNull();
  });

  it('asks for the credential again when the address changes', () => {
    const { component } = create(kept);
    component.url = 'https://elsewhere.example.com/c.json';
    expect(component.asksCredential).toBeTrue();
    expect(component.missing('token')).toBe('Enter the token.');
  });

  it('will not save without an address that is one, nor while a save is in flight', () => {
    const { component, saved } = create();
    component.submit();
    expect(component.urlProblem).toBe('Enter the catalog\'s address.');
    component.url = 'agents.example.com';
    expect(component.urlProblem).toBe('A catalog\'s address begins with https://.');
    component.url = 'https://agents.example.com/c.json';
    component.busy = true;
    component.submit();
    expect(saved).toEqual([]);
  });

  it('fills in the suggested catalog, read with no credential', () => {
    const { component } = create();
    component.suggestedUrl = 'https://reference.example.com/catalog.json';
    component.kind = 'token';
    component.useSuggested();
    expect(component.url).toBe('https://reference.example.com/catalog.json');
    expect(component.kind).toBe('none');
  });
});
