import { convertToParamMap, NavigationEnd } from '@angular/router';
import { BehaviorSubject, Subject } from 'rxjs';
import { RecordsComponent } from './records.component';

/**
 * The address, as the page meets it: a router that can be navigated and
 * tells of each navigation, and a route whose child names the open kind.
 * Navigating to a kind's address makes it the open one, as the real
 * router would.
 */
function address() {
  const events = new Subject<unknown>();
  const child = { paramMap: convertToParamMap({}) };
  const route = {
    snapshot: { firstChild: child },
    queryParamMap: new BehaviorSubject(convertToParamMap({})),
  };
  const router = {
    events,
    navigate: jasmine.createSpy('navigate').and.callFake(async (commands: string[]) => {
      if (commands.length === 3) {
        child.paramMap = convertToParamMap({ agent: commands[1], kind: commands[2] });
        events.next(new NavigationEnd(1, '', ''));
      }
      return true;
    }),
  };
  return { router, route };
}

const ME = 'usr_me';
const peers = { people: [], groups: [], everyone: '', mine: [] };

function record(id: string, createdBy = ME, resource = 'note') {
  return {
    record_id: id, kind: 'data', of: { agent: 'notebook', resource }, agents: [{ agent: 'notebook', resource }],
    created_by: createdBy, owner: { users: [createdBy], groups: [] }, keys: { name: id }, values: {},
    file: null, handing: null, created_at: '2026-09-01T00:00:00Z', updated_at: '2026-09-01T00:00:00Z',
  } as any;
}

function page(service: any, confirm: any = { ask: async () => true }) {
  const { router, route } = address();
  return new RecordsComponent(
    service, { peers: async () => peers } as any, { can: () => true, user: { user_id: ME } } as any,
    confirm, router as any, route as any,
  );
}

describe('RecordsComponent deleting several records at once', () => {
  async function componentWith(rows: any[], remove?: jasmine.Spy) {
    let live = rows.slice();
    const service = {
      list: jasmine.createSpy('list').and.callFake(async () => ({ records: live.slice(), handed: [] })),
      remove: remove || jasmine.createSpy('remove').and.callFake(async (_: string, id: string) => {
        live = live.filter((row) => row.record_id !== id);
        return {};
      }),
      shapes: jasmine.createSpy('shapes').and.resolveTo([]),
    };
    const component = page(service);
    await component.ngOnInit();
    /** A record going away behind our back: somebody else deleted it. */
    const drop = (id: string) => { live = live.filter((row) => row.record_id !== id); };
    return { component, service, drop };
  }

  it('deletes everything ticked, behind one confirmation', async () => {
    const { component, service } = await componentWith([record('rec_1'), record('rec_2'), record('rec_3')]);

    component.toggleSelected(component.records[0]);
    component.toggleSelected(component.records[2]);
    await component.deleteSelected();

    expect(service.remove).toHaveBeenCalledTimes(2);
    expect(component.records.map((row) => row.record_id)).toEqual(['rec_2']);
    expect(component.selected.size).toBe(0);
  });

  it('deletes nothing when the confirmation is refused', async () => {
    const { component, service } = await componentWith([record('rec_1')]);
    (component as any).confirm = { ask: async () => false };

    await component.deleteOne(component.records[0]);

    expect(service.remove).not.toHaveBeenCalled();
    expect(component.records.length).toBe(1);
  });

  it('names what would not go, and leaves it ticked', async () => {
    const remove = jasmine.createSpy('remove').and.callFake(async (_: string, id: string) =>
      id === 'rec_2' ? { error: 'No such record of yours.' } : {});
    const { component } = await componentWith([record('rec_1'), record('rec_2')], remove);

    component.selectAllShown();
    await component.deleteSelected();

    expect(component.error).toContain('Still here');
    expect(component.selected.has('rec_2')).toBe(true);
    expect(component.selected.has('rec_1')).toBe(false);
  });

  it('will not tick a record the person did not make', async () => {
    const { component } = await componentWith([record('rec_mine'), record('rec_theirs', 'usr_someone_else')]);

    expect(component.deletable(component.records[0])).toBe(true);
    expect(component.deletable(component.records[1])).toBe(false);
    component.selectAllShown();
    expect([...component.selected]).toEqual(['rec_mine']);
  });

  it('still deletes one record on its own, through the same door', async () => {
    const { component, service } = await componentWith([record('rec_1'), record('rec_2')]);

    await component.deleteOne(component.records[1]);

    expect(service.remove).toHaveBeenCalledOnceWith('data', 'rec_2');
    expect(component.records.length).toBe(1);
    expect(component.notice).toBe('Record deleted.');
  });

  it('opens on the first kind of the first agent, and moves on when the last of one is deleted', async () => {
    const { component } = await componentWith([record('rec_note'), record('rec_task', ME, 'task')]);
    expect(component.activeKind).toEqual({ agent: 'notebook', resource: 'note' });

    await component.deleteOne(component.records[0]);

    expect(component.activeKind).toEqual({ agent: 'notebook', resource: 'task' });
    expect(component.selectionRecords.length).toBe(1);
  });

  it('keeps what is shared with the person apart from what is theirs', async () => {
    const { component } = await componentWith([record('rec_mine'), record('rec_theirs', 'usr_someone_else')]);

    expect(component.shown.map((row) => row.record_id)).toEqual(['rec_mine']);
    component.show = 'shared';
    expect(component.shown.map((row) => row.record_id)).toEqual(['rec_theirs']);
  });

  it('drops a tick when the record behind it is gone', async () => {
    const { component, drop } = await componentWith([record('rec_1'), record('rec_2')]);

    component.selectAllShown();
    drop('rec_2');
    await (component as any).reload();

    expect([...component.selected]).toEqual(['rec_1']);
  });
});

describe('RecordsComponent writing a record by hand', () => {
  function shape(id: string, access: string[], fields: any[] = []) {
    return { agent: 'notebook', agent_name: 'Notebook', id, label: id, description: '', fields, user_access: access } as any;
  }

  async function componentWith(rows: any[], shapes: any[], calls: any = {}, create?: any) {
    const component = page({
      list: async () => ({ records: rows, handed: [] }),
      shapes: async () => shapes,
      create: create ?? (async (kind: string, of: any, fields: any) => { calls.created = { kind, of, fields }; return { record: {} }; }),
      update: async (kind: string, id: string, changes: any) => { calls.updated = { id, changes }; return { record: {} }; },
    });
    await component.ngOnInit();
    return component;
  }

  const TITLE = { name: 'title', label: 'Title', type: 'string', storage: 'keys', required: true };
  const TAG = { name: 'tag', label: 'Tag', type: 'string', storage: 'keys' };
  const COUNT = { name: 'count', label: 'Count', type: 'number', storage: 'keys' };

  function note(keys: any) {
    return { ...record('rec_1'), keys };
  }

  it('offers a kind that holds no record yet', async () => {
    const component = await componentWith([], [shape('note', ['create'], [TITLE])]);

    component.openPicker();

    expect(component.formShape?.id).toBe('note');
  });

  it('does not open a form for a kind its agent keeps to itself', async () => {
    const component = await componentWith(
      [note({ title: 'a' })], [shape('note', []), shape('task', ['create']), shape('list', ['create'])]);

    component.openPicker();

    expect(component.formShape).toBeNull();
    expect(component.pickerOpen).toBeTrue();
    expect(component.pickerShapes.map((each) => each.label)).toEqual(['task', 'list']);
  });

  it('empties a text field that was cleared in an edit', async () => {
    const calls: any = {};
    const stored = note({ title: 'a', tag: 'old' });
    const component = await componentWith([stored], [shape('note', ['create', 'update'], [TITLE, TAG, COUNT])], calls);

    component.startEdit(stored);
    component.formFields['tag'] = '';
    await component.saveForm();

    expect(calls.updated).toEqual({ id: 'rec_1', changes: { fields: { title: 'a', tag: '' } } });
  });

  it('sends a record\'s name only where it changed, and names the record by it', async () => {
    const calls: any = {};
    const stored = { ...note({ title: 'a' }), name: 'Groceries' };
    const component = await componentWith([stored], [shape('note', ['update'], [TITLE])], calls);
    expect(component.nameOf(stored)).toBe('Groceries');

    component.startEdit(stored);
    component.formName = ' Shopping ';
    await component.saveForm();

    expect(calls.updated).toEqual({ id: 'rec_1', changes: { fields: { title: 'a' }, name: 'Shopping' } });
  });

  it('refuses to empty what the shape gives no empty value', async () => {
    const calls: any = {};
    const stored = note({ title: 'a', count: 3 });
    const component = await componentWith([stored], [shape('note', ['update'], [TITLE, TAG, COUNT])], calls);

    component.startEdit(stored);
    component.formFields['count'] = '';
    await component.saveForm();
    expect(calls.updated).toBeUndefined();
    expect(component.problemOf(COUNT as any)).toContain('Count');

    component.formFields['count'] = 3;
    component.formFields['title'] = '';
    await component.saveForm();
    expect(calls.updated).toBeUndefined();
    expect(component.problemOf(TITLE as any)).toBe('Enter Title.');
  });

  it('asks for what is required before a new record is sent, of the agent\'s resource', async () => {
    const calls: any = {};
    const component = await componentWith([], [shape('note', ['create'], [TITLE, COUNT])], calls);

    component.openPicker();
    component.formFields['count'] = 'many';
    await component.saveForm();
    expect(calls.created).toBeUndefined();
    expect(component.problemOf(COUNT as any)).toContain('number');

    component.formFields['title'] = 'Ops';
    component.formFields['count'] = '4';
    await component.saveForm();
    expect(calls.created).toEqual({ kind: 'data', of: { agent: 'notebook', resource: 'note' }, fields: { title: 'Ops', count: 4 } });
  });

  it('keeps the form open with the reason when the API server refuses', async () => {
    const component = await componentWith([], [shape('note', ['create'], [TITLE])], {},
      async () => ({ error: 'Title is required.' }));

    component.openPicker();
    component.formFields['title'] = 'Ops';
    await component.saveForm();

    expect(component.formShape).not.toBeNull();
    expect(component.formError).toBe('Title is required.');
  });
});
