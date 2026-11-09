import { ModelSelectComponent } from './model-select.component';

describe('ModelSelectComponent', () => {
  const connections = [
    { connection_id: 'cn1', name: 'OpenAI', models: ['gpt-6', 'gpt-5'] },
    { connection_id: 'cn2', name: 'Home', models: [] },
  ] as any[];

  function create(connectionId = '', model = '') {
    const component = new ModelSelectComponent();
    component.connections = connections;
    component.connectionId = connectionId;
    component.model = model;
    component.ngOnChanges();
    const chosen: any[] = [];
    component.changed.subscribe((choice) => chosen.push(choice));
    return { component, chosen };
  }

  it('offers the connections, with none of them first', () => {
    const { component } = create();
    expect(component.providerChoices.map((choice) => choice.value)).toEqual(['', 'cn1', 'cn2']);
  });

  it('starts a connection with the first model it offers', () => {
    const { component, chosen } = create();
    component.chooseConnection('cn1');
    expect(chosen).toEqual([{ connectionId: 'cn1', model: 'gpt-6' }]);
    expect(component.modelChoices.map((choice) => choice.value)).toEqual(['gpt-6', 'gpt-5', component.other]);
    expect(component.typing).toBeFalse();
  });

  it('takes a model typed by its own id, where none is listed or the one kept is not', () => {
    expect(create('cn2').component.typing).toBeTrue();
    expect(create('cn1', 'gpt-7-preview').component.typing).toBeTrue();

    const { component, chosen } = create('cn1', 'gpt-5');
    component.chooseModel(component.other);
    expect(component.typing).toBeTrue();
    component.typeModel(' gpt-7 ');
    expect(chosen[chosen.length - 1]).toEqual({ connectionId: 'cn1', model: 'gpt-7' });
    component.pickFromList();
    expect(component.typing).toBeFalse();
    expect(chosen[chosen.length - 1]).toEqual({ connectionId: 'cn1', model: 'gpt-6' });
  });

  it('chooses no connection, and no model with it', () => {
    const { component, chosen } = create('cn1', 'gpt-5');
    component.chooseConnection('');
    expect(chosen).toEqual([{ connectionId: '', model: '' }]);
  });
});
