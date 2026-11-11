import { Refused } from 'src/app/services/request.service';
import { SafetyComponent } from './safety.component';

describe('SafetyComponent', () => {
  const saved = {
    blocked_hosts: ['tracker.test'], guardrail: 'Answer in French.', runtimes: 'prefer_own', mcp: 'allowed',
    webhooks: 'allowed', notification_text: 'shown', speech: 'none', speech_connection: '',
    transcription_model: '', speech_model: '', speech_voice: '', model: '',
  };

  function create(calls: Record<string, any> = {}, service: any = {}, can: (action: string) => boolean = () => true) {
    return new SafetyComponent(
      {
        get: async () => structuredClone(saved),
        update: async (changes: any) => {
          calls['saved'] = structuredClone(changes);
          return { settings: { ...saved, ...changes } };
        },
        ...service,
      } as any,
      { can } as any,
    );
  }

  it('reads a pasted address for its site’s name, and keeps a wildcard', () => {
    const component = create();

    expect(component.siteName('https://Shop.Example.com:8443/cart?x=1')).toBe('shop.example.com');
    expect(component.siteName('*.example.com.')).toBe('*.example.com');
    expect(component.siteName('user@example.com')).toBe('example.com');
  });

  it('saves the whole form, the rules with it, and is clean again after', async () => {
    const calls: Record<string, any> = {};
    const component = create(calls);
    await component.load();
    expect(component.unsavedChangesTo()).toBe('');

    component.draft.value.guardrail = 'Answer in English.';
    component.draft.value.webhooks = 'blocked';
    expect(component.unsavedChangesTo()).toBe('Safety');
    await component.save();

    expect(calls['saved']).toEqual({
      blocked_hosts: ['tracker.test'], guardrail: 'Answer in English.', mcp: 'allowed', webhooks: 'blocked',
      notification_text: 'shown',
    });
    expect(component.draft.dirty).toBeFalse();
  });

  it('keeps the changes and says why when the save is refused', async () => {
    const component = create({}, { update: async () => ({ error: 'guardrail is text of at most 4000 characters.' }) });
    await component.load();
    component.draft.value.mcp = 'blocked';

    await component.save();

    expect(component.saveError).toContain('4000');
    expect(component.draft.dirty).toBeTrue();
  });

  it('says what blocking webhooks means', async () => {
    const component = create();
    await component.load();

    component.draft.value.webhooks = 'blocked';
    expect(component.webhooksMeaning).toContain('No webhook takes an event');
  });

  it('says so when the settings could not be read, instead of a blank page', async () => {
    const component = create({}, { get: async () => { throw new Refused('You are not allowed to do this.'); } });

    await component.load();

    expect(component.loading).toBeFalse();
    expect(component.loadError).toBe('You are not allowed to do this.');
  });

  it('changes nothing for someone who may only read it', async () => {
    const calls: Record<string, any> = {};
    const component = create(calls, {}, (action) => action === 'settings:organization:get');
    await component.load();

    component.draft.value.guardrail = 'typed anyway';
    expect(component.dirty).toBeFalse();
    await component.save();
    expect(calls['saved']).toBeUndefined();
  });
});
