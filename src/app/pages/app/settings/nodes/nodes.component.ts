import { NgFor, NgIf } from '@angular/common';
import { Clipboard } from '@angular/cdk/clipboard';
import { Component, NgZone, OnDestroy, OnInit, Optional, TemplateRef, ViewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatDialog, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatTooltipModule } from '@angular/material/tooltip';
import { ActivatedRoute, Params, Router } from '@angular/router';
import { LucideAngularModule } from 'lucide-angular';
import { Subscription } from 'rxjs';

import { ChoiceCardsComponent } from 'src/app/components/ui/choice-cards.component';
import { clockTime, fullDate, relativeDate } from 'src/app/components/ui/dates';
import { EmptyComponent } from 'src/app/components/ui/empty.component';
import { FieldComponent } from 'src/app/components/ui/field.component';
import { ListComponent } from 'src/app/components/ui/list.component';
import { PagerComponent } from 'src/app/components/ui/pager.component';
import { ServerPage, ServerPages } from 'src/app/components/ui/paging';
import { PillsComponent } from 'src/app/components/ui/pills.component';
import { Choice } from 'src/app/components/ui/radio-keys';
import { RowComponent } from 'src/app/components/ui/row.component';
import { SegmentedComponent } from 'src/app/components/ui/segmented.component';
import { SelectComponent } from 'src/app/components/ui/select.component';
import { SwitchComponent } from 'src/app/components/ui/switch.component';
import { AuthService } from 'src/app/services/auth.service';
import { ConfirmService } from 'src/app/services/confirm.service';
import {
  EnrolledNode, EnrollmentToken, ExecutionNode, NODE_NAME_MAX, NodeCounts, NodeQuery, NodeSandbox, NodesService, NOTE_MAX,
  REASON_MAX,
} from 'src/app/services/nodes.service';
import { OrgSettings, SettingsOrgService } from 'src/app/services/settings-org.service';
import { DataPageBase } from '../../data-page-base';
import { NodeDetailComponent, NodeDetailGrants } from './node-detail.component';
import {
  filtersOn, groupNodes, isShared, NO_FILTERS, NodeFilters, NodeGroup, nodeFacts, nodeLabel,
  nodeState, NodeStateFilter, overview, NodesOverview, plural, scopeName, STATE_WORDS, TOKEN_WORDS, tokenFacts,
  tokenState,
} from './nodes-words';

/** Where the docs say how a runtime joins. */
export const NODES_DOCS =
  'https://github.com/decentai-io/decentai/blob/main/documentation/api-server.md#10-runtimes';

/** How often the page reads the nodes again while it is in view. */
export const REFRESH_MS = 15_000;

export type NodesView = 'nodes' | 'tokens' | 'placement';

/** Where the organization's chats may run. */
type Placement = OrgSettings['runtimes'];

/** What the token form holds. */
interface TokenForm {
  kind: 'runtime' | 'sandbox';
  /** How many nodes it may enroll, as typed. */
  uses: string;
  /** How many days it enrolls. */
  days: string;
  /** Labels, separated by commas. */
  labels: string;
  scope: 'organization' | 'shared';
}

const BLANK_FORM: TokenForm = { kind: 'runtime', uses: '1', days: '7', labels: '', scope: 'organization' };

/** What the edit dialog holds: a runtime's name and note. */
interface EditForm {
  id: string;
  /** What it is called now, for the dialog's title. */
  title: string;
  name: string;
  note: string;
}

/**
 * Settings › Nodes: the runtimes this organization's chats run on, the
 * enrollment tokens that let a runtime or a sandbox join, and whether the
 * chats keep to the organization's own runtimes — three views behind one
 * switch, under a line of counts.
 *
 * Nobody registers a runtime. An administrator makes a token, the
 * runtime is given it, enrolls by itself, and is listed once it reports.
 * So the list is a view the API server keeps, searched, filtered and
 * grouped: the organization's own, and, for the operator, the shared
 * ones. Opening one shows all of it, and what can be done to it: a name
 * and a note given, drained, refused or allowed again, forgotten once it
 * is gone, and its sandboxes drained.
 *
 * The view and the node open are in the address (`?view=tokens`,
 * `?node=<id>`), so a link opens them and Back closes them. While the
 * page is in view it reads the nodes again every few seconds, in place.
 *
 * Each view is a grant of its own, and is shown only to whoever holds
 * it. Shared tokens are the deployment operator's (`auth.operator`).
 */
@Component({
  selector: 'app-nodes',
  standalone: true,
  imports: [
    NgFor, NgIf, FormsModule, MatDialogModule, MatTooltipModule, LucideAngularModule,
    ChoiceCardsComponent, EmptyComponent, FieldComponent, ListComponent, RowComponent,
    SegmentedComponent, SelectComponent, SwitchComponent, NodeDetailComponent, PagerComponent, PillsComponent,
  ],
  templateUrl: './nodes.component.html',
  styleUrl: './nodes.component.css',
})
export class NodesComponent extends DataPageBase implements OnInit, OnDestroy {
  readonly docs = NODES_DOCS;
  readonly nameMax = NODE_NAME_MAX;
  readonly noteMax = NOTE_MAX;
  readonly reasonMax = REASON_MAX;

  loading = true;
  /** Why the page could not be read. */
  loadError = '';
  /** When the page last read the API server, and whether the last quiet
   *  reading failed. */
  updatedAt: Date | null = null;
  refreshFailed = false;
  refreshing = false;

  /** The nodes twenty to a page; the tokens, taller, ten: each paged,
   *  searched and filtered on the API server. */
  readonly nodePages = new ServerPages<ExecutionNode>(20, (after, limit) => this.pageNodes(after, limit));
  readonly tokenPages = new ServerPages<EnrollmentToken>(10, (after, limit) => this.pageTokens(after, limit));
  /** The server's numbers of the runtimes and the tokens, whatever the
   *  search; null where it gave none (the page's rows are counted). */
  nodeCounts: NodeCounts | null = null;
  tokenCounts: { live: number; spent: number } | null = null;
  /** The nodes the listed tokens enrolled. */
  enrolled: EnrolledNode[] = [];
  /** Whether tokens that enroll nobody any more are shown too. */
  showSpent = false;
  /** A token just made: its secret, shown this once. */
  made: { id: string; token: string } | null = null;

  placement: Placement = 'prefer_own';
  savingPlacement = false;

  view: NodesView = 'nodes';
  views: Choice<NodesView>[] = [];
  /** The node open in the detail, by id. */
  openId = '';
  filters: NodeFilters = { ...NO_FILTERS };

  /** The row an action is on its way for: a token's id, a node's id, or
   *  `<node id>#<sandbox>`. */
  busy = '';

  // ── The dialogs ─────────────────────────────────────────────────────

  form: TokenForm = { ...BLANK_FORM };
  saving = false;
  /** Why the open dialog's form was refused, by the page or the server. */
  formError = '';
  /** Add was pressed with something missing: from then on the form
   *  says what, under the field it belongs to. */
  private tried = false;

  edit: EditForm = { id: '', title: '', name: '', note: '' };
  /** The node being refused, and why. */
  refusing: ExecutionNode | null = null;
  reason = '';

  @ViewChild('editor') private editor?: TemplateRef<unknown>;
  @ViewChild('editDialog') private editDialog?: TemplateRef<unknown>;
  @ViewChild('refuseDialog') private refuseDialog?: TemplateRef<unknown>;
  private dialogRef?: MatDialogRef<unknown>;

  readonly kinds: Choice<TokenForm['kind']>[] = [
    { value: 'runtime', name: 'Runtime' },
    { value: 'sandbox', name: 'Sandbox' },
  ];

  readonly scopes: Choice<TokenForm['scope']>[] = [
    { value: 'organization', name: 'This organization',
      hint: 'Its runtimes run this organization\'s chats only.' },
    { value: 'shared', name: 'The whole deployment',
      hint: 'Its runtimes may run the chats of every organization that does not keep to its own.' },
  ];

  readonly placements: Choice<Placement>[] = [
    { value: 'prefer_own', name: 'Own runtimes first',
      hint: 'Shared runtimes run chats while none of this organization\'s own has room.' },
    { value: 'own_only', name: 'Own runtimes only',
      hint: 'Chats never run on a shared runtime. With none of your own connected, they wait.' },
  ];

  readonly stateChoices: Choice<NodeStateFilter>[] = [
    { value: 'all', name: 'Any state' },
    { value: 'connected', name: 'Connected' },
    { value: 'away', name: 'Not connected' },
    { value: 'refused', name: 'Refused' },
  ];

  readonly nodeLabel = nodeLabel;
  readonly nodeFacts = nodeFacts;
  readonly scopeName = scopeName;
  readonly isShared = isShared;
  readonly relativeDate = relativeDate;
  readonly fullDate = fullDate;

  private timer?: ReturnType<typeof setInterval>;

  private destroyed = false;
  private address?: Subscription;
  private readonly onVisible = () => {
    if (this.visible() && this.stale()) void this.refresh();
  };

  constructor(
    private service: NodesService,
    private auth: AuthService,
    private settings: SettingsOrgService,
    private dialog: MatDialog,
    private confirm: ConfirmService,
    @Optional() private router?: Router,
    @Optional() private route?: ActivatedRoute,
    @Optional() private clipboard?: Clipboard,
    @Optional() private zone?: NgZone,
  ) {
    super();
  }

  // ── Who may do what ─────────────────────────────────────────────────

  get canListNodes(): boolean { return this.auth.can('nodes:node:list'); }
  get canRefuse(): boolean { return this.auth.can('nodes:node:refuse'); }
  get canAllow(): boolean { return this.auth.can('nodes:node:allow'); }
  get canDrain(): boolean { return this.auth.can('nodes:node:drain'); }
  get canEditNode(): boolean { return this.auth.can('nodes:node:update'); }
  get canForget(): boolean { return this.auth.can('nodes:node:forget'); }
  get canListTokens(): boolean { return this.auth.can('nodes:authority:list'); }
  get canCreateToken(): boolean { return this.auth.can('nodes:authority:create'); }
  get canSeePlacement(): boolean { return this.auth.can('settings:organization:get'); }
  get canSetPlacement(): boolean { return this.auth.can('settings:organization:update'); }

  /** The deployment's operator alone makes and withdraws shared tokens. */
  get operator(): boolean { return this.auth.operator; }

  /** A live token may be withdrawn; a shared one by the operator alone. */
  canRevoke(token: EnrollmentToken): boolean {
    return !token.withdrawn && this.auth.can('nodes:authority:revoke') && (!!token.metadata?.scope || this.operator);
  }

  /** What may be done to the node open in the detail. A node listed is
   *  one this person's grants reach: its organization's, or a shared
   *  one for the operator. */
  get detailGrants(): NodeDetailGrants {
    return {
      edit: this.canEditNode, refuse: this.canRefuse, allow: this.canAllow,
      forget: this.canForget, drain: this.canDrain,
    };
  }

  // ── Reading ─────────────────────────────────────────────────────────

  async ngOnInit(): Promise<void> {
    this.views = [
      ...(this.canListNodes ? [{ value: 'nodes' as const, name: 'Nodes' }] : []),
      ...(this.canListTokens ? [{ value: 'tokens' as const, name: 'Enrollment tokens' }] : []),
      ...(this.canSeePlacement ? [{ value: 'placement' as const, name: 'Where chats run' }] : []),
    ];
    this.follow(this.route?.snapshot?.queryParams ?? {});
    this.address = this.route?.queryParams?.subscribe((params) => this.follow(params));
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', this.onVisible);
    await this.load();
    // Left before the first reading came back: ngOnDestroy has run, and
    // a timer started now would never be stopped.
    if (this.destroyed) return;
    // Outside Angular's zone, so a page left open is still "stable" (the
    // service worker and the tests wait for that); each reading is back
    // inside it, so what it changes is drawn.
    const tick = () => {
      if (this.visible()) void (this.zone ? this.zone.run(() => this.refresh()) : this.refresh());
    };
    this.timer = this.zone
      ? this.zone.runOutsideAngular(() => setInterval(tick, REFRESH_MS))
      : setInterval(tick, REFRESH_MS);
  }

  ngOnDestroy(): void {
    this.destroyed = true;
    this.nodePages.cancel();
    if (this.timer) clearInterval(this.timer);
    this.address?.unsubscribe();
    if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', this.onVisible);
  }

  async load(): Promise<void> {
    this.loading = true;
    this.loadError = '';
    try {
      const failed = await this.readAll();
      this.loadError = failed;
      if (!failed) this.updatedAt = new Date();
    } catch {
      this.loadError = 'Could not reach the server. Check your connection.';
    } finally {
      this.loading = false;
    }
  }

  /** The nodes, the tokens and where chats run read again, in
   *  place: what is shown stays until the answer replaces it, and a
   *  failure says so beside the time without taking the page away. */
  async refresh(): Promise<void> {
    if (this.refreshing || this.loading || this.loadError) return;
    this.refreshing = true;
    try {
      this.refreshFailed = !!(await this.readAll());
      if (!this.refreshFailed) this.updatedAt = new Date();
    } catch {
      this.refreshFailed = true;
    } finally {
      this.refreshing = false;
    }
  }

  /** Each reader answers with why it failed, or ''; this the first. */
  private async readAll(): Promise<string> {
    const failed = await Promise.all([
      this.canListNodes ? this.readNodes() : Promise.resolve(''),
      this.canListTokens ? this.readTokens() : Promise.resolve(''),
      this.canSeePlacement ? this.readPlacement() : Promise.resolve(''),
    ]);
    return failed.find((reason) => reason) ?? '';
  }

  /** The page of nodes shown read again; the first, the first time. */
  private async readNodes(): Promise<string> {
    await (this.nodePages.loaded ? this.nodePages.reload() : this.nodePages.first());
    return this.nodePages.error;
  }

  private async readTokens(): Promise<string> {
    await (this.tokenPages.loaded ? this.tokenPages.reload() : this.tokenPages.first());
    return this.tokenPages.error;
  }

  private async pageNodes(after: string, limit: number): Promise<ServerPage<ExecutionNode>> {
    const page = await this.service.nodes(this.nodeQuery(), after, limit);
    if (!page.error) this.nodeCounts = page.counts;
    return { rows: page.nodes, next: page.next ?? null, total: page.total ?? page.nodes.length, error: page.error };
  }

  private async pageTokens(after: string, limit: number): Promise<ServerPage<EnrollmentToken>> {
    const page = await this.service.tokens(this.showSpent ? {} : { state: 'live' }, after, limit);
    if (!page.error) {
      this.tokenCounts = page.counts ?? null;
      this.enrolled = page.enrolled;
    }
    return { rows: page.tokens, next: page.next ?? null, total: page.total ?? page.tokens.length, error: page.error };
  }

  /** The filters as the server takes them: a scope is shared, or the
   *  organization's own. */
  private nodeQuery(): NodeQuery {
    const filters = this.filters;
    return {
      ...(filters.query.trim() ? { q: filters.query.trim() } : {}),
      ...(filters.state !== 'all' ? { state: filters.state } : {}),
      ...(filters.scope !== 'all' ? { scope: isShared({ scope: filters.scope }) ? 'shared' as const : 'own' as const } : {}),
    };
  }

  /** The nodes of the page shown. */
  get nodes(): ExecutionNode[] {
    return this.nodePages.rows;
  }

  /** The tokens of the page shown. */
  get tokens(): EnrollmentToken[] {
    return this.tokenPages.rows;
  }

  private async readPlacement(): Promise<string> {
    try {
      this.placement = (await this.settings.get()).runtimes;
      return '';
    } catch (failed) {
      return failed instanceof Error ? failed.message : 'Where chats run could not be read.';
    }
  }

  private visible(): boolean {
    return typeof document === 'undefined' || document.visibilityState !== 'hidden';
  }

  private stale(): boolean {
    return !this.updatedAt || Date.now() - this.updatedAt.getTime() > REFRESH_MS;
  }

  /** "Updated 11:34:08", or why not. */
  get updatedLine(): string {
    if (this.refreshFailed) return 'Could not refresh';
    return this.updatedAt ? `Updated ${clockTime(this.updatedAt)}` : '';
  }

  // ── The address: which view, which node ─────────────────────────────

  /** The view and the node the address names, of those this person
   *  may open. */
  private follow(params: Params): void {
    const named = String(params['view'] || '') as NodesView;
    const offered = this.views.map((choice) => choice.value);
    this.view = offered.includes(named) ? named : offered[0] ?? 'nodes';
    this.openId = this.view === 'nodes' ? String(params['node'] || '') : '';
  }

  private go(params: Params): void {
    if (!this.router || !this.route) {
      this.follow(params);
      return;
    }
    void this.router.navigate([], { relativeTo: this.route, queryParams: params });
  }

  choose(view: NodesView): void {
    if (view === this.view && !this.openId) return;
    this.go(view === this.views[0]?.value ? {} : { view });
  }

  open(node: ExecutionNode): void {
    this.go({ ...(this.view === this.views[0]?.value ? {} : { view: 'nodes' }), node: node.node_id });
  }

  closeDetail(): void {
    this.go(this.views[0]?.value === 'nodes' ? {} : { view: 'nodes' });
  }

  /** The node open in the detail, once it is listed. */
  get openNode(): ExecutionNode | null {
    if (!this.openId) return null;
    return this.nodes.find((node) => node.node_id === this.openId) ?? null;
  }

  // ── The counts at the head ──────────────────────────────────────────

  /** The numbers at the head: the server's, whatever the search; where
   *  it gave none, those of the rows read. */
  get counts(): NodesOverview {
    const read = overview(this.nodes, this.tokens);
    const nodes = this.nodeCounts;
    return {
      ...(nodes ? {
        total: nodes.total, connected: nodes.connected, refused: nodes.refused, sandboxes: nodes.sandboxes,
        draining: nodes.draining, chats: nodes.chats,
      } : read),
      tokens: this.tokenCounts ? this.tokenCounts.live : read.tokens,
    };
  }

  plural = plural;

  // ── Nodes ───────────────────────────────────────────────────────────

  /** The nodes of the page shown, as the server searched and filtered. */
  get shownNodes(): ExecutionNode[] {
    return this.nodes;
  }

  get groups(): NodeGroup[] {
    return groupNodes(this.shownNodes);
  }

  /** The nodes of the page shown, in their groups: shared runtimes
   *  first, then the organization's own, connected first. */
  get pagedGroups(): Array<NodeGroup & { shown: ExecutionNode[] }> {
    return this.groups.map((group) => ({ ...group, shown: group.nodes }));
  }

  get filtering(): boolean {
    return filtersOn(this.filters);
  }

  clearFilters(): void {
    this.filters = { ...NO_FILTERS };
    void this.nodePages.first();
  }

  /** A filter changed: the first page asked of the server again, once
   *  the typing stops for a search. */
  setFilter<K extends keyof NodeFilters>(key: K, value: NodeFilters[K]): void {
    this.filters = { ...this.filters, [key]: value };
    if (key === 'query') this.nodePages.search();
    else void this.nodePages.first();
  }

  /** Whom the nodes are for, to filter by: offered where there are both
   *  shared runtimes and the organization's own. */
  get scopeChoices(): Choice<string>[] {
    const counts = this.nodeCounts;
    const seen = new Map<string, string>();
    for (const node of this.nodes) seen.set(node.scope, scopeName(node));
    const own = this.auth.organization?.org_id ?? [...seen.keys()].find((scope) => !isShared({ scope })) ?? '';
    const both = counts ? counts.shared > 0 && counts.own > 0 : seen.size >= 2;
    if (!both && this.filters.scope === 'all') return [];
    return [
      { value: 'all', name: 'Any organization' },
      { value: '', name: scopeName({ scope: '' }) },
      { value: own, name: scopeName({ scope: own || 'own' }) },
    ];
  }

  get nodesFoot(): string {
    const counts = this.counts;
    if (!counts.total && !this.nodes.length) return '';
    const all = `${counts.connected} connected · ${counts.total} in all`;
    return this.filtering ? `${this.nodePages.total} shown · ${all}` : all;
  }

  stateOf(node: ExecutionNode) {
    const state = nodeState(node);
    return { word: STATE_WORDS[state], tone: state === 'connected' ? 'live' : state === 'refused' ? 'danger' : '' };
  }

  draining(node: ExecutionNode): boolean {
    return node.draining || node.sandboxes.some((sandbox) => sandbox.draining);
  }

  byNode(_: number, node: ExecutionNode): string {
    return node.node_id;
  }

  byGroup(_: number, group: NodeGroup): string {
    return group.scope;
  }

  /** Names the node in a sentence. */
  private named(node: ExecutionNode): string {
    return nodeLabel(node);
  }

  // ── Acting on a node ────────────────────────────────────────────────

  startRefuse(node: ExecutionNode): void {
    this.refusing = node;
    this.reason = '';
    this.formError = '';
    this.openDialog(this.refuseDialog, '480px');
  }

  /** Refused with the reason given; the dialog asked first. */
  async refuse(node: ExecutionNode, reason = ''): Promise<void> {
    const why = reason.trim();
    if (why.length > REASON_MAX) {
      this.formError = `A reason is ${REASON_MAX} characters or fewer.`;
      return;
    }
    await this.act(node.node_id, async () => {
      const result = await this.service.refuse(node.node_id, why);
      if (result.error) {
        if (this.dialogRef) this.formError = result.error;
        else this.fail(result.error);
        return;
      }
      this.closeDialog();
      await this.readNodes();
      this.flash(`${this.named(node)} refused.`);
    });
  }

  async submitRefuse(): Promise<void> {
    if (this.refusing) await this.refuse(this.refusing, this.reason);
  }

  async allow(node: ExecutionNode): Promise<void> {
    const sure = await this.confirm.ask({
      title: `Allow ${this.named(node)} again?`,
      body: 'It is heard from again the next time it reports.',
      confirm: 'Allow',
    });
    if (!sure) return;
    await this.act(node.node_id, async () => {
      const result = await this.service.allow(node.node_id);
      if (result.error) return this.fail(result.error);
      await this.readNodes();
      this.flash(`${this.named(node)} allowed.`);
    });
  }

  async forget(node: ExecutionNode): Promise<void> {
    const sure = await this.confirm.ask({
      title: `Forget ${this.named(node)}?`,
      body: (node.refused
        ? 'It is taken off the list, with its name and note. It stays refused: if it comes back, it is not heard.'
        : 'It is taken off the list, with its name and note. While its certificate stands, it is listed again the next time it reports.'),
      confirm: 'Forget',
      danger: true,
    });
    if (!sure) return;
    await this.act(node.node_id, async () => {
      const result = await this.service.forget(node.node_id);
      if (result.error) return this.fail(result.error);
      if (this.openId === node.node_id) this.closeDetail();
      await this.readNodes();
      this.flash(`${this.named(node)} forgotten.`);
    });
  }

  /** Drains a sandbox after asking; lets one take work again at once. */
  async drain(node: ExecutionNode, sandbox: NodeSandbox, on: boolean): Promise<void> {
    if (on) {
      const sure = await this.confirm.ask({
        title: `Drain ${sandbox.sandbox_id} on ${this.named(node)}?`,
        body: 'No new process is started there. Agents running there finish what they are doing.',
        confirm: 'Drain',
      });
      if (!sure) return;
    }
    await this.act(`${node.node_id}#${sandbox.sandbox_id}`, async () => {
      const result = await this.service.drain(node.node_id, on, sandbox.sandbox_id);
      if (result.error) return this.fail(result.error);
      await this.readNodes();
      this.flash(on ? `${sandbox.sandbox_id} is draining.` : `${sandbox.sandbox_id} takes work again.`);
    });
  }

  /** The whole runtime drained after asking, or let take chats again at
   *  once. */
  async drainAll(node: ExecutionNode, on: boolean): Promise<void> {
    if (on) {
      const sure = await this.confirm.ask({
        title: `Drain ${this.named(node)}?`,
        body: 'No new chat is placed on it. The chats it holds go on; it learns of it when it next reports.',
        confirm: 'Drain',
      });
      if (!sure) return;
    }
    await this.act(node.node_id, async () => {
      const result = await this.service.drain(node.node_id, on);
      if (result.error) return this.fail(result.error);
      await this.readNodes();
      this.flash(on ? `${this.named(node)} is draining.` : `${this.named(node)} takes chats again.`);
    });
  }

  // ── Naming a node ───────────────────────────────────────────────────

  startEditNode(node: ExecutionNode): void {
    this.edit = { id: node.node_id, title: this.named(node), name: node.name, note: node.note };
    this.formError = '';
    this.openDialog(this.editDialog, '520px');
  }

  /** What is wrong with the edit, before the server is asked. */
  get editProblem(): string {
    if (this.edit.name.trim().length > NODE_NAME_MAX) return `A name is ${NODE_NAME_MAX} characters or fewer.`;
    if (this.edit.note.trim().length > NOTE_MAX) return `A note is ${NOTE_MAX} characters or fewer.`;
    return '';
  }

  async saveEdit(): Promise<void> {
    if (this.saving) return;
    const problem = this.editProblem;
    if (problem) {
      this.formError = problem;
      return;
    }
    this.saving = true;
    this.formError = '';
    if (this.dialogRef) this.dialogRef.disableClose = true;
    try {
      const edit = this.edit;
      const result = await this.service.updateNode(edit.id, { name: edit.name.trim(), note: edit.note.trim() });
      if (result.error) {
        this.formError = result.error;
        return;
      }
      if (this.dialogRef) this.dialogRef.disableClose = false;
      this.closeDialog();
      await this.readNodes();
      this.flash('Saved.');
    } catch {
      this.formError = 'Could not reach the server. Check your connection.';
    } finally {
      this.saving = false;
      if (this.dialogRef) this.dialogRef.disableClose = false;
    }
  }

  // ── Enrollment tokens ───────────────────────────────────────────────

  /** Tokens that enroll nobody any more: withdrawn, used up or expired. */
  get spentCount(): number {
    if (this.tokenCounts) return this.tokenCounts.spent;
    return this.tokens.filter((token) => tokenState(token) !== 'live').length;
  }

  /** How many tokens can enroll, the server's count. */
  get liveCount(): number {
    if (this.tokenCounts) return this.tokenCounts.live;
    return this.tokens.filter((token) => tokenState(token) === 'live').length;
  }

  /** The tokens of the page shown: those that can enroll, and the spent
   *  ones too when asked for, newest first, as the server reads them. */
  get visibleTokens(): EnrollmentToken[] {
    return this.showSpent ? this.tokens : this.tokens.filter((token) => tokenState(token) === 'live');
  }

  /** The spent tokens shown, or not: the first page asked again. */
  setShowSpent(show: boolean): Promise<void> {
    this.showSpent = show;
    return this.tokenPages.first();
  }

  get tokensFoot(): string {
    const live = this.liveCount;
    const spent = this.spentCount;
    if (!live && !spent) return '';
    return spent ? `${live} can enroll · ${spent} spent` : `${live} can enroll`;
  }

  tokenWord(token: EnrollmentToken): string {
    return TOKEN_WORDS[tokenState(token)];
  }

  tokenLive(token: EnrollmentToken): boolean {
    return tokenState(token) === 'live';
  }

  tokenFacts(token: EnrollmentToken): string[] {
    return tokenFacts(token, this.enrolled.filter((node) => node.token === token._id).length);
  }

  tokenName(token: EnrollmentToken): string {
    return `${token.kind === 'sandbox' ? 'Sandbox' : 'Runtime'} token ${token._id}`;
  }

  async revoke(token: EnrollmentToken): Promise<void> {
    const sure = await this.confirm.ask({
      title: `Withdraw ${token._id}?`,
      body: 'It enrolls nobody from now on, and the nodes it enrolled are not renewed: each stops when its '
        + 'certificate ends. A withdrawn token cannot be restored.',
      confirm: 'Withdraw',
      danger: true,
    });
    if (!sure) return;
    await this.act(token._id, async () => {
      const result = await this.service.revokeToken(token._id);
      if (result.error) return this.fail(result.error);
      await this.readTokens();
      this.flash(`${token._id} withdrawn.`);
    });
  }

  // ── The token form ──────────────────────────────────────────────────

  startCreate(): void {
    this.form = { ...BLANK_FORM };
    this.made = null;
    this.formError = '';
    this.tried = false;
    this.openDialog(this.editor, '560px');
  }

  /** What is wrong, with the field it belongs to: the issuer's own rules,
   *  so the form refuses before the round trip. */
  private get missingField(): { field: string; message: string } | null {
    const uses = this.form.uses.trim();
    if (!(/^\d+$/.test(uses) && Number(uses) >= 1)) {
      return { field: 'uses', message: 'A whole number of nodes, 1 or more.' };
    }
    const days = Number(this.form.days);
    if (!(days > 0 && days <= 365)) return { field: 'days', message: 'More than 0 days, and 365 at most.' };
    return null;
  }

  /** What is wrong with this field, once Make has been pressed. */
  errorFor(field: string): string {
    const missing = this.tried ? this.missingField : null;
    return missing?.field === field ? missing.message : '';
  }

  async save(): Promise<void> {
    if (this.saving) return;
    if (this.missingField) {
      this.tried = true;
      return;
    }
    this.saving = true;
    this.formError = '';
    if (this.dialogRef) this.dialogRef.disableClose = true;
    try {
      const form = this.form;
      const result = await this.service.createToken({
        kind: form.kind,
        uses: Number(form.uses),
        days: Number(form.days),
        labels: form.labels.split(',').map((label) => label.trim()).filter(Boolean),
        shared: this.operator && form.scope === 'shared',
      });
      if (result.error || !result.token || !result.id) {
        this.formError = result.error || 'The token could not be made.';
        return;
      }
      // Shown this once, in the same dialog: the issuer keeps only its hash.
      this.made = { id: result.id, token: result.token };
      await this.readTokens();
    } finally {
      this.saving = false;
      if (this.dialogRef) this.dialogRef.disableClose = false;
    }
  }

  copyMade(): void {
    if (this.made && this.clipboard?.copy(this.made.token)) this.flash('Token copied.');
  }

  // ── Where chats run ─────────────────────────────────────────────────

  /** Saved as soon as it is chosen. Keeping to the organization's own
   *  runtimes can leave chats waiting, so it is asked first. */
  async choosePlacement(choice: Placement): Promise<void> {
    const before = this.placement;
    if (choice === before || this.savingPlacement) return;
    this.placement = choice;
    if (choice === 'own_only') {
      const sure = await this.confirm.ask({
        title: 'Run chats on your own runtimes only?',
        body: this.ownConnected
          ? 'A chat placed from now on is placed on one of your own.'
          : 'None of your own runtimes is connected, so chats wait until one is.',
        confirm: 'Own runtimes only',
      });
      if (!sure) {
        this.placement = before;
        return;
      }
    }
    this.savingPlacement = true;
    try {
      const result = await this.settings.update({ runtimes: choice });
      if (result.error || !result.settings) {
        this.placement = before;
        return this.fail(result.error || 'Where chats run could not be saved.');
      }
      this.placement = result.settings.runtimes;
      this.flash('Saved.');
    } finally {
      this.savingPlacement = false;
    }
  }

  /** The organization's own runtimes connected now, as last listed. */
  get ownConnected(): number {
    if (this.nodeCounts?.own_connected !== undefined) return this.nodeCounts.own_connected;
    return this.nodes.filter((node) => !isShared(node) && node.live && !node.refused).length;
  }

  get ownConnectedLine(): string {
    const count = this.ownConnected;
    if (!count) return 'None of this organization\'s own runtimes is connected now.';
    return count === 1 ? '1 of this organization\'s own runtimes is connected now.'
      : `${count} of this organization's own runtimes are connected now.`;
  }

  // ── Plumbing ────────────────────────────────────────────────────────

  private openDialog(template: TemplateRef<unknown> | undefined, width: string): void {
    if (!template || this.dialogRef) return;
    this.dialogRef = this.dialog.open(template, { width, maxWidth: '100vw' });
    this.dialogRef.afterClosed().subscribe(() => {
      this.dialogRef = undefined;
      this.refusing = null;
    });
  }

  closeDialog(): void {
    if (this.saving) return;
    this.dialogRef?.close();
  }

  private async act(key: string, work: () => Promise<void>): Promise<void> {
    if (this.busy) return;
    this.busy = key;
    try {
      await work();
    } catch {
      this.fail('Could not reach the server. Check your connection.');
    } finally {
      this.busy = '';
    }
  }
}
