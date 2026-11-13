import { SimpleChange } from '@angular/core';

import { AgentAccessComponent } from './agent-access.component';
import { draftOf, draftProblem, newDraft, rowOf, scopesOf } from './agent-access';

describe('who may use an agent', () => {
  const FUNCTIONS = [
    { id: 'find', name: 'Find', level: 0, scoped_by: [] },
    { id: 'save', name: 'Save', level: 1, scoped_by: ['notebook'] },
    { id: 'share', name: 'Share', level: 3, scoped_by: ['notebook', 'team'] },
  ];
  const SCOPES = [
    { name: 'notebook', description: 'Which notebook.' },
    { name: 'team', description: 'Which team.' },
  ];
  const GROUPS = [
    { group_id: 'g_all', name: 'Everyone', members: 12 },
    { group_id: 'g_ops', name: 'Operations', members: 1 },
  ];

  describe('a row', () => {
    it('asks only for the scopes its functions are narrowed by', () => {
      const draft = newDraft('g_ops');
      expect(scopesOf(draft, FUNCTIONS, SCOPES).map((scope) => scope.name)).toEqual(['notebook', 'team']);
      draft.every = false;
      draft.chosen = ['find'];
      expect(scopesOf(draft, FUNCTIONS, SCOPES)).toEqual([]);
      draft.chosen = ['find', 'save'];
      expect(scopesOf(draft, FUNCTIONS, SCOPES).map((scope) => scope.name)).toEqual(['notebook']);
    });

    it('is kept as the server keeps it: every function as "*", the chosen in order, scopes only with values', () => {
      const draft = draftOf({ group_id: 'g_ops', effect: 'ask', functions: ['save', 'find'] });
      draft.scopes = { notebook: [' work ', 'work', ''], team: ['red'] };
      expect(rowOf(draft, FUNCTIONS, SCOPES)).toEqual({
        group_id: 'g_ops', effect: 'ask', functions: ['find', 'save'], scopes: { notebook: ['work'] },
      });
      draft.every = true;
      draft.scopes = { notebook: [] };
      expect(rowOf(draft, FUNCTIONS, SCOPES)).toEqual({ group_id: 'g_ops', effect: 'ask', functions: ['*'] });
    });

    it('needs a function at least, said by its group', () => {
      const draft = newDraft('g_ops');
      expect(draftProblem([draft], GROUPS)).toBe('');
      draft.every = false;
      expect(draftProblem([draft], GROUPS)).toBe('Operations: choose at least one function, or All functions.');
    });
  });

  describe('AgentAccessComponent', () => {
    function create(service: any = {}) {
      const component = new AgentAccessComponent(
        {
          access: async () => ({
            access: [{ group_id: 'g_all', effect: 'allow', functions: ['*'] }],
            groups: GROUPS, functions: FUNCTIONS, scopes: SCOPES,
            policies: [{ policy_id: 'p1', name: 'Notes team', actions: ['agent:notebook:*'] }],
          }),
          setAccess: async (_id: string, access: any) => ({ access }),
          ...service,
        } as any,
        { can: () => true } as any,
      );
      component.agentId = 'notebook';
      component.agentName = 'Notebook';
      return component;
    }

    async function opened(service: any = {}) {
      const component = create(service);
      component.ngOnChanges({ agentId: new SimpleChange(null, 'notebook', true) });
      await new Promise((resolve) => setTimeout(resolve));
      return component;
    }

    it('reads the rows, the groups left to add, and the policies that also name it', async () => {
      const component = await opened();
      expect(component.state).toBe('ready');
      expect(component.rows.length).toBe(1);
      expect(component.groupName(component.rows[0])).toBe('Everyone');
      expect(component.members(component.rows[0])).toBe('12 people');
      expect(component.addable.map((choice) => choice.name)).toEqual(['Operations']);
      expect(component.policies.map((policy) => policy.name)).toEqual(['Notes team']);
      expect(component.changed).toBeFalse();
    });

    it('saves the rows whole, and says the server\'s refusal in place', async () => {
      const setAccess = jasmine.createSpy('setAccess').and.resolveTo({ error: 'Row 2: name one of the organization\'s groups.' });
      const component = await opened({ setAccess });
      component.add('g_ops');
      const added = component.rows[1];
      component.setReach(added, 'some');
      component.toggle(added, FUNCTIONS[1]);
      component.setScope(added, 'notebook', ['work']);
      added.effect = 'deny';
      expect(component.changed).toBeTrue();

      await component.save();
      expect(setAccess).toHaveBeenCalledWith('notebook', [
        { group_id: 'g_all', effect: 'allow', functions: ['*'] },
        { group_id: 'g_ops', effect: 'deny', functions: ['save'], scopes: { notebook: ['work'] } },
      ]);
      expect(component.problem).toBe('Row 2: name one of the organization\'s groups.');
      expect(component.changed).toBeTrue();

      setAccess.and.callFake(async (_id: string, access: any) => ({ access }));
      const flashed: string[] = [];
      component.flashed.subscribe((line) => flashed.push(line));
      await component.save();
      expect(component.problem).toBe('');
      expect(component.changed).toBeFalse();
      expect(flashed).toEqual(['Saved who may use Notebook.']);
    });

    it('does not send a row with no function, and takes a change back', async () => {
      const setAccess = jasmine.createSpy('setAccess');
      const component = await opened({ setAccess });
      component.setReach(component.rows[0], 'some');
      await component.save();
      expect(setAccess).not.toHaveBeenCalled();
      expect(component.problem).toContain('Everyone: choose at least one function');

      component.discard();
      expect(component.changed).toBeFalse();
      expect(component.rows[0].every).toBeTrue();
    });

    it('is quiet for whoever may not choose, and offers to read again when the server was not reached', async () => {
      const refused = await opened({ access: async () => ({ error: 'Not yours.', code: 'refused' }) });
      expect(refused.state).toBe('refused');

      const failed = await opened({ access: async () => ({ error: 'Could not reach the server.' }) });
      expect(failed.state).toBe('failed');
      expect(failed.loadProblem).toBe('Could not reach the server.');
    });

    it('chooses a row\'s functions a level at a time, and says them in a few words', async () => {
      const component = await opened();
      const row = component.rows[0];
      expect(component.reachWords(row)).toBe('All functions');
      expect(component.scopeWords(row)).toBe('Any value');
      expect(component.levels.map((level) => level.name)).toEqual(['Reads', 'Changes', 'Outside action']);

      component.setReach(row, 'some');
      const changes = component.levels[1];
      expect(component.levelState(row, changes)).toBe('none');
      component.toggleLevel(row, changes);
      expect(row.chosen).toEqual(['save']);
      expect(component.levelState(row, changes)).toBe('all');
      expect(component.reachWords(row)).toBe('1 of 3');
      component.setScope(row, 'notebook', ['work', 'home']);
      expect(component.scopeWords(row)).toBe('notebook: work, home');
      component.toggleLevel(row, changes);
      expect(row.chosen).toEqual([]);
    });

    it('opens the row a save is stopped by, and says the saved rows to the page', async () => {
      const component = await opened();
      const saved: any[] = [];
      component.saved.subscribe((rows) => saved.push(rows));
      component.setReach(component.rows[0], 'some');
      await component.save();
      expect(component.isOpen(component.rows[0])).toBeTrue();

      component.toggle(component.rows[0], FUNCTIONS[0]);
      await component.save();
      expect(saved[0].access).toEqual([{ group_id: 'g_all', effect: 'allow', functions: ['find'] }]);
      expect(saved[0].groups).toBe(GROUPS);
      expect(component.open.size).toBe(0);
    });
  });
});
