import { ListChoice, chatDefaults } from '../../ai/chat/chat-defaults';
import { ChatDefaultsComponent } from './chat-defaults.component';

describe('ChatDefaultsComponent', () => {
  let dialogAnswer: any = null;

  function create(chat: any = {}, calls: Record<string, any> = {}) {
    return new ChatDefaultsComponent(
      {
        get: async () => ({ user_id: 'me', preferences: { chat } }),
        savePreferences: async (changes: any) => {
          calls['preferences'] = changes;
          return {};
        },
      } as any,
      { list: async () => [{ connection_id: 'cn1', name: 'Anthropic' }] } as any,
      { can: () => true } as any,
      { available: false, automatic: false, refresh: async () => false } as any,
      { hearing: async () => 'none', dictation: async () => null, voice: async () => null,
        reading: async () => null, choose: () => undefined } as any,
      { offered: async () => false } as any,
      { available: false } as any,
      { open: () => ({ afterClosed: () => ({ subscribe: (answer: any) => answer(dialogAnswer) }) }) } as any,
    );
  }

  it('starts from the platform’s standard where nothing was chosen', async () => {
    const component = create();
    await component.load();

    expect(component.draft.value).toEqual({
      model: '', effort: '', trust: 1, turn_budget: 0, agents: null, skills: null, mcp_servers: null,
    });
    expect(component.modelChoices.map((choice) => choice.value)).toEqual(['', 'cn1']);
    expect(component.draft.dirty).toBeFalse();
    expect(component.unsavedChangesTo()).toBe('');
  });

  it('keeps what a new chat starts with, and what else was kept for it', async () => {
    const calls: Record<string, any> = {};
    const component = create({ model: 'cn1', trust: 2, agents: ['mail'] }, calls);
    await component.load();
    expect(component.draft.value.model).toBe('cn1');

    component.draft.value.effort = 'high';
    expect(component.unsavedChangesTo()).toBe('Chat defaults');
    await component.save();

    expect(calls['preferences']).toEqual({ chat: {
      model: 'cn1', effort: 'high', trust: 2, turn_budget: 0, agents: ['mail'], skills: null, mcp_servers: null,
    } });
    expect(component.draft.dirty).toBeFalse();
  });

  it('chooses every agent, server or skill a person may use, or those chosen, none included', async () => {
    const component = create({ skills: [] });
    await component.load();
    expect(component.listWords(component.draft.value.agents, 'agent')).toBe('Every agent you may use');
    expect(component.listWords(component.draft.value.skills, 'skill')).toBe('No skill');

    dialogAnswer = { agents: ['mail'], mcp_servers: null };
    component.chooseReach();
    expect(component.draft.value.agents).toEqual(['mail']);
    expect(component.listWords(component.draft.value.agents, 'agent')).toBe('1 chosen');
    expect(component.draft.dirty).toBeTrue();

    dialogAnswer = { skills: null };
    component.chooseSkills();
    expect(component.draft.value.skills).toBeNull();
    dialogAnswer = null;
  });

  it('keeps the form and says why when the save is refused', async () => {
    const component = create();
    (component as any).profiles.savePreferences = async () => ({ error: 'Not allowed.' });
    await component.load();
    component.draft.value.trust = 3;

    await component.save();

    expect(component.saveError).toBe('Not allowed.');
    expect(component.draft.dirty).toBeTrue();
  });

  it('says so when the page could not be read', async () => {
    const component = create();
    (component as any).profiles.get = async () => null;

    await component.load();

    expect(component.loadError).not.toBe('');
  });
});

describe('a chat\'s choice of agents, skills or servers', () => {
  it('reads null as all, and a list, empty too, as those alone', () => {
    expect(chatDefaults({ agents: null, skills: [], mcp_servers: ['s1'], trust: 'high' }))
      .toEqual({ agents: null, skills: [], mcp_servers: ['s1'] });

    const choice = new ListChoice(null);
    expect(choice.has('a')).toBeTrue();
    choice.setAll(false, ['a', 'b']);
    choice.toggle('a');
    choice.toggle('b');
    expect(choice.value).toEqual([]);
    choice.setAll(true, ['a', 'b']);
    expect(choice.value).toBeNull();
  });
});
