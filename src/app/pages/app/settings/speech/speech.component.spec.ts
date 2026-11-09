import { SpeechComponent } from './speech.component';

describe('SpeechComponent', () => {
  const settings = {
    blocked_hosts: [], guardrail: '', runtimes: 'prefer_own', mcp: 'allowed', webhooks: 'allowed', webhook_trust: 1,
    notification_text: 'shown', speech: 'none', speech_connection: '', transcription_model: '', speech_model: '',
    speech_voice: '', model: '',
  };

  function create(calls: Record<string, any> = {}) {
    return new SpeechComponent(
      {
        get: async () => structuredClone(settings),
        update: async (changes: any) => {
          calls['saved'] = { ...changes };
          return { settings: { ...settings, ...changes } };
        },
      } as any,
      { list: async () => [{ connection_id: 'c1', name: 'OpenAI' }] } as any,
      { can: () => true } as any,
      { offered: async () => false } as any,
    );
  }

  it('offers the organization’s connections to speak through', async () => {
    const component = create();
    await component.load();

    expect(component.connections).toEqual([{ value: 'c1', name: 'OpenAI' }]);
    expect(component.draft.value.speech).toBe('none');
  });

  it('asks for the connection before a model speaks', async () => {
    const calls: Record<string, any> = {};
    const component = create(calls);
    await component.load();

    component.draft.value.speech = 'model';
    await component.save();
    expect(component.saveError).toBe('Choose the connection that speaks.');
    expect(calls['saved']).toBeUndefined();

    component.draft.value.speech_connection = 'c1';
    component.draft.value.speech_voice = 'alloy';
    await component.save();
    expect(calls['saved']).toEqual({
      speech: 'model', speech_connection: 'c1', transcription_model: '', speech_model: '', speech_voice: 'alloy',
    });
    expect(component.draft.dirty).toBeFalse();
  });

  it('turns the speech service on alone', async () => {
    const calls: Record<string, any> = {};
    const component = create(calls);
    await component.load();

    component.draft.value.speech = 'service';
    await component.save();

    expect(calls['saved'].speech).toBe('service');
    expect(component.unsavedChangesTo()).toBe('');
  });
});
