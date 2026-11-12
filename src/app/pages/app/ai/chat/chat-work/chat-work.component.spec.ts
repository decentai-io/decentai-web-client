import { WorkEntry } from 'src/app/services/chat-state.service';
import { ChatWorkComponent } from './chat-work.component';

describe('ChatWorkComponent', () => {
  function card(work: WorkEntry[]): ChatWorkComponent {
    const component = new ChatWorkComponent();
    component.work = work;
    return component;
  }

  it('says what a finished turn came to, and how long it took, folded', () => {
    const component = card([
      { id: 'c1', title: 'Notes · Save', status: 'done', kind: 'call',
        started: '2026-11-12T10:00:00Z', ended: '2026-11-12T10:00:09Z' },
      { id: 'c2', title: 'Mail · Send', status: 'failed', kind: 'call',
        started: '2026-11-12T10:00:10Z', ended: '2026-11-12T10:00:31Z', output: { size: 20, line: 'refused: declined' } },
    ]);
    expect(component.running).toBeFalse();
    expect(component.headline).toBe('Ran 2 steps · 1 failed · 31s');
    expect(component.open).toBeFalse();
    expect(component.meta(component.work[0])).toBe('Done · 9s');
    expect(component.line(component.work[1])).toBe('refused: declined');
  });

  it('says what runs while it works, open, until the person folds it', () => {
    const component = card([{ id: 'c1', title: 'Notes · Save', status: 'running', kind: 'call', line: 'Opening it' }]);
    component.elapsed = 12;
    expect(component.headline).toBe('Working · 1 running · 12s');
    expect(component.open).toBeTrue();
    expect(component.line(component.work[0])).toBe('Opening it');
    component.toggleCard();
    expect(component.open).toBeFalse();
  });

  it('puts a task\'s own work under it, and names each kind by its icon', () => {
    const component = card([
      { id: 't1', title: 'Task · Research', status: 'running', kind: 'task', thread: '' },
      { id: 'c2', title: 'Web · Search', status: 'done', kind: 'call', thread: 't1' },
      { id: 'c3', title: 'Question · Which?', status: 'waiting', kind: 'question', thread: '' },
    ]);
    expect(component.rows.map((row) => [row.entry.id, row.depth])).toEqual([['t1', 0], ['c2', 1], ['c3', 0]]);
    expect(component.rows.map((row) => component.icon(row.entry))).toEqual(['list-checks', 'bot', 'circle-question-mark']);
    expect(component.meta(component.work[2])).toBe('Waiting for you');
  });

  it('tells the records a call touched in words', () => {
    const component = card([]);
    expect(component.records({ id: 'c1', title: 'x', status: 'done', records: [
      { operation: 'read', resource: 'mailbox', ref: 'r1' }, { operation: 'create', resource: 'notes', ref: 'r2' },
    ] })).toBe('read mailbox · create notes');
  });
});
