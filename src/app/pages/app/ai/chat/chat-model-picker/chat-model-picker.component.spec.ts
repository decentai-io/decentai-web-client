import { ChatModelPickerComponent } from './chat-model-picker.component';

describe('ChatModelPickerComponent', () => {
  const connections = [
    { connection_id: 'cn1', name: 'Anthropic', provider: 'anthropic', models: ['claude-sonnet-5'], default: true },
    { connection_id: 'cn2', name: 'Home', provider: 'openai_compatible', models: ['llama3.3'], default: false },
  ] as any[];

  async function create(model = '', effort: any = '') {
    const component = new ChatModelPickerComponent(
      { list: async () => connections } as any,
      { nativeElement: document.createElement('div') } as any,
    );
    component.llm = { model, effort };
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

  it('narrows the list by a connection\'s name, provider or models', async () => {
    const { component } = await create();
    component.query = 'llama';
    expect(component.visible.map((connection) => connection.connection_id)).toEqual(['cn2']);
  });

  it('says what was chosen, keeping the effort, and the effort alone', async () => {
    const { component, chosen } = await create('', 'low');
    component.choose('cn2');
    component.chooseEffort('high');
    expect(chosen).toEqual([{ model: 'cn2', effort: 'low' }, { model: '', effort: 'high' }]);
  });
});
