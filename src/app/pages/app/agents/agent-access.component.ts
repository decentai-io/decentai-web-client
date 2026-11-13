import { Component, EventEmitter, Input, OnChanges, Output, SimpleChanges } from '@angular/core';

import { Choice } from 'src/app/components/ui/radio-keys';
import {
  AccessFunction, AccessGroup, AccessPolicy, AccessRow, AgentsService,
} from 'src/app/services/agents.service';
import { AuthService } from 'src/app/services/auth.service';
import {
  ACCESS_EFFECTS, AccessDraft, EFFECT_WORDS, draftOf, draftProblem, membersWords, newDraft, rowOf, scopesOf,
} from './agent-access';
import { LevelGroup, byLevel, levelLabel } from './agent-shared';

type Reach = 'all' | 'some';

/** Whether a level's functions are chosen for a row: every one, some, none. */
export type LevelState = 'all' | 'some' | 'none';

/**
 * An installed agent's Access tab: which of the organization's groups
 * may use it, and how, as one table. A row per group: its effect (allow,
 * ask first, don't allow), every function or a chosen few, and, for an
 * agent that declares authorization scopes, the values those functions
 * are narrowed to. A row opens under itself to choose its functions, by
 * level, and its scope values. The rows are kept with the agent, so they
 * go when it is uninstalled, and saving sends them whole, from the bar
 * that comes up once something changed.
 *
 * Only whoever may install agents reads them: for anyone else the API
 * server refuses, and the tab says who chooses, and what scopes the
 * agent declares, instead.
 */
@Component({
  selector: 'app-agent-access',
  standalone: false,
  templateUrl: './agent-access.component.html',
  styleUrls: ['./agent-shared.css', './agent-access.component.css'],
})
export class AgentAccessComponent implements OnChanges {
  @Input({ required: true }) agentId!: string;
  @Input() agentName = '';
  /** The scopes the manifest declares: what the tab says when the rows
   *  can't be read. */
  @Input() declaredScopes: { name: string; description: string }[] = [];

  @Output() flashed = new EventEmitter<string>();
  /** The rows as saved, with the groups and functions they name: for a
   *  summary elsewhere on the page. */
  @Output() saved = new EventEmitter<{ access: AccessRow[]; groups: AccessGroup[]; functions: AccessFunction[] }>();

  state: 'loading' | 'ready' | 'refused' | 'failed' = 'loading';
  loadProblem = '';

  groups: AccessGroup[] = [];
  functions: AccessFunction[] = [];
  /** The functions by level: how a row's are chosen. */
  levels: LevelGroup<AccessFunction>[] = [];
  scopes: { name: string; description: string }[] = [];
  policies: AccessPolicy[] = [];

  rows: AccessDraft[] = [];
  /** The rows opened to their functions and scopes, by key. */
  open = new Set<number>();
  /** The rows as last read or saved, to tell a change. */
  private kept = '[]';
  saving = false;
  /** Why the last save was refused, or what stops it. */
  problem = '';

  readonly effects = ACCESS_EFFECTS;
  readonly effectWords = EFFECT_WORDS;
  readonly reach: Choice<Reach>[] = [
    { value: 'all', name: 'All functions' },
    { value: 'some', name: 'Some functions' },
  ];
  readonly levelLabel = levelLabel;

  constructor(private agents: AgentsService, private auth: AuthService) {}

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['agentId']) void this.read();
  }

  async read(): Promise<void> {
    this.state = 'loading';
    this.problem = '';
    const answer = await this.agents.access(this.agentId);
    if (answer.error) {
      this.state = answer.code === 'refused' ? 'refused' : 'failed';
      this.loadProblem = answer.error;
      return;
    }
    this.groups = answer.groups ?? [];
    this.functions = answer.functions ?? [];
    this.levels = byLevel(this.functions);
    this.scopes = answer.scopes ?? [];
    this.policies = answer.policies ?? [];
    this.rows = (answer.access ?? []).map(draftOf);
    this.open.clear();
    this.kept = this.written();
    this.state = 'ready';
  }

  // ── Reading the rows ────────────────────────────────────────────────

  groupOf(row: AccessDraft): AccessGroup | undefined {
    return this.groups.find((group) => group.group_id === row.group_id);
  }

  groupName(row: AccessDraft): string {
    return this.groupOf(row)?.name || 'A group no longer there';
  }

  members(row: AccessDraft): string {
    return membersWords(this.groupOf(row));
  }

  /** The scopes the row's functions are narrowed by. */
  scopesOf(row: AccessDraft): { name: string; description: string }[] {
    return scopesOf(row, this.functions, this.scopes);
  }

  /** Which functions, in a few words: "All functions", "3 of 8". */
  reachWords(row: AccessDraft): string {
    if (row.every) return 'All functions';
    const known = this.functions.filter((fn) => row.chosen.includes(fn.id)).length;
    return `${known} of ${this.functions.length}`;
  }

  /** Its scope values, in a few words: "notebook: work, home", or that
   *  any value goes. '' where no scope narrows its functions. */
  scopeWords(row: AccessDraft): string {
    const scopes = this.scopesOf(row);
    if (!scopes.length) return '';
    const narrowed = scopes
      .map((scope) => ({ name: scope.name, values: (row.scopes[scope.name] || []).filter((value) => value.trim()) }))
      .filter((scope) => scope.values.length);
    if (!narrowed.length) return 'Any value';
    return narrowed.map((scope) => `${scope.name}: ${scope.values.join(', ')}`).join(' · ');
  }

  /** The groups that have no row yet: what Add offers. */
  get addable(): Choice[] {
    const used = new Set(this.rows.map((row) => row.group_id));
    return this.groups
      .filter((group) => !used.has(group.group_id))
      .map((group) => ({ value: group.group_id, name: group.name, hint: membersWords(group) }));
  }

  /** May the person open Policies, where the policies naming it are changed. */
  get canReadPolicies(): boolean {
    return this.auth.can('iam:policy:list');
  }

  byKey(_: number, row: AccessDraft): number {
    return row.key;
  }

  // ── Opening a row ───────────────────────────────────────────────────

  isOpen(row: AccessDraft): boolean {
    return this.open.has(row.key);
  }

  toggleOpen(row: AccessDraft): void {
    if (!this.open.delete(row.key)) this.open.add(row.key);
  }

  // ── Changing them ───────────────────────────────────────────────────

  add(groupId: string): void {
    if (!groupId) return;
    const row = newDraft(groupId);
    this.rows = [...this.rows, row];
    this.problem = '';
  }

  remove(row: AccessDraft): void {
    this.rows = this.rows.filter((other) => other !== row);
    this.open.delete(row.key);
    this.problem = '';
  }

  setReach(row: AccessDraft, reach: Reach): void {
    row.every = reach === 'all';
    this.problem = '';
  }

  isChosen(row: AccessDraft, fn: AccessFunction): boolean {
    return row.chosen.includes(fn.id);
  }

  toggle(row: AccessDraft, fn: AccessFunction): void {
    row.chosen = row.chosen.includes(fn.id) ? row.chosen.filter((id) => id !== fn.id) : [...row.chosen, fn.id];
    this.problem = '';
  }

  /** How much of a level the row has chosen. */
  levelState(row: AccessDraft, level: LevelGroup<AccessFunction>): LevelState {
    const chosen = level.items.filter((fn) => row.chosen.includes(fn.id)).length;
    return chosen === level.items.length ? 'all' : chosen ? 'some' : 'none';
  }

  /** A level's box: every function of it chosen, or, where they all
   *  are, none of them. */
  toggleLevel(row: AccessDraft, level: LevelGroup<AccessFunction>): void {
    const ids = level.items.map((fn) => fn.id);
    row.chosen = this.levelState(row, level) === 'all'
      ? row.chosen.filter((id) => !ids.includes(id))
      : [...row.chosen, ...ids.filter((id) => !row.chosen.includes(id))];
    this.problem = '';
  }

  setScope(row: AccessDraft, scope: string, values: string[]): void {
    row.scopes = { ...row.scopes, [scope]: values };
  }

  /** The rows as the server would keep them, as text to compare. */
  private written(): string {
    return JSON.stringify(this.rows.map((row) => rowOf(row, this.functions, this.scopes)));
  }

  get changed(): boolean {
    return this.state === 'ready' && this.written() !== this.kept;
  }

  discard(): void {
    this.rows = (JSON.parse(this.kept) as ReturnType<typeof rowOf>[]).map(draftOf);
    this.open.clear();
    this.problem = '';
  }

  async save(): Promise<void> {
    if (this.saving || !this.changed) return;
    this.problem = draftProblem(this.rows, this.groups);
    if (this.problem) {
      // The row it is about is opened, where it is put right.
      const empty = this.rows.find((row) => !row.every && !row.chosen.length);
      if (empty) this.open.add(empty.key);
      return;
    }
    this.saving = true;
    try {
      const rows = this.rows.map((row) => rowOf(row, this.functions, this.scopes));
      const result = await this.agents.setAccess(this.agentId, rows);
      if (result.error) {
        this.problem = result.error;
        return;
      }
      const access = result.access ?? rows;
      this.rows = access.map(draftOf);
      this.open.clear();
      this.kept = this.written();
      this.saved.emit({ access, groups: this.groups, functions: this.functions });
      this.flashed.emit(`Saved who may use ${this.agentName || 'it'}.`);
    } finally {
      this.saving = false;
    }
  }
}
