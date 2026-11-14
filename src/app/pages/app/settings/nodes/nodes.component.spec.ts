import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import {
  ArrowLeft, Building2, Check, ChevronDown, ChevronRight, CloudOff, Copy, ExternalLink, Globe, Info, KeyRound, Lock,
  LucideAngularModule, MessageSquare, MessageSquareText, Network, Package, Pause, Pencil, Play, Plus, RefreshCw, Search,
  SearchX, Server, Trash2,
} from 'lucide-angular';

import { AuthService } from 'src/app/services/auth.service';
import { ConfirmService } from 'src/app/services/confirm.service';
import { EnrollmentToken, ExecutionNode, NodesService, normalizeNode } from 'src/app/services/nodes.service';
import { SettingsOrgService } from 'src/app/services/settings-org.service';
import { settingsPageOpen, settingsPages } from 'src/app/website/config/config';
import { NODES_DOCS, NodesComponent, REFRESH_MS } from './nodes.component';
import { filterNodes, groupNodes, NO_FILTERS, nodeFacts, nodeLabel, overview, tokenFacts, tokenState } from './nodes-words';

/** Every grant the page knows of. */
const ALL = [
  'nodes:node:list', 'nodes:node:refuse', 'nodes:node:allow', 'nodes:node:drain',
  'nodes:node:update', 'nodes:node:forget',
  'nodes:authority:list', 'nodes:authority:create', 'nodes:authority:revoke', 'nodes:authority:join',
  'settings:organization:get', 'settings:organization:update',
];

const ICONS = {
  ArrowLeft, Building2, Check, ChevronDown, ChevronRight, CloudOff, Copy, ExternalLink, Globe, Info, KeyRound, Lock,
  MessageSquare, MessageSquareText, Network, Package, Pause, Pencil, Play, Plus, RefreshCw, Search, SearchX, Server,
  Trash2,
};

/** A token made a day ago, enrolling for a week more. */
function token(id: string, more: Partial<EnrollmentToken> = {}): EnrollmentToken {
  const now = Date.now() / 1000;
  return {
    _id: id, kind: 'runtime', metadata: { scope: 'org_1' }, lifetime: 43200, uses: 1,
    expires: now + 7 * 86400, withdrawn: false, made: now - 86400 - 60, ...more,
  };
}

/** A runtime as Nodes:Node:list answers organization org_1: its own processes alone. */
function node(id: string, more: any = {}): ExecutionNode {
  return normalizeNode({
    node_id: id, name: '', note: '', scope: 'org_1', labels: ['gpu'],
    since: '2026-10-01T09:00:00Z', seen_at: '2026-10-18T09:00:00Z',
    live: true, refused: false, draining: false, drained: [], held_chats: 2, held_elsewhere: 0,
    sandboxes: [{
      sandbox: 'sb-1', machine: 'x86_64', base: 'python-3.12',
      room: { processes: 2, processes_max: 8, memory_used: 256 * 1024 ** 2, memory_max: 1024 ** 3 },
      processes: [{ agent: 'notebook', org_id: 'org_1', memory: 1 }, { agent: 'web', org_id: 'org_1', memory: 1 }],
    }],
    ...more,
  });
}

function nodes(): ExecutionNode[] {
  return [
    node('alpha'),
    node('beta', { live: false, refused: true, sandboxes: [], held_chats: 0 }),
    node('pool-1', {
      scope: '', held_chats: 0, held_elsewhere: 3, drained: ['sandbox-2'],
      sandboxes: [{ sandbox: 'sandbox-1' }, { sandbox: 'sandbox-2' }],
    }),
  ];
}

/** Nodes:Node:list as the API server answers it: the nodes the filters
 *  leave, and the counts of them all. */
function answerNodes(all: ExecutionNode[], filters: any = {}) {
  const scope = filters.scope === 'shared' ? '' : filters.scope === 'own' ? 'org_1' : 'all';
  const shown = filterNodes(all, { query: filters.q ?? '', state: filters.state ?? 'all', scope });
  const counts = overview(all, []);
  return {
    nodes: shown, next: null, total: shown.length,
    counts: { ...counts, shared: all.filter((one) => !one.scope).length, own: all.filter((one) => one.scope).length },
  };
}

/** Nodes:Authority:list as the API server answers it. */
function answerTokens(all: EnrollmentToken[], filters: any = {}, enrolled: any[] = []) {
  const shown = all.filter((one) => !filters.state || (tokenState(one) === 'live') === (filters.state === 'live'));
  const live = all.filter((one) => tokenState(one) === 'live').length;
  return { tokens: shown, enrolled, next: null, total: shown.length, counts: { live, spent: all.length - live } };
}

/** A fake of the services, every call recorded. */
function fakeService(over: Record<string, any> = {}) {
  const calls: { name: string; args: unknown[] }[] = [];
  const record = (name: string, answer: (...args: any[]) => any) =>
    async (...args: unknown[]) => { calls.push({ name, args }); return answer(...args); };
  const service: any = {
    nodes: record('nodes', (filters: any = {}) => answerNodes(nodes(), filters)),
    tokens: record('tokens', (filters: any = {}) => answerTokens(
      [token('a'), token('b', { withdrawn: true }), token('s', { metadata: {}, uses: null })], filters,
      [{ _id: 'alpha', token: 'a' }])),
    createToken: record('createToken', () => ({ id: 'tok_new', token: 'dct_secret' })),
    revokeToken: record('revokeToken', () => ({})),
    updateNode: record('updateNode', () => ({})),
    refuse: record('refuse', () => ({})),
    allow: record('allow', () => ({})),
    forget: record('forget', () => ({})),
    drain: record('drain', () => ({})),
  };
  const settings: any = {
    get: record('settings', () => ({ runtimes: 'prefer_own' })),
    update: record('placement', (changes: any) => ({ settings: { runtimes: changes.runtimes } })),
  };
  for (const [name, answer] of Object.entries(over)) {
    if (name === 'settings' || name === 'placement') settings[name === 'settings' ? 'get' : 'update'] = record(name, answer);
    else service[name] = record(name, answer);
  }
  return {
    service: service as NodesService, settings: settings as SettingsOrgService, calls,
    called: (name: string) => calls.filter((c) => c.name === name),
  };
}

const auth = (granted: string[] = ALL, operator = false) => ({
  can: (action: string) => granted.includes(action), operator, organization: { org_id: 'org_1', name: 'Al-Rawda' },
});

/** A dialog that opens nothing, and says when it was asked to. */
function fakeDialog() {
  const opened: unknown[] = [];
  return {
    opened,
    open: (template: unknown) => {
      opened.push(template);
      let after: () => void = () => {};
      return {
        disableClose: false,
        close: () => after(),
        afterClosed: () => ({ subscribe: (fn: () => void) => { after = fn; } }),
      };
    },
  };
}

describe('NodesComponent', () => {
  let made: NodesComponent[] = [];
  afterEach(() => {
    made.forEach((component) => component.ngOnDestroy());
    made = [];
  });

  function create(over: Record<string, any> = {}, granted = ALL, sure = true, params: any = {}, operator = false) {
    const fake = fakeService(over);
    const asked: string[] = [];
    const dialog = fakeDialog();
    const route = params ? { snapshot: { queryParams: params } } : undefined;
    const copied: string[] = [];
    const component = new NodesComponent(
      fake.service,
      auth(granted, operator) as any,
      fake.settings,
      dialog as any,
      { ask: async (question: any) => { asked.push(question.title); return sure; } } as any,
      undefined,
      route as any,
      { copy: (text: string) => { copied.push(text); return true; } } as any,
    );
    // The dialogs' templates: anything, so the fake opens "them".
    (component as any).editor = 'editor';
    (component as any).editDialog = 'editDialog';
    (component as any).refuseDialog = 'refuseDialog';
    made.push(component);
    return { component, ...fake, asked, dialog, copied };
  }

  describe('reading', () => {
    it('reads the runtimes, the tokens and where chats run', async () => {
      const { component, called } = create();
      await component.ngOnInit();

      expect(component.nodes.map((n) => n.node_id)).toEqual(['alpha', 'beta', 'pool-1']);
      // The tokens that can enroll, asked of the server a page at a time.
      expect(component.tokens.length).toBe(2);
      expect(called('tokens')[0].args).toEqual([{ state: 'live' }, '', 10]);
      expect(called('nodes')[0].args).toEqual([{}, '', 20]);
      expect(component.placement).toBe('prefer_own');
      expect(component.ownConnected).toBe(1);
      expect(component.nodesFoot).toBe('2 connected · 3 in all');
      expect(component.tokensFoot).toBe('2 can enroll · 1 spent');
      expect(component.updatedLine).toMatch(/^Updated /);
    });

    it('offers only the views the person may open, and asks only for those', async () => {
      const { component, calls } = create({}, ['nodes:authority:list']);
      await component.ngOnInit();

      expect(calls.map((c) => c.name)).toEqual(['tokens']);
      expect(component.views.map((v) => v.value)).toEqual(['tokens']);
      expect(component.view).toBe('tokens');
    });

    it('opens the view and the runtime the address names', async () => {
      const { component } = create({}, ALL, true, { view: 'nodes', node: 'alpha' });
      await component.ngOnInit();

      expect(component.openNode?.node_id).toBe('alpha');

      const other = create({}, ALL, true, { view: 'placement', node: 'alpha' });
      await other.component.ngOnInit();
      expect(other.component.view).toBe('placement');
      expect(other.component.openNode).toBeNull();
    });

    it('says why the page could not be read', async () => {
      const { component } = create({ nodes: () => ({ nodes: [], error: 'You are not allowed to do this.' }) });
      await component.ngOnInit();

      expect(component.loadError).toBe('You are not allowed to do this.');
    });

    it('keeps spent tokens out of the list until asked for', async () => {
      const { component } = create();
      await component.ngOnInit();

      expect(component.visibleTokens.map((one) => one._id)).toEqual(['a', 's']);
      await component.setShowSpent(true);
      expect(component.visibleTokens.map((one) => one._id)).toEqual(['a', 'b', 's']);
      expect(component.tokensFoot).toBe('2 can enroll · 1 spent');
    });

    it('takes the counts from the server, whatever the page shows', async () => {
      const { component } = create({
        nodes: () => ({
          nodes: [node('alpha')], next: 'alpha', total: 40,
          counts: { total: 40, connected: 31, refused: 2, sandboxes: 60, draining: 4, chats: 90, shared: 10, own: 30, own_connected: 25 },
        }),
        tokens: () => ({ tokens: [token('a')], enrolled: [], next: null, total: 1, counts: { live: 7, spent: 12 } }),
      });
      await component.ngOnInit();

      expect(component.counts).toEqual({ total: 40, connected: 31, refused: 2, sandboxes: 60, draining: 4, chats: 90, tokens: 7 });
      expect(component.nodesFoot).toBe('31 connected · 40 in all');
      expect(component.tokensFoot).toBe('7 can enroll · 12 spent');
      expect(component.ownConnected).toBe(25);
      expect(component.nodePages.hasNext).toBeTrue();
    });

    it('reads the next page of runtimes after the cursor the server gave', async () => {
      const { component, called } = create({
        nodes: (_filters: any, after: string) => (after
          ? { nodes: [node('gamma')], next: null, total: 21 }
          : { nodes: Array.from({ length: 20 }, (_, i) => node(`n${i}`)), next: 'n19', total: 21 }),
      });
      await component.ngOnInit();

      await component.nodePages.go(2);
      expect(called('nodes')[1].args).toEqual([{}, 'n19', 20]);
      expect(component.nodes.map((one) => one.node_id)).toEqual(['gamma']);
      await component.nodePages.go(1);
      expect(called('nodes')[2].args).toEqual([{}, '', 20]);
    });

    it('counts what is connected, the sandboxes, the chats and the tokens that can enroll', async () => {
      const { component } = create();
      await component.ngOnInit();

      expect(component.counts).toEqual({ total: 3, connected: 2, refused: 1, sandboxes: 3, draining: 1, chats: 2, tokens: 2 });
    });

    it('says whether a token can enroll, and what it enrolled', () => {
      const now = new Date();
      expect(tokenState(token('a'), now)).toBe('live');
      expect(tokenState(token('w', { withdrawn: true }), now)).toBe('withdrawn');
      expect(tokenState(token('u', { uses: 0 }), now)).toBe('used');
      expect(tokenState(token('e', { expires: now.getTime() / 1000 - 60 }), now)).toBe('expired');
      const facts = tokenFacts(token('a'), 1, now);
      expect(facts[0]).toBe('1 node enrolled');
      expect(facts[1]).toBe('1 more');
      expect(facts[2]).toMatch(/^until /);
      expect(facts[3]).toBe('made yesterday');
      expect(tokenFacts(token('s', { uses: null }), 0, now)[1]).toBe('any number more');
    });
  });

  describe('keeping current', () => {
    beforeEach(() => jasmine.clock().install());
    afterEach(() => jasmine.clock().uninstall());

    const settle = async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); };

    it('reads the runtimes again while the page is open, and stops when it closes', async () => {
      const { component, called } = create();
      await component.ngOnInit();
      expect(called('nodes').length).toBe(1);

      jasmine.clock().tick(REFRESH_MS + 1);
      await settle();
      expect(called('nodes').length).toBe(2);
      expect(called('tokens').length).toBe(2);

      component.ngOnDestroy();
      jasmine.clock().tick(REFRESH_MS * 3);
      await settle();
      expect(called('nodes').length).toBe(2);
    });

    it('keeps what it shows when a refresh fails, and says so', async () => {
      let fail = false;
      const { component } = create({ nodes: () => (fail ? { nodes: [], error: 'Gone.' } : { nodes: nodes() }) });
      await component.ngOnInit();
      fail = true;

      await component.refresh();

      expect(component.nodes.length).toBe(3);
      expect(component.loadError).toBe('');
      expect(component.updatedLine).toBe('Could not refresh');
    });
  });

  describe('finding a runtime', () => {
    it('groups shared runtimes first, then the organization’s own, connected first', () => {
      const groups = groupNodes([node('away', { live: false }), ...nodes()]);

      expect(groups.map((g) => g.name)).toEqual(['Shared', 'This organization']);
      expect(groups[1].nodes.map(nodeLabel)).toEqual(['alpha', 'away', 'beta']);
      expect(groups[1].connected).toBe(1);
    });

    it('searches the name, the id, the note and the labels, and filters by state and scope', () => {
      const listed = [node('alpha', { name: 'Basement rack', note: 'by the boiler' }), ...nodes().slice(1)];

      expect(filterNodes(listed, { ...NO_FILTERS, query: 'basement' }).map((n) => n.node_id)).toEqual(['alpha']);
      expect(filterNodes(listed, { ...NO_FILTERS, query: 'boiler' }).map((n) => n.node_id)).toEqual(['alpha']);
      expect(filterNodes(listed, { ...NO_FILTERS, query: 'gpu pool' }).map((n) => n.node_id)).toEqual(['pool-1']);
      expect(filterNodes(listed, { ...NO_FILTERS, state: 'refused' }).map((n) => n.node_id)).toEqual(['beta']);
      expect(filterNodes(listed, { ...NO_FILTERS, state: 'connected' }).map((n) => n.node_id)).toEqual(['alpha', 'pool-1']);
      expect(filterNodes(listed, { ...NO_FILTERS, scope: '' }).map((n) => n.node_id)).toEqual(['pool-1']);
    });

    it('offers a scope filter only where there are two, and says what is shown', async () => {
      const { component, called } = create();
      await component.ngOnInit();

      expect(component.scopeChoices.map((c) => c.name)).toEqual(['Any organization', 'Shared', 'This organization']);
      component.setFilter('state', 'refused');
      await new Promise((resolve) => setTimeout(resolve));
      expect(component.filtering).toBeTrue();
      expect(called('nodes')[called('nodes').length - 1].args[0]).toEqual({ state: 'refused' });
      expect(component.nodesFoot).toBe('1 shown · 2 connected · 3 in all');
      component.setFilter('scope', '');
      await new Promise((resolve) => setTimeout(resolve));
      expect(called('nodes')[called('nodes').length - 1].args[0]).toEqual({ state: 'refused', scope: 'shared' });
      component.clearFilters();
      expect(component.filtering).toBeFalse();
    });

    it('says a runtime by the name it was given, and what it holds', () => {
      expect(nodeLabel(node('alpha', { name: ' Basement rack ' }))).toBe('Basement rack');
      expect(nodeLabel(node('alpha'))).toBe('alpha');
      expect(nodeFacts(node('alpha'))).toEqual(['2 chats', '1 sandbox']);
      expect(nodeFacts(nodes()[2])).toContain('2 sandboxes, 1 draining');
    });
  });

  describe('the detail of a runtime', () => {
    it('opens and closes', async () => {
      const { component } = create();
      await component.ngOnInit();

      component.open(component.nodes[0]);
      expect(component.openNode?.node_id).toBe('alpha');
      component.closeDetail();
      expect(component.openNode).toBeNull();
    });

    it('gives the detail the actions the person holds', async () => {
      const all = create();
      expect(all.component.detailGrants).toEqual({ edit: true, refuse: true, allow: true, forget: true, drain: true });

      const viewer = create({}, ['nodes:node:list']);
      expect(viewer.component.detailGrants).toEqual({ edit: false, refuse: false, allow: false, forget: false, drain: false });
    });
  });

  describe('naming a runtime', () => {
    it('saves its name and note, trimmed, and reads the runtimes again', async () => {
      const { component, called, dialog } = create();
      await component.ngOnInit();

      component.startEditNode(component.nodes[0]);
      expect(dialog.opened).toEqual(['editDialog']);
      component.edit.name = '  Basement rack ';
      component.edit.note = ' By the boiler. ';
      await component.saveEdit();

      expect(called('updateNode')[0].args).toEqual(['alpha', { name: 'Basement rack', note: 'By the boiler.' }]);
      expect(component.notice).toBe('Saved.');
      expect(called('nodes').length).toBe(2);
    });

    it('refuses a name too long before asking, and shows the server’s refusal', async () => {
      const { component, called } = create({ updateNode: () => ({ error: 'No such runtime.' }) });
      await component.ngOnInit();

      component.startEditNode(component.nodes[0]);
      component.edit.name = 'x'.repeat(201);
      await component.saveEdit();
      expect(component.formError).toContain('200');
      expect(called('updateNode').length).toBe(0);

      component.edit.name = 'Rack';
      await component.saveEdit();
      expect(component.formError).toBe('No such runtime.');
    });
  });

  describe('making a token', () => {
    it('sends what the form says, and shows the secret once in the dialog', async () => {
      const { component, called, dialog, copied } = create();
      await component.ngOnInit();

      component.startCreate();
      expect(dialog.opened).toEqual(['editor']);
      component.form = { ...component.form, kind: 'sandbox', uses: '3', days: '2', labels: ' gpu, eu ,' };
      await component.save();

      expect(called('createToken')[0].args[0]).toEqual({ kind: 'sandbox', uses: 3, days: 2, labels: ['gpu', 'eu'], shared: false });
      expect(component.made).toEqual({ id: 'tok_new', token: 'dct_secret' });
      expect(called('tokens').length).toBe(2);
      component.copyMade();
      expect(copied).toEqual(['dct_secret']);
    });

    it('asks for a number of nodes: a token enrolls as many as it says', async () => {
      const { component, called } = create();
      component.form = { ...component.form, uses: ' ' };

      await component.save();

      expect(component.errorFor('uses')).toContain('1 or more');
      expect(called('createToken').length).toBe(0);
    });

    it('says what is wrong, under its field, before asking', async () => {
      const { component, called } = create();
      component.form = { ...component.form, uses: '0', days: '7' };

      await component.save();
      expect(component.errorFor('uses')).toContain('1 or more');
      component.form = { ...component.form, uses: '1', days: '400' };
      await component.save();
      expect(component.errorFor('days')).toContain('365');
      expect(called('createToken').length).toBe(0);
    });

    it('shows the server’s refusal in the form', async () => {
      const { component } = create({ createToken: () => ({ error: 'A token is for a runtime or a sandbox.' }) });

      await component.save();

      expect(component.formError).toBe('A token is for a runtime or a sandbox.');
      expect(component.made).toBeNull();
    });

    it('makes a join code with the same form, and shows it once to copy', async () => {
      const { component, called, copied } = create({ joinCode: () => ({ code: 'decentai-join:e30', expires: 1 }) });
      await component.ngOnInit();

      component.startCreate(true);
      component.form = { ...component.form, uses: '2', days: '1', labels: 'gpu' };
      await component.save();

      expect(called('joinCode')[0].args[0]).toEqual({ uses: 2, days: 1, labels: ['gpu'], shared: false });
      expect(called('createToken').length).toBe(0);
      expect(component.made?.token).toBe('decentai-join:e30');
      component.copyMade();
      expect(copied).toEqual(['decentai-join:e30']);
      component.startCreate();
      expect(component.joining).toBeFalse();
    });

    it('makes one for the whole deployment only for the operator', async () => {
      const notOperator = create();
      notOperator.component.form = { ...notOperator.component.form, scope: 'shared' };
      await notOperator.component.save();
      expect((notOperator.called('createToken')[0].args[0] as any).shared).toBeFalse();

      const operator = create({}, ALL, true, {}, true);
      operator.component.form = { ...operator.component.form, scope: 'shared' };
      await operator.component.save();
      expect((operator.called('createToken')[0].args[0] as any).shared).toBeTrue();
    });
  });

  describe('withdrawing a token', () => {
    it('asks, withdraws it, and reads the tokens again', async () => {
      const { component, called, asked } = create();
      await component.ngOnInit();

      await component.revoke(component.tokens[0]);

      expect(asked).toEqual(['Withdraw a?']);
      expect(called('revokeToken')[0].args).toEqual(['a']);
      expect(component.notice).toBe('a withdrawn.');
      expect(called('tokens').length).toBe(2);
    });

    it('does nothing when the person keeps it', async () => {
      const { component, called } = create({}, ALL, false);
      await component.ngOnInit();

      await component.revoke(component.tokens[0]);

      expect(called('revokeToken').length).toBe(0);
    });

    it('leaves a shared token to the operator, and a withdrawn one alone', () => {
      const { component } = create();

      expect(component.canRevoke(token('a'))).toBeTrue();
      expect(component.canRevoke(token('s', { metadata: {} }))).toBeFalse();
      expect(component.canRevoke(token('w', { withdrawn: true }))).toBeFalse();
      expect(create({}, ALL, true, {}, true).component.canRevoke(token('s', { metadata: {} }))).toBeTrue();
      expect(create({}, ['nodes:authority:list']).component.canRevoke(token('a'))).toBeFalse();
    });
  });

  describe('refusing a runtime', () => {
    it('asks for a reason, and refuses with it', async () => {
      const { component, called, dialog } = create();
      await component.ngOnInit();

      component.startRefuse(component.nodes[0]);
      expect(dialog.opened).toEqual(['refuseDialog']);
      component.reason = '  Lost in transit ';
      await component.submitRefuse();

      expect(called('refuse')[0].args).toEqual(['alpha', 'Lost in transit']);
      expect(component.notice).toBe('alpha refused.');
    });

    it('refuses a reason too long before asking', async () => {
      const { component, called } = create();
      await component.ngOnInit();

      await component.refuse(component.nodes[0], 'x'.repeat(301));

      expect(component.formError).toContain('300');
      expect(called('refuse').length).toBe(0);
    });

    it('is allowed again after asking', async () => {
      const { component, called, asked } = create();
      await component.ngOnInit();

      await component.allow(component.nodes[1]);

      expect(asked).toEqual(['Allow beta again?']);
      expect(called('allow')[0].args).toEqual(['beta']);
    });

    it('shows an action’s refusal', async () => {
      const { component } = create({ refuse: () => ({ error: 'No such runtime.' }) });
      await component.ngOnInit();

      await component.refuse(component.nodes[0]);

      expect(component.error).toBe('No such runtime.');
    });
  });

  describe('forgetting a runtime', () => {
    it('asks, forgets it and closes its detail', async () => {
      const { component, called, asked } = create();
      await component.ngOnInit();
      component.open(component.nodes[1]);

      await component.forget(component.nodes[1]);

      expect(asked).toEqual(['Forget beta?']);
      expect(called('forget')[0].args).toEqual(['beta']);
      expect(component.openId).toBe('');
      expect(component.notice).toBe('beta forgotten.');
    });

    it('says why the server would not', async () => {
      const { component } = create({ forget: () => ({ error: 'That runtime is connected, or still holds chats: refuse it first.' }) });
      await component.ngOnInit();

      await component.forget(component.nodes[0]);

      expect(component.error).toContain('refuse it first');
    });
  });

  describe('draining', () => {
    it('drains a sandbox after asking, resumes it without, and reads the runtimes again', async () => {
      const { component, called, asked } = create();
      await component.ngOnInit();
      const one = component.nodes[0].sandboxes[0];

      await component.drain(component.nodes[0], one, true);
      expect(asked).toEqual(['Drain sb-1 on alpha?']);
      expect(called('drain')[0].args).toEqual(['alpha', true, 'sb-1']);
      expect(called('nodes').length).toBe(2);

      await component.drain(component.nodes[0], one, false);
      expect(asked.length).toBe(1);
      expect(called('drain')[1].args).toEqual(['alpha', false, 'sb-1']);
    });

    it('drains the whole runtime after asking, and resumes it without', async () => {
      const { component, called, asked } = create();
      await component.ngOnInit();
      const pool = component.nodes[2];

      await component.drainAll(pool, true);
      expect(asked).toEqual(['Drain pool-1?']);
      expect(called('drain')[0].args).toEqual(['pool-1', true]);
      expect(component.notice).toBe('pool-1 is draining.');

      await component.drainAll(pool, false);
      expect(asked.length).toBe(1);
      expect(component.notice).toBe('pool-1 takes chats again.');
    });
  });

  describe('where chats run', () => {
    it('asks before keeping to the organization’s own runtimes, and saves', async () => {
      const { component, called, asked } = create();
      await component.ngOnInit();

      await component.choosePlacement('own_only');

      expect(asked).toEqual(['Run chats on your own runtimes only?']);
      expect(called('placement')[0].args).toEqual([{ runtimes: 'own_only' }]);
      expect(component.placement).toBe('own_only');
      expect(component.notice).toBe('Saved.');
    });

    it('stays where it was when the person does not go ahead', async () => {
      const { component, called } = create({}, ALL, false);
      await component.ngOnInit();

      await component.choosePlacement('own_only');

      expect(called('placement').length).toBe(0);
      expect(component.placement).toBe('prefer_own');
    });

    it('goes back when the server refuses', async () => {
      const { component } = create({
        settings: () => ({ runtimes: 'own_only' }),
        placement: () => ({ error: 'runtimes is one of: prefer_own, own_only.' }),
      });
      await component.ngOnInit();

      await component.choosePlacement('prefer_own');

      expect(component.placement).toBe('own_only');
      expect(component.error).toContain('runtimes is one of');
    });
  });

  it('adds up the counts from what is listed', () => {
    expect(overview([], [])).toEqual({ total: 0, connected: 0, refused: 0, sandboxes: 0, draining: 0, chats: 0, tokens: 0 });
  });
});

describe('NodesComponent, rendered', () => {
  let fixture: ComponentFixture<NodesComponent>;
  let root: HTMLElement;

  async function render(over: Record<string, any> = {}, granted = ALL) {
    const fake = fakeService(over);
    await TestBed.configureTestingModule({
      imports: [NodesComponent, NoopAnimationsModule, LucideAngularModule.pick(ICONS)],
      providers: [
        { provide: NodesService, useValue: fake.service },
        { provide: SettingsOrgService, useValue: fake.settings },
        { provide: AuthService, useValue: auth(granted) },
        { provide: ConfirmService, useValue: { ask: async () => true } },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(NodesComponent);
    root = fixture.nativeElement;
    await settle();
    return fake;
  }

  async function settle() {
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  afterEach(() => fixture?.destroy());

  const text = (within: Element = root) => within.textContent?.replace(/\s+/g, ' ') ?? '';
  const buttons = (label: string) =>
    Array.from(root.querySelectorAll<HTMLButtonElement>('button')).filter((b) => b.getAttribute('aria-label') === label);

  it('shows the counts, and the runtimes grouped by whom they serve', async () => {
    await render();

    const numbers = Array.from(root.querySelectorAll('.nodes-tile-number')).map((n) => text(n).trim());
    expect(numbers).toEqual(['2 of 3', '3', '2', '2']);
    const groups = Array.from(root.querySelectorAll('.nodes-group-name')).map((g) => g.textContent?.trim());
    expect(groups).toEqual(['Shared', 'This organization']);
    const rows = root.querySelectorAll('app-row.node-row');
    expect(rows.length).toBe(3);
    expect(rows[0].textContent).toContain('pool-1');
    expect(rows[0].textContent).toContain('Draining');
    expect(rows[2].textContent).toContain('Refused');
    expect(root.querySelector('app-row.authority-row')).toBeNull();
  });

  it('opens a runtime’s detail, with its sandboxes, chats and actions', async () => {
    await render();

    (root.querySelectorAll<HTMLElement>('app-row.node-row')[1]).click();
    await settle();

    const detail = root.querySelector('app-node-detail')!;
    expect(detail).not.toBeNull();
    expect(root.querySelector('app-row.node-row')).toBeNull();
    expect(text(detail)).toContain('alpha');
    expect(text(detail)).toContain('sb-1');
    expect(text(detail)).toContain('256 MB of 1.0 GB');
    expect(text(detail)).toContain('notebook, web');
    expect(text(detail)).toContain('2 chats of this organization');
    expect(buttons('Edit alpha').length).toBe(1);
    expect(buttons('Refuse alpha').length).toBe(1);
    expect(buttons('Drain sb-1 on alpha').length).toBe(1);
    expect(buttons('Drain alpha').length).toBe(1);
    // Connected: not to be forgotten yet.
    expect(buttons('Forget alpha')[0].disabled).toBeTrue();
  });

  it('shows a refused runtime, to be allowed again or forgotten', async () => {
    await render();
    fixture.componentInstance.open(fixture.componentInstance.nodes[1]);
    await settle();

    const detail = text(root.querySelector('app-node-detail')!);
    expect(detail).toContain('Every call from it is refused');
    expect(buttons('Allow beta again').length).toBe(1);
    expect(buttons('Forget beta')[0].disabled).toBeFalse();
  });

  it('shows the tokens with what can be done to each', async () => {
    await render();
    fixture.componentInstance.choose('tokens');
    await settle();

    const rows = root.querySelectorAll('app-row.authority-row');
    expect(rows.length).toBe(2);
    expect(text(rows[0])).toContain('1 node enrolled');
    expect(buttons('Withdraw a').length).toBe(1);
    // A shared one is the operator's.
    expect(buttons('Withdraw s').length).toBe(0);
    expect(text()).toContain('Make a token');
  });

  it('explains how a runtime joins when there is none', async () => {
    await render({ nodes: () => ({ nodes: [] }) });

    expect(text()).toContain('No nodes yet');
    const link = root.querySelector<HTMLAnchorElement>('app-empty a');
    expect(link?.href).toBe(NODES_DOCS);
  });

  it('says when no runtime matches the filters', async () => {
    await render();
    fixture.componentInstance.setFilter('query', 'nothing like it');
    // The search waits for the typing to stop, then asks the server.
    await new Promise((resolve) => setTimeout(resolve, 300));
    await settle();

    expect(text()).toContain('No node matches');
  });

  it('shows the reason the page could not be read', async () => {
    await render({ tokens: () => ({ tokens: [], enrolled: [], error: 'Not allowed.' }) });

    expect(text()).toContain('Nodes could not be loaded');
    expect(text()).toContain('Not allowed.');
  });

  it('shows only the views and actions the person holds', async () => {
    await render({}, ['nodes:node:list']);

    expect(root.querySelector('app-segmented')).toBeNull();
    expect(root.querySelectorAll('app-row.node-row').length).toBe(3);
    fixture.componentInstance.open(fixture.componentInstance.nodes[0]);
    await settle();

    expect(buttons('Edit alpha').length).toBe(0);
    expect(buttons('Refuse alpha').length).toBe(0);
    expect(buttons('Forget alpha').length).toBe(0);
    expect(buttons('Drain sb-1 on alpha').length).toBe(0);
    expect(buttons('Drain alpha').length).toBe(0);
  });
});

describe('The Nodes settings page', () => {
  const page = settingsPages.find((candidate) => candidate.path === 'nodes')!;
  const opens = (granted: string[]) => settingsPageOpen(page, (action) => granted.includes(action));

  it('is hidden from a person without a grant to any of its sections', () => {
    expect(page.group).toBe('Organization');
    expect(opens([])).toBeFalse();
    expect(opens(['settings:llm:list'])).toBeFalse();
  });

  it('opens for any one of its sections', () => {
    expect(opens(['nodes:node:list'])).toBeTrue();
    expect(opens(['nodes:authority:list'])).toBeTrue();
    expect(opens(['settings:organization:get'])).toBeTrue();
  });
});
