import { Component, OnInit, TemplateRef, ViewChild } from '@angular/core';
import { Refused } from 'src/app/services/request.service';
import { MatDialog, MatDialogRef } from '@angular/material/dialog';

import { AgentsService } from 'src/app/services/agents.service';
import { AuthService, CatalogAction } from 'src/app/services/auth.service';
import { Policy, PolicyService, PolicyStatement } from 'src/app/services/policy.service';
import { ConfirmService } from 'src/app/services/confirm.service';
import { DataPageBase } from '../../app/data-page-base';
import { Paging } from 'src/app/components/ui/paging';
import { NamedAgent, PolicyWords, serviceName } from './policy-words';

/** The actions of one service, as the grid draws them. */
export interface ActionGroup {
  /** `iam:user`. */
  key: string;
  label: string;
  actions: { action: string; name: string }[];
}

/** One statement of a policy, as the list says it. */
export interface StatementLine {
  effect: string;
  /** The statement asks the chat's person: amber, for what needs a person. */
  asks: boolean;
  items: string[];
  scopes: string;
}

/** How many of a statement's actions are named before "and N more". */
const SHOWN_ITEMS = 6;
/** And the statements a policy shows before it is opened whole. */
const SHOWN_STATEMENTS = 4;

/**
 * Admin → Policies: what groups may do in the platform itself.
 *
 * A group gives its people its policies; a policy is a list of
 * statements, each allowing, denying or asking for actions. The list
 * says each statement in words. Written here, the common shape, "allow
 * these", is a grid of the endpoints the API server knows (the catalog
 * it validates against, so the editor cannot offer an action that does
 * not exist). A whole service is stored as its wildcard
 * (`secrets:secret:*`), so a policy keeps meaning "all of it" as actions
 * are added.
 *
 * Who may use an agent is chosen on the agent's own page (its Access
 * tab), where it goes with the agent. A policy may still name agents'
 * actions (`agent:<agent>:<function>`) in its document; the list points
 * to the agent's page for them.
 *
 * A deny, an ask, scopes, or a pattern no box stands for cannot be drawn
 * as checkboxes without lying about them: such a policy is edited as its
 * document, and any policy can be.
 *
 * The API server refuses a statement allowing what its author does not
 * hold; its refusal names the action.
 */
@Component({
  selector: 'app-policies',
  standalone: false,
  templateUrl: './policies.component.html',
  styleUrls: ['../admin-shared.css', './policies.component.css'],
})
export class PoliciesComponent extends DataPageBase implements OnInit {
  loading = true;

  policies: Policy[] = [];
  /** The endpoints' actions, by service. */
  catalog: ActionGroup[] = [];
  /** Says actions in words. */
  words = new PolicyWords([], []);
  /** The installed agents, to name their actions and link to them. */
  private agentIds = new Set<string>();
  /** The policies whose every action is shown, by id. */
  expanded = new Set<string>();

  /** null = the editor is closed; '' = creating; otherwise the policy id. */
  editingId: string | null = null;
  formName = '';
  selected = new Set<string>();

  /** The policy is edited as its document: its statements, as JSON. */
  advanced = false;
  advancedText = '';
  readonly documentHelp = 'A list of {"effect": "allow" | "deny" | "ask", "actions": [...], "scopes": {...}}. '
    + 'A deny wins, then an ask, then an allow. Ask and scopes are for agents\' actions alone, '
    + 'which are better chosen on the agent\'s page, under Access.';

  saving = false;
  busy = new Set<string>();

  query = '';
  /** The policies, ten at a time: each says what it allows, in words. */
  readonly paging = new Paging(10);
  /** Save was pressed: what the name still needs is said under it. */
  tried = false;
  /** The editor, on the dialog shell. */
  @ViewChild('editor') private editor!: TemplateRef<unknown>;
  private dialogRef: MatDialogRef<unknown> | null = null;

  constructor(
    private policyService: PolicyService,
    private agents: AgentsService,
    public auth: AuthService,
    private dialog: MatDialog,
    private confirm: ConfirmService,
  ) {
    super();
  }

  async ngOnInit(): Promise<void> {
    // The catalog rides on Auth:Me; make sure the session has been read.
    await this.auth.ensureLoaded();
    try {
      const [policies, agents] = await Promise.all([
        this.policyService.list(),
        this.agents.installed().catch(() => []),
      ]);
      this.policies = policies;
      this.catalog = PoliciesComponent.services(this.auth.catalog);
      const named: NamedAgent[] = agents.map((agent) => ({
        agent_id: agent.agent_id, name: agent.name, functions: agent.manifest.functions,
      }));
      this.words = new PolicyWords(this.auth.catalog, named);
      this.agentIds = new Set(named.map((agent) => agent.agent_id));
    } catch (failed) {
      this.fail(Refused.words(failed));
    } finally {
      this.loading = false;
    }
  }

  /** The endpoints' actions, grouped by service: the first two parts of
   *  an action (`iam:user`), each named in the API server's words. */
  static services(actions: CatalogAction[]): ActionGroup[] {
    const groups = new Map<string, ActionGroup>();
    for (const { action, words } of actions) {
      const parts = action.split(':');
      const key = parts.slice(0, 2).join(':');
      if (!groups.has(key)) groups.set(key, { key, label: serviceName(key), actions: [] });
      groups.get(key)!.actions.push({ action, name: words || parts.slice(2).join(':').replace(/_/g, ' ') });
    }
    return [...groups.values()];
  }

  private async reload(): Promise<void> {
    this.policies = await this.policyService.list();
  }

  // ── What the current person may do ──────────────────────────────────

  get canCreate(): boolean {
    return this.auth.can('iam:policy:create');
  }

  get canUpdate(): boolean {
    return this.auth.can('iam:policy:update');
  }

  get canDelete(): boolean {
    return this.auth.can('iam:policy:delete');
  }

  isBusy(policyId: string): boolean {
    return this.busy.has(policyId);
  }

  // ── Reading a policy ────────────────────────────────────────────────

  /** Each statement of a policy in words: what it does, to what, and
   *  where it is narrowed. A long list of actions is cut at a few, unless
   *  the policy is opened whole. */
  statementsOf(policy: Policy): StatementLine[] {
    const whole = this.expanded.has(policy.policy_id);
    const statements = whole ? policy.statements : policy.statements.slice(0, SHOWN_STATEMENTS);
    return statements.map((statement) => {
      const items = statement.actions.map((action) => this.words.action(action));
      return {
        effect: this.words.effect(statement),
        asks: statement.effect === 'ask',
        items: whole ? items : items.slice(0, SHOWN_ITEMS),
        scopes: this.words.scopes(statement),
      };
    });
  }

  /** How many actions are not shown: cut from the statements shown,
   *  and all of those past the first few. */
  hiddenCount(policy: Policy): number {
    if (this.expanded.has(policy.policy_id)) return 0;
    return policy.statements.reduce((sum, statement, index) => sum + (index < SHOWN_STATEMENTS
      ? Math.max(0, statement.actions.length - SHOWN_ITEMS) : statement.actions.length), 0);
  }

  toggleWhole(policy: Policy): void {
    if (!this.expanded.delete(policy.policy_id)) this.expanded.add(policy.policy_id);
  }

  /** The installed agents a policy names: who may use them is better
   *  chosen on their own page. */
  agentsNamed(policy: Policy): { agent_id: string; name: string }[] {
    return PolicyWords.agentsOf(policy.statements)
      .filter((id) => this.agentIds.has(id))
      .map((id) => ({ agent_id: id, name: this.words.agentName(id) }));
  }

  /** What the search reads of a policy: its name and its words. */
  private searchable(policy: Policy): string {
    const words = policy.statements.flatMap((statement) => [
      this.words.effect(statement), ...statement.actions.map((action) => this.words.action(action)), ...statement.actions,
    ]);
    return `${policy.name} ${words.join(' ')}`.toLowerCase();
  }

  private groupOf(action: string): ActionGroup | undefined {
    return this.catalog.find((group) => action === `${group.key}:*`
      || group.actions.some((each) => each.action === action));
  }

  /** The actions a policy selects, or null when it is more than "allow
   *  these": a deny, an ask, scopes, or a pattern no box stands for. */
  private gridSelection(statements: PolicyStatement[]): Set<string> | null {
    if (!statements.length) return null;
    const selected = new Set<string>();
    for (const statement of statements) {
      if (statement.effect !== 'allow' || statement.scopes) return null;
      for (const action of statement.actions) {
        if (action !== '*' && !this.groupOf(action)) return null;
        selected.add(action);
      }
    }
    return selected;
  }

  // ── Opening the editor ──────────────────────────────────────────────

  startCreate(): void {
    this.editingId = '';
    this.formName = '';
    this.selected = new Set<string>();
    this.advanced = false;
    this.advancedText = '';
    this.error = '';
    this.openEditor();
    this.readOpenAtStart();
  }

  startEdit(policy: Policy): void {
    this.editingId = policy.policy_id;
    this.formName = policy.name;
    this.error = '';
    this.openEditor();

    const selection = this.gridSelection(policy.statements);
    this.selected = selection ?? new Set<string>();
    this.advanced = !selection;
    this.advancedText = selection ? '' : JSON.stringify(policy.statements, null, 2);
    this.readOpenAtStart();
  }

  /** Start a new policy from an existing one, the built-in ones too. */
  duplicate(policy: Policy): void {
    this.startEdit(policy);
    this.editingId = '';
    this.formName = `${policy.name} (copy)`;
  }

  /** Write the policy as its document: for a deny, an ask or scopes. */
  writeDocument(): void {
    this.advancedText = JSON.stringify(this.selected.size ? this.gridStatements() : [], null, 2);
    this.advanced = true;
  }

  cancelEdit(): void {
    if (!this.saving) this.dialogRef?.close();
  }

  get isCreating(): boolean {
    return this.editingId === '';
  }

  get editorTitle(): string {
    return this.isCreating ? 'New policy' : `Edit ${this.formName}`;
  }

  // ── The grid ────────────────────────────────────────────────────────

  private wildcard(group: ActionGroup): string {
    return `${group.key}:*`;
  }

  isActionOn(group: ActionGroup, action: string): boolean {
    return this.selected.has('*') || this.selected.has(this.wildcard(group)) || this.selected.has(action);
  }

  isGroupOn(group: ActionGroup): boolean {
    return this.selected.has('*') || this.selected.has(this.wildcard(group))
      || group.actions.every((a) => this.selected.has(a.action));
  }

  isGroupPartial(group: ActionGroup): boolean {
    return !this.isGroupOn(group) && group.actions.some((a) => this.selected.has(a.action));
  }

  selectedCount(group: ActionGroup): number {
    return group.actions.filter((a) => this.isActionOn(group, a.action)).length;
  }

  toggleGroup(group: ActionGroup): void {
    if (this.isGroupOn(group)) {
      this.selected.delete(this.wildcard(group));
      group.actions.forEach((a) => this.selected.delete(a.action));
      // A blanket '*' has to be spread out before one group can be removed.
      if (this.selected.delete('*')) {
        this.catalog.filter((other) => other !== group).forEach((other) => this.selected.add(this.wildcard(other)));
      }
      return;
    }
    // The whole group: its wildcard, so the policy keeps up with new actions.
    group.actions.forEach((a) => this.selected.delete(a.action));
    this.selected.add(this.wildcard(group));
  }

  toggleAction(group: ActionGroup, action: string): void {
    // Turning one action off inside a wildcard means the wildcard no
    // longer holds: it is spread out into the actions, less this one.
    if (this.selected.has('*') || this.selected.has(this.wildcard(group))) {
      if (this.selected.delete('*')) {
        this.catalog.filter((other) => other !== group).forEach((other) => this.selected.add(this.wildcard(other)));
      }
      this.selected.delete(this.wildcard(group));
      group.actions.filter((a) => a.action !== action).forEach((a) => this.selected.add(a.action));
      return;
    }
    if (!this.selected.delete(action)) this.selected.add(action);
  }

  get totalSelected(): number {
    return this.catalog.reduce((sum, group) => sum + this.selectedCount(group), 0);
  }

  /** Opens the editor on the dialog shell; closing it, however it is
   *  closed, ends the edit. */
  private openEditor(): void {
    if (this.dialogRef) return;
    this.tried = false;
    this.dialogRef = this.dialog.open(this.editor, { width: '640px', maxWidth: '100vw' });
    this.dialogRef.afterClosed().subscribe(() => {
      this.dialogRef = null;
      this.editingId = null;
      this.error = '';
    });
  }

  /** The editor is open: what goes wrong is said in it, not behind it. */
  get editing(): boolean {
    return this.dialogRef !== null;
  }

  /** The policies the search leaves. */
  get shown(): Policy[] {
    const query = this.query.trim().toLowerCase();
    return this.policies.filter((policy) => !query || this.searchable(policy).includes(query));
  }

  /** The groups that open unfolded: the ones the policy already allows
   *  something of. Read once as the editor opens, so a fold does not
   *  move while its boxes are ticked. */
  openAtStart = new Set<string>();

  private readOpenAtStart(): void {
    this.openAtStart = new Set(this.catalog.filter((group) => this.selectedCount(group) > 0).map((group) => group.key));
  }

  // ── Saving ──────────────────────────────────────────────────────────

  private gridStatements(): PolicyStatement[] {
    return [{ effect: 'allow', actions: [...this.selected].sort() }];
  }

  /** The statements, from whichever editor is in use. */
  private buildStatements(): PolicyStatement[] | null {
    if (this.advanced) {
      try {
        const parsed = JSON.parse(this.advancedText);
        if (!Array.isArray(parsed) || !parsed.length) {
          this.fail('The document is a list of one or more statements.');
          return null;
        }
        return parsed as PolicyStatement[];
      } catch {
        this.fail('That is not valid JSON.');
        return null;
      }
    }
    if (!this.selected.size) {
      this.fail('Allow at least one thing.');
      return null;
    }
    return this.gridStatements();
  }

  async save(): Promise<void> {
    this.tried = true;
    this.error = '';
    const name = this.formName.trim();
    if (!name) return;

    const statements = this.buildStatements();
    if (!statements) return;

    this.saving = true;
    try {
      if (!this.isCreating && name !== this.policies.find((p) => p.policy_id === this.editingId)?.name) {
        const renamed = await this.policyService.rename(this.editingId as string, name);
        if (renamed.error) return this.fail(renamed.error);
      }
      const result = this.isCreating
        ? await this.policyService.create(name, statements)
        : await this.policyService.update(this.editingId as string, statements);
      if (result.error) return this.fail(result.error);

      await this.reload();
      this.flash(this.isCreating ? `Policy “${name}” created.` : 'Policy saved.');
      this.dialogRef?.close();
      // Their own permissions may have just changed.
      await this.auth.refresh();
    } finally {
      this.saving = false;
    }
  }

  async remove(policy: Policy): Promise<void> {
    const sure = await this.confirm.ask({
      title: `Delete the policy “${policy.name}”?`,
      body: 'It is taken from every group that gives it, and whoever relied on it loses what it allowed.',
      confirm: 'Delete',
      danger: true,
    });
    if (!sure) return;

    this.busy.add(policy.policy_id);
    try {
      const result = await this.policyService.remove(policy.policy_id);
      if (result.error) return this.fail(result.error);
      await this.reload();
      this.flash(`Policy “${policy.name}” deleted.`);
      await this.auth.refresh();
    } finally {
      this.busy.delete(policy.policy_id);
    }
  }
}
