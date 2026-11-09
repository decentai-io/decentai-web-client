import { SkillEditorComponent } from './skill-editor.component';

describe('SkillEditorComponent', () => {
  const ME = 'u1';

  function stored(id: string, name: string) {
    return {
      id, name, description: `When ${name} applies.`, text: 'The text.',
      owner: { groups: [], users: [ME] }, created_by: ME, handing: null,
    } as any;
  }

  async function create(options: { ref?: string; example?: boolean; skills?: any[]; service?: any; confirm?: any } = {}) {
    const skills = options.skills ?? [];
    const went: any[] = [];
    const component = new SkillEditorComponent(
      {
        list: async () => ({ items: skills, handed: [] }),
        create: async (fields: any) => ({ item: { id: 'sk_new', ...fields } }),
        update: async (id: string, fields: any) => ({ item: { id, ...fields } }),
        share: async () => ({}),
        ...options.service,
      } as any,
      { peers: async () => ({ people: [], groups: [], everyone: 'g0', mine: [] }) } as any,
      { can: () => true, user: { user_id: ME } } as any,
      { navigate: async (...args: any[]) => { went.push(args); return true; } } as any,
      { snapshot: {
        paramMap: { get: () => options.ref ?? null },
        queryParamMap: { get: () => (options.example ? '1' : null) },
      } } as any,
      { ask: async () => true, ...options.confirm } as any,
    );
    await component.ngOnInit();
    return { component, went };
  }

  it('starts empty and clean, and is unsaved once something is typed', async () => {
    const { component } = await create();
    expect(component.dirty).toBeFalse();
    expect(component.unsavedChangesTo()).toBe('');

    component.draft.value.name = 'Reports';
    expect(component.dirty).toBeTrue();
    expect(component.unsavedChangesTo()).toBe('this skill');

    component.discard();
    expect(component.dirty).toBeFalse();
  });

  it('opens a skill with what is stored, and counts a change of sharing as a change', async () => {
    const { component } = await create({ ref: 'sk_1', skills: [stored('sk_1', 'Reports')] });
    expect(component.draft.value).toEqual({ name: 'Reports', description: 'When Reports applies.', text: 'The text.' });
    expect(component.dirty).toBeFalse();

    component.share.mode = 'org';
    expect(component.dirty).toBeTrue();
  });

  it('opens nobody else\'s skill for change', async () => {
    const theirs = { ...stored('sk_1', 'Reports'), created_by: 'u2' };
    const { component } = await create({ ref: 'sk_1', skills: [theirs] });
    expect(component.problem).toContain('could not be opened');
  });

  it('says what is missing under its field and sends nothing', async () => {
    let sent = false;
    const { component } = await create({ service: { create: async () => { sent = true; return {}; } } });
    component.draft.value.name = 'Reports';

    await component.save();

    expect(sent).toBeFalse();
    expect(component.nameError).toBe('');
    expect(component.descriptionError).toBe('Say when this skill applies.');
    expect(component.textError).toBe('Write the skill itself.');
  });

  it('says at once when another skill has the name', async () => {
    const { component } = await create({ skills: [stored('sk_1', 'Quarterly  Report')] });
    component.draft.value.name = ' quarterly report ';
    expect(component.nameError).toContain('Another skill');

    // Its own name is not somebody else's.
    const editing = await create({ ref: 'sk_1', skills: [stored('sk_1', 'Reports')] });
    expect(editing.component.nameError).toBe('');
  });

  it('saves, shares in a call of its own, and goes to the skill as it now reads', async () => {
    let shared: any;
    const { component, went } = await create({
      example: true, service: { share: async (id: string, owner: any) => { shared = { id, owner }; return {}; } },
    });
    expect(component.draft.value.name).toBe('Clear, useful writing');
    // The example is written into the form, not saved.
    expect(component.dirty).toBeTrue();

    component.draft.value.name = 'Our writing';
    component.share.mode = 'org';
    await component.save();

    expect(shared).toEqual({ id: 'sk_new', owner: { groups: ['g0'], users: [ME] } });
    expect(component.unsavedChangesTo()).toBe('');
    expect(went[0][0]).toEqual(['/data/skills', 'sk_new']);
    expect(went[0][1].state.skillSaved).toBe('created');
  });

  it('keeps the page and says why when the API server refuses', async () => {
    const { component, went } = await create({
      example: true, service: { create: async () => ({ error: 'A skill has a name of 1 to 100 characters.' }) },
    });
    component.draft.value.name = 'Our writing';
    await component.save();

    expect(went.length).toBe(0);
    expect(component.saveError).toBe('A skill has a name of 1 to 100 characters.');
    expect(component.dirty).toBeTrue();
  });

  it('asks before the example replaces what was written', async () => {
    let answer = false;
    const { component } = await create({ confirm: { ask: async () => answer } });
    component.draft.value.text = 'My own rules.';

    await component.insertExample();
    expect(component.draft.value.text).toBe('My own rules.');

    answer = true;
    await component.insertExample();
    expect(component.draft.value.text).toContain('plain, direct language');
  });
});
