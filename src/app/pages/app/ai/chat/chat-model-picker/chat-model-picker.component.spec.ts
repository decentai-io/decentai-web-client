import { ChatModelPickerComponent } from './chat-model-picker.component';

describe('ChatModelPickerComponent', () => {
  const connections = [
    { connection_id: 'cn1', name: 'Anthropic', provider: 'anthropic', models: ['claude-sonnet-5'], default: true },
    { connection_id: 'cn2', name: 'Home', provider: 'openai_compatible', models: ['llama3.3'], default: false },
    { connection_id: 'cn3', name: 'OpenAI', provider: 'openai', models: ['gpt-6-sol', 'gpt-6-luna'], default: false },
    { connection_id: 'cn4', name: 'Empty', provider: 'openai', models: [], default: false },
  ] as any[];

  async function create(model = '', effort: any = '', model_id = '') {
    const component = new ChatModelPickerComponent(
      { list: async () => connections } as any,
      { nativeElement: document.createElement('div') } as any,
    );
    component.llm = { model, model_id, effort };
    const chosen: any[] = [];
    component.chosen.subscribe((block) => chosen.push(block));
    component.ngOnInit();
    await new Promise((resolve) => setTimeout(resolve));
    return { component, chosen };
  }

  it('names the organization\'s default where the chat chose none', async () => {
    const { component } = await create();
    expect(component.label).toBe('Anthropic');
  });

  it('names the chat\'s own connection, and how hard it thinks', async () => {
    const { component } = await create('cn2', 'high');
    expect(component.label).toBe('Home · High');
  });

  it('lists every model of every connection, narrowed by a connection\'s name, provider or model', async () => {
    const { component } = await create();
    expect(component.visible.map((option) => option.model)).toEqual(['claude-sonnet-5', 'llama3.3', 'gpt-6-sol',
                                                                     'gpt-6-luna']);
    component.query = 'openai luna';
    expect(component.visible.map((option) => [option.connection.connection_id, option.model]))
      .toEqual([['cn3', 'gpt-6-luna']]);
  });

  it('names a model of a connection of several by the model, the connection\'s first where none is picked',
     async () => {
    const { component } = await create('cn3', '', 'gpt-6-luna');
    expect(component.label).toBe('gpt-6-luna');
    expect(component.visible.filter((option) => component.isChosen(option)).map((option) => option.model))
      .toEqual(['gpt-6-luna']);
    component.llm = { model: 'cn3', model_id: 'gone', effort: '' };
    expect(component.label).toBe('gpt-6-sol');
  });

  it('says what was chosen, keeping the effort, and the effort alone', async () => {
    const { component, chosen } = await create('', 'low');
    component.choose('cn3', 'gpt-6-luna');
    component.chooseEffort('high');
    component.choose('');
    expect(chosen).toEqual([{ model: 'cn3', model_id: 'gpt-6-luna', effort: 'low' },
                            { model: '', model_id: '', effort: 'high' },
                            { model: '', model_id: '', effort: 'low' }]);
  });
});
