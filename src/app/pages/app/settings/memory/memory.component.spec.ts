import { MemoryComponent } from './memory.component';

describe('MemoryComponent', () => {
  /** `sure` is what the person answers when asked before forgetting. */
  function createComponent(memories: any[] = [], service: any = {}, sure = true) {
    return new MemoryComponent(
      {
        list: async () => memories,
        update: async () => ({}),
        remove: async () => ({}),
        ...service,
      } as any,
      { can: () => true } as any,
      { ask: async () => sure } as any,
    );
  }

  function filled(count: number) {
    return Array.from({ length: count }, (_, index) => ({ memory_id: `mem_${index}`, text: `Fact ${index}` }));
  }

  it('reports how much room is left before the oldest is dropped', async () => {
    const component = createComponent(filled(12));
    await component.ngOnInit();

    expect(component.limit).toBe(50);
    expect(component.remaining).toBe(38);
    expect(component.nearLimit).toBeFalse();
    expect(component.atLimit).toBeFalse();
  });

  it('warns as the cap comes into range, and once it is reached', async () => {
    const near = createComponent(filled(46));
    await near.ngOnInit();
    expect(near.remaining).toBe(4);
    expect(near.nearLimit).toBeTrue();
    expect(near.atLimit).toBeFalse();

    const full = createComponent(filled(50));
    await full.ngOnInit();
    expect(full.remaining).toBe(0);
    expect(full.atLimit).toBeTrue();
  });

  it('shows the newest first: the server lists them oldest first', async () => {
    const component = createComponent([
      { memory_id: 'old', text: 'Learned first.' },
      { memory_id: 'new', text: 'Learned last.' },
    ]);
    await component.ngOnInit();

    expect(component.filteredMemories.map((m) => m.memory_id)).toEqual(['new', 'old']);
    expect(component.memories.map((m) => m.memory_id)).toEqual(['old', 'new']);
  });

  it('writes a memory of your own and reloads the record', async () => {
    let created = '';
    const component = createComponent([], {
      create: async (text: string) => {
        created = text;
        return { memory_id: 'mem_1', text };
      },
    });
    await component.ngOnInit();

    expect(component.canSubmitNew).toBeFalse();

    component.newText = '  I prefer concise status updates.  ';
    expect(component.canSubmitNew).toBeTrue();

    await component.addMemory();
    expect(created).toBe('I prefer concise status updates.');
    expect(component.newText).toBe('');
  });

  it('keeps what was written, and says why, when it is refused', async () => {
    const component = createComponent([], {
      create: async () => ({ error: 'A memory is 1 to 500 characters.' }),
    });
    await component.ngOnInit();
    component.newText = 'Works in Abu Dhabi.';

    await component.addMemory();

    expect(component.addError).toBe('A memory is 1 to 500 characters.');
    expect(component.newText).toBe('Works in Abu Dhabi.');
  });

  it('asks before forgetting instead of going straight through', async () => {
    const memory = { memory_id: 'mem_1', text: 'Delete me.' };
    const removed: string[] = [];
    const remove = async (id: string) => {
      removed.push(id);
      return {};
    };

    const kept = createComponent([memory], { remove }, false);
    await kept.ngOnInit();
    await kept.forget(memory);
    expect(removed).toEqual([]);

    const gone = createComponent([memory], { remove }, true);
    await gone.ngOnInit();
    await gone.forget(memory);
    expect(removed).toEqual(['mem_1']);
  });

  it('forgets every memory after one question', async () => {
    const removed: string[] = [];
    const component = createComponent(filled(3), {
      remove: async (id: string) => {
        removed.push(id);
        return {};
      },
    });
    await component.ngOnInit();

    await component.forgetAll();

    expect(removed).toEqual(['mem_0', 'mem_1', 'mem_2']);
  });

  it('says so when the memories could not be read, and stops loading', async () => {
    const component = createComponent([], {
      list: async () => { throw new Error('offline'); },
    });

    await component.ngOnInit();

    expect(component.loading).toBeFalse();
    expect(component.loadError).not.toBe('');
  });

  it('shows a correction as the server keeps it', async () => {
    const memory = { memory_id: 'mem_1', text: 'Prefers long reports.' };
    const component = createComponent([memory]);
    await component.ngOnInit();

    component.startEdit(memory);
    component.editText = 'Prefers   one-page reports.';
    await component.saveEdit(memory);

    expect(memory.text).toBe('Prefers one-page reports.');
    expect(component.editingId).toBeNull();
  });

  it('surfaces a refused correction instead of showing it as saved', async () => {
    const memory = { memory_id: 'mem_1', text: 'Prefers long reports.' };
    const component = createComponent([memory], {
      update: async () => ({ error: 'No such memory.' }),
    });
    await component.ngOnInit();

    component.startEdit(memory);
    component.editText = 'Works in Abu Dhabi.';
    await component.saveEdit(memory);

    expect(component.editError).toBe('No such memory.');
    expect(memory.text).toBe('Prefers long reports.');
    // The editor stays open, holding the text that was refused.
    expect(component.editingId).toBe('mem_1');
    expect(component.editText).toBe('Works in Abu Dhabi.');
  });
});
