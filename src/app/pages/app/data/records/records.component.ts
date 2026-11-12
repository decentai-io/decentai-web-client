import { Component, OnDestroy, OnInit, TemplateRef, ViewChild } from '@angular/core';
import { MatDialog, MatDialogRef } from '@angular/material/dialog';
import { ActivatedRoute, NavigationEnd, Router } from '@angular/router';
import { Subscription } from 'rxjs';
import { filter } from 'rxjs/operators';

import { fullDate, relativeDate } from 'src/app/components/ui/dates';
import { FilterGroup } from 'src/app/components/ui/filter-column.component';
import { Choice } from 'src/app/components/ui/radio-keys';
import { Sort } from 'src/app/components/ui/sort-header.component';
import { AuthService } from 'src/app/services/auth.service';
import { ConfirmService } from 'src/app/services/confirm.service';
import { ProfileService } from 'src/app/services/profile.service';
import {
  AppRecord, RecordField, RecordOf, RecordShape, RecordsService,
} from 'src/app/services/records.service';
import { RecordPage } from '../record-page';
import { recordsAsCsv, recordsAsJson } from './record-export';
import { numberLabel } from './record-values';

/** One kind an agent keeps, as the filter column shows it. */
interface KindNode {
  of: RecordOf;
  label: string;
  count: number;
}

/** One agent in the filter column, with the kinds it keeps beneath it. */
interface AgentNode {
  id: string;
  name: string;
  count: number;
  kinds: KindNode[];
}

/** A column of the table one kind is shown as. */
interface Column {
  name: string;
  label: string;
  type: RecordField['type'];
}

/** Whose records are listed. */
type Show = 'mine' | 'shared';

/** A number over the list: its icon, the number, its word, and the
 *  "whose" it narrows the list to, when it is one. */
interface Tile {
  icon: string;
  value: number;
  label: string;
  show?: Show;
}

/** The column a kind with no declared shape is shown by: its name. */
const NAME_COLUMN = '__name';

/** Newest change first: how a kind opens. */
const BY_CHANGE: Sort = { key: 'updated', direction: 'desc' };

/** A kind as the filter column's value: `agent/resource`. */
function kindKey(of: RecordOf): string {
  return `${of.agent}/${of.resource}`;
}

/**
 * Records: the data agents keep for the person. Each is of a resource
 * an agent declares, and the page shows one kind at a time: the column
 * at the list's left holds the agents, each opening to the kinds it
 * keeps, and the address names the one open
 * (/data/records/<agent>/<resource>), with the search, the sort and the
 * page in its query.
 *
 * One kind is a table: every record of a kind shares the fields its
 * agent declared, so the columns are those fields, labelled as the
 * manifest labels them, sortable, and a row opens to the whole record. A
 * kind no installed agent declares any more is listed by name. Either
 * way, nothing here is invented: the fields come from the manifest, and
 * a record written by hand follows them exactly, where the agent lets a
 * person write one at all.
 */
@Component({
  selector: 'app-records',
  standalone: false,
  templateUrl: './records.component.html',
  styleUrl: './records.component.css',
})
export class RecordsComponent extends RecordPage implements OnInit, OnDestroy {
  protected override readonly nouns: [string, string] = ['record', 'records'];

  // ── What the address says ───────────────────────────────────────────
  show: Show = 'mine';
  /** The agent whose kind is open; '' before one is. */
  activeAgent = '';
  /** The resource half of the address. */
  private kindParam = '';
  /** The record the address names, opened beside the list; '' for none. */
  openId = '';
  query = '';
  sort: Sort = BY_CHANGE;
  page = 1;

  readonly pageSize = 20;
  readonly sortChoices: Choice[] = [
    { value: 'updated', name: 'Changed' },
    { value: 'created', name: 'Created' },
    { value: 'name', name: 'Name' },
  ];

  /** The dialog a record is written in. Its first step, when more than
   *  one kind can be made, is which kind (`pickerOpen`); then the form
   *  for `formShape`. */
  @ViewChild('formDialog') private formDialog?: TemplateRef<unknown>;
  private formRef: MatDialogRef<unknown> | null = null;
  pickerOpen = false;
  formShape: RecordShape | null = null;
  editingId = '';
  formFields: Record<string, any> = {};
  /** What the person calls the record; '' for no name. */
  formName = '';
  /** Save was pressed: what is wrong is said under its field. */
  tried = false;
  /** Why the API server refused the last save. */
  formError = '';
  saving = false;

  /** Columns a kind's table shows at once; the rest are in the record. */
  private static readonly MAX_COLUMNS = 7;

  private readonly address = new Subscription();

  constructor(
    service: RecordsService,
    profiles: ProfileService,
    auth: AuthService,
    confirm: ConfirmService,
    private router: Router,
    private route: ActivatedRoute,
    private dialog?: MatDialog,
  ) {
    super('data', service, profiles, auth, confirm);
  }

  async ngOnInit(): Promise<void> {
    // The kind is a child route's (routes/app/data.routes.ts), so that
    // moving between kinds keeps this page; it is read after each
    // navigation, and the page then makes sure it names something.
    this.readKind();
    this.address.add(this.router.events
      .pipe(filter((event) => event instanceof NavigationEnd))
      .subscribe(() => {
        this.readKind();
        if (!this.loading) {
          this.settleSelection();
          this.settleOpened();
        }
      }));
    this.address.add(this.route.queryParamMap.subscribe((params) => {
      this.show = params.get('show') === 'shared' ? 'shared' : 'mine';
      this.query = params.get('q') ?? '';
      const key = params.get('sort') ?? BY_CHANGE.key;
      this.sort = { key, direction: params.get('dir') === 'asc' ? 'asc' : params.get('dir') === 'desc' ? 'desc' : this.firstDirection(key) };
      this.page = Math.max(1, Number(params.get('page')) || 1);
    }));

    await this.load();
    this.settleSelection();
    this.settleOpened();
  }

  ngOnDestroy(): void {
    this.address.unsubscribe();
    this.formRef?.close();
  }

  private readKind(): void {
    const params = this.route.snapshot.firstChild?.paramMap;
    const agent = params?.get('agent') ?? '';
    const kind = params?.get('kind') ?? '';
    this.openId = params?.get('ref') ?? '';
    if (agent === this.activeAgent && kind === this.kindParam) return;
    this.activeAgent = agent;
    this.kindParam = kind;
    this.selected.clear();
    this.share.close();
  }

  /** The kind that is open, or null before one is. */
  get activeKind(): RecordOf | null {
    return this.activeAgent && this.kindParam ? { agent: this.activeAgent, resource: this.kindParam } : null;
  }

  // ── The opened record ───────────────────────────────────────────────

  get opened(): AppRecord | null {
    return this.records.find((record) => record.record_id === this.openId) || null;
  }

  /** An id that names no record the person can see goes back to its
   *  kind, and says so. */
  private settleOpened(): void {
    if (!this.openId || this.opened) return;
    this.fail('That record is not one you can see any more.');
    this.closeView();
  }

  /** Where a record is opened: its kind's address, then its id. */
  recordLink(record: AppRecord): string[] {
    return ['/data/records', record.of?.agent ?? '', record.of?.resource ?? '', record.record_id];
  }

  /** Back to the kind's list as it was: its search, its sort, its page. */
  closeView(): void {
    if (!this.activeAgent) return;
    void this.router.navigate(['/data/records', this.activeAgent, this.kindParam], { queryParamsHandling: 'preserve' });
  }

  protected override deleted(record: AppRecord): void {
    if (record.record_id === this.openId) this.closeView();
  }

  /** Opens a kind: its address. */
  private openKind(of: RecordOf, replaceUrl = false): void {
    void this.router.navigate(['/data/records', of.agent, of.resource], {
      queryParams: { show: this.show === 'shared' ? 'shared' : null },
      replaceUrl,
    });
  }

  /** Changes the query of the address, and so what is listed. */
  private go(changes: Record<string, string | number | null>): void {
    const queryParams: Record<string, string | number | null> = {};
    for (const [key, value] of Object.entries(changes)) queryParams[key] = value || null;
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams,
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }

  protected override async reload(): Promise<void> {
    await super.reload();
    this.settleSelection();
  }

  /** Point at something that still exists.
   *
   *  The filter column is derived from the records themselves, so with
   *  no kind in the address, or after the last record of the open kind
   *  is deleted, the address names nothing that is there. The page
   *  settles itself: to the same agent's next kind, else to the first
   *  kind of the first agent; with no record at all it stays where it
   *  is and says so. A kind that holds nothing yet but that its agent
   *  lets a person write is somewhere to be: its first record is made
   *  from there. */
  private settleSelection(): void {
    const open = this.activeKind;
    if (open && (this.selectionRecords.length || this.creatable(this.shapeOf(open)))) return;
    const agents = this.agentNodes;
    const next = agents.find((node) => node.id === this.activeAgent)?.kinds[0] ?? agents[0]?.kinds[0];
    if (next && (!open || kindKey(next.of) !== kindKey(open))) this.openKind(next.of, true);
  }

  // ── Naming ──────────────────────────────────────────────────────────

  /** The name typed, where it differs from the one kept. */
  private renamed(kept = ''): { name?: string } {
    const name = this.formName.trim();
    return name !== kept ? { name } : {};
  }

  /** Its name, else the most name-like key an agent set, else its id. */
  nameOf(record: AppRecord): string {
    if (record.name) return record.name;
    const keys = record.keys ?? {};
    for (const candidate of ['title', 'name', 'label', 'subject', 'number', 'supplier']) {
      const value = keys[candidate];
      if (typeof value === 'string' && value.trim()) return value;
    }
    return record.record_id;
  }

  // ── The numbers over the list ───────────────────────────────────────

  /** How many records, whose, how many kinds, and how many agents keep them. */
  get tiles(): Tile[] {
    const kept = this.records.filter((record) => record.of);
    const mine = kept.filter((record) => this.isMine(record)).length;
    return [
      { icon: 'database', value: kept.length, label: kept.length === 1 ? 'Record' : 'Records' },
      { icon: 'user', value: mine, label: 'Yours', show: 'mine' },
      { icon: 'users', value: kept.length - mine, label: 'Shared with you', show: 'shared' },
      { icon: 'table', value: new Set(kept.map((record) => kindKey(record.of!))).size, label: 'Kinds' },
      { icon: 'bot', value: new Set(kept.map((record) => record.of!.agent)).size, label: 'Agents keeping them' },
    ];
  }

  /** A tile is known by its icon, so the row is not drawn again. */
  byIcon(_: number, tile: Tile): string {
    return tile.icon;
  }

  // ── The filter column ───────────────────────────────────────────────

  /** The records of the chosen "whose". */
  private get pool(): AppRecord[] {
    return this.records.filter((record) => record.of && this.isMine(record) === (this.show === 'mine'));
  }

  get agentNodes(): AgentNode[] {
    const byAgent = new Map<string, Map<string, KindNode>>();
    for (const record of this.pool) {
      const of = record.of!;
      const kinds = byAgent.get(of.agent) ?? new Map<string, KindNode>();
      const node = kinds.get(of.resource) ?? { of, label: this.resourceLabel(of), count: 0 };
      node.count += 1;
      kinds.set(of.resource, node);
      byAgent.set(of.agent, kinds);
    }
    return [...byAgent.entries()]
      .map(([id, kinds]) => ({
        id,
        name: this.agentName(id),
        count: [...kinds.values()].reduce((sum, kind) => sum + kind.count, 0),
        kinds: [...kinds.values()].sort((a, b) => a.label.localeCompare(b.label)),
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  get chosen(): Record<string, string> {
    const open = this.activeKind;
    return { show: this.show, kind: open ? kindKey(open) : '' };
  }

  /** Whose records, then the agents, each opening to its kinds. */
  get filters(): FilterGroup[] {
    const mine = this.records.filter((record) => this.isMine(record)).length;
    return [
      {
        key: 'show',
        required: true,
        items: [
          { value: 'mine', name: 'Mine', count: mine },
          { value: 'shared', name: 'Shared with me', count: this.records.length - mine },
        ],
      },
      {
        key: 'kind',
        label: 'Agents',
        required: true,
        items: this.agentNodes.map((agent) => ({
          value: agent.id,
          name: agent.name,
          count: agent.count,
          agent: { name: agent.name },
          children: agent.kinds.map((kind) => ({ value: kindKey(kind.of), name: kind.label, count: kind.count })),
        })),
      },
    ].filter((group) => group.items.length > 0);
  }

  /** A filter was chosen: whose records, or an agent (its first kind)
   *  or one of its kinds. */
  filter(key: string, value: string): void {
    if (key === 'show') {
      this.show = value as Show;
      const open = this.activeKind;
      const stillThere = !!open && this.agentNodes.some((agent) => agent.kinds.some((kind) => kindKey(kind.of) === kindKey(open)));
      const first = this.agentNodes[0]?.kinds[0];
      if (!stillThere && first) return this.openKind(first.of);
      return this.go({ show: value === 'shared' ? 'shared' : null, page: null });
    }
    const agent = this.agentNodes.find((node) => node.id === value);
    const [id, resource] = value.split('/');
    this.openKind(agent ? agent.kinds[0].of : { agent: id, resource });
  }

  /** The kinds a person may write: those whose agent says so. */
  get pickerShapes(): RecordShape[] {
    return this.shapes.filter((shape) => this.creatable(shape));
  }

  /** Whether the record's agent lets a person change its kind. */
  mayEdit(record: AppRecord): boolean {
    return (this.shapeOf(record.of)?.user_access ?? []).includes('update');
  }

  /** What the manifest says the open kind is, when it says. */
  get kindDescription(): string {
    return this.tableShape?.description?.trim() ?? '';
  }

  /** The open kind's label: "Note", not "note". */
  get kindLabel(): string {
    const open = this.activeKind;
    return open ? this.resourceLabel(open) : '';
  }

  // ── Filtering and sorting ───────────────────────────────────────────

  /** The open kind's records, before the search. */
  get selectionRecords(): AppRecord[] {
    const open = this.activeKind;
    return open ? this.pool.filter((record) => kindKey(record.of!) === kindKey(open)) : [];
  }

  get shown(): AppRecord[] {
    const query = this.query.trim().toLowerCase();
    const rows = this.selectionRecords.filter((record) => !query
      || [this.nameOf(record), JSON.stringify(record.keys ?? {}), JSON.stringify(record.values ?? {})]
        .join(' ').toLowerCase().includes(query));
    return rows.sort((a, b) => this.compare(a, b) * (this.sort.direction === 'desc' ? -1 : 1));
  }

  get pagedRecords(): AppRecord[] {
    const start = (this.page - 1) * this.pageSize;
    return this.shown.slice(start, start + this.pageSize);
  }

  toPage(page: number): void {
    this.go({ page: page === 1 ? null : page });
  }

  search(value: string): void {
    this.go({ q: value, page: null });
  }

  private compare(a: AppRecord, b: AppRecord): number {
    const key = this.sort.key;
    if (key === 'updated' || key === 'created') {
      const when = (record: AppRecord) => String((key === 'updated' ? record.updated_at : record.created_at) || record.created_at || '');
      return when(a).localeCompare(when(b));
    }
    if (key === 'name' || key === NAME_COLUMN) return this.nameOf(a).localeCompare(this.nameOf(b));
    const av = a.keys?.[key];
    const bv = b.keys?.[key];
    if (typeof av === 'number' && typeof bv === 'number') return av - bv;
    return String(av ?? '').localeCompare(String(bv ?? ''), undefined, { numeric: true });
  }

  /** Dates open newest first; everything else A to Z. */
  private firstDirection(key: string): Sort['direction'] {
    return key === 'updated' || key === 'created' ? 'desc' : 'asc';
  }

  /** A column heading was clicked, or the toolbar's sort chosen. */
  sortBy(sort: Sort): void {
    const first = sort.key !== this.sort.key;
    const direction = first ? this.firstDirection(sort.key) : sort.direction;
    this.go({
      sort: sort.key === BY_CHANGE.key ? null : sort.key,
      dir: direction === this.firstDirection(sort.key) ? null : direction,
      page: null,
    });
  }

  sortByChoice(key: string): void {
    this.sortBy({ key, direction: this.firstDirection(key) });
  }

  // ── The table one kind is shown as ──────────────────────────────────

  get tableShape(): RecordShape | null {
    return this.shapeOf(this.activeKind);
  }

  /** The kind's plain fields, in manifest order, the name first, objects
   *  and secrets left to the record itself. A kind with no declared
   *  shape has one column: the record's name. */
  get columns(): Column[] {
    const shape = this.tableShape;
    if (!shape?.fields) return [{ name: NAME_COLUMN, label: 'Name', type: 'string' }];
    const usable = shape.fields.filter((field) =>
      field.storage === 'keys' && field.type !== 'object' && field.type !== 'secret' && field.type !== 'form');
    const rank = (field: RecordField) => ['title', 'name', 'label', 'subject', 'number'].includes(field.name) ? 0 : 1;
    return [...usable].sort((a, b) => rank(a) - rank(b)).slice(0, RecordsComponent.MAX_COLUMNS)
      .map((field) => ({ name: field.name, label: field.label || field.name, type: field.type }));
  }

  cell(record: AppRecord, column: Column): string {
    if (column.name === NAME_COLUMN) return this.nameOf(record);
    const value = record.keys?.[column.name];
    if (value === null || value === undefined || value === '') return '';
    if (typeof value === 'boolean') return value ? 'yes' : 'no';
    if (typeof value === 'number') return numberLabel(value);
    return String(value);
  }

  /** How a cell reads: a yes or a no as a mark, a select's choice as a
   *  chip, a reference in mono, a number to the right. */
  cellKind(record: AppRecord, column: Column): string {
    if (column.name === NAME_COLUMN) return 'text';
    const value = record.keys?.[column.name];
    if (value === null || value === undefined || value === '') return 'empty';
    if (typeof value === 'boolean') return value ? 'yes' : 'no';
    if (column.type === 'select') return 'chip';
    if (column.type === 'number' || typeof value === 'number') return 'number';
    if (typeof value === 'string' && /^[0-9a-f]{32}$/.test(value)) return 'ref';
    return 'text';
  }

  /** When the record last changed. */
  private changedAt(record: AppRecord): string {
    return record.updated_at || record.created_at || '';
  }

  changed(record: AppRecord): string {
    return relativeDate(this.changedAt(record));
  }

  changedInFull(record: AppRecord): string {
    return fullDate(this.changedAt(record));
  }

  // ── Writing one by hand ─────────────────────────────────────────────

  /** Whether a person may write this kind by hand. */
  private creatable(shape: RecordShape | null): boolean {
    return !!shape && (shape.user_access ?? []).includes('create');
  }

  openPicker(): void {
    if (this.saving) return;
    // The kind on screen is the kind to make, where its agent lets a
    // person make one. Otherwise the choice is among the kinds that
    // do, which includes kinds that hold no record yet.
    const shape = this.tableShape;
    if (shape && this.creatable(shape)) return this.startCreate(shape);
    const offered = this.pickerShapes;
    if (offered.length === 1) return this.startCreate(offered[0]);
    this.pickerOpen = true;
    this.formShape = null;
    this.showDialog();
  }

  /** The kinds a record can be made of, as the first step's choices:
   *  made again only when the kinds change, so the cards are not
   *  redrawn under the pointer. */
  get kindChoices(): Choice[] {
    const offered = this.pickerShapes;
    const key = offered.map((shape) => kindKey({ agent: shape.agent, resource: shape.id })).join();
    if (key !== this.kindChoicesFor) {
      this.kindChoicesFor = key;
      this.kindChoicesMade = offered.map((shape) => ({
        value: kindKey({ agent: shape.agent, resource: shape.id }),
        name: shape.label || shape.id,
        hint: [shape.agent_name, shape.description].filter(Boolean).join(': '),
      }));
    }
    return this.kindChoicesMade;
  }
  private kindChoicesFor = '';
  private kindChoicesMade: Choice[] = [];

  chooseKind(value: string): void {
    const shape = this.pickerShapes.find((candidate) => kindKey({ agent: candidate.agent, resource: candidate.id }) === value);
    if (shape) this.startCreate(shape);
  }

  /** The fields a person writes: a secret field of a record is still the
   *  record's, but a `form` field is a chat's to ask. */
  formFieldsOf(shape: RecordShape): RecordField[] {
    return (shape.fields ?? []).filter((field) => field.type !== 'form');
  }

  startCreate(shape: RecordShape): void {
    this.pickerOpen = false;
    this.formShape = shape;
    this.editingId = '';
    this.formName = '';
    this.formFields = {};
    for (const field of this.formFieldsOf(shape)) this.formFields[field.name] = '';
    this.showDialog();
  }

  startEdit(record: AppRecord): void {
    const shape = this.shapeOf(record.of);
    if (!shape) return;
    this.pickerOpen = false;
    this.formShape = shape;
    this.editingId = record.record_id;
    this.formName = record.name || '';
    this.formFields = {};
    for (const field of this.formFieldsOf(shape)) {
      const stored = field.storage === 'keys' ? record.keys?.[field.name] : record.values?.[field.name];
      this.formFields[field.name] = field.type === 'object' ? JSON.stringify(stored ?? {}, null, 2) : stored ?? '';
    }
    this.showDialog();
  }

  /** Opens the dialog for the step the state says, once. */
  private showDialog(): void {
    this.tried = false;
    this.formError = '';
    if (this.formRef || !this.dialog || !this.formDialog) return;
    this.formRef = this.dialog.open(this.formDialog, { width: '560px', maxWidth: '100vw' });
    this.formRef.afterClosed().subscribe(() => {
      this.formRef = null;
      this.pickerOpen = false;
      this.formShape = null;
      this.editingId = '';
    });
  }

  cancelForm(): void {
    if (this.saving) return;
    this.pickerOpen = false;
    this.formShape = null;
    this.editingId = '';
    this.formRef?.close();
  }

  /** A select field's choices, made once for each field. */
  optionsOf(field: RecordField): Choice[] {
    let choices = this.choicesByField.get(field);
    if (!choices) {
      choices = (field.options || []).map((option) => ({ value: option, name: option }));
      this.choicesByField.set(field, choices);
    }
    return choices;
  }
  private choicesByField = new WeakMap<RecordField, Choice[]>();

  /** Text that is written at length: what an agent keeps as content
   *  rather than as something to find the record by. */
  isLong(field: RecordField): boolean {
    return field.type === 'string' && field.storage !== 'keys';
  }

  private get editedRecord(): AppRecord | undefined {
    return this.editingId ? this.records.find((record) => record.record_id === this.editingId) : undefined;
  }

  /** What a field of the form would send: its value, nothing (`omit`),
   *  or why it cannot be sent as it stands. */
  private read(field: RecordField): { value?: any; omit?: true; problem?: string } {
    const raw = this.formFields[field.name];
    const label = field.label || field.name;
    if (raw === '' || raw === null || raw === undefined) {
      if (field.required) return { problem: `Enter ${label}.` };
      // On an edit a blank box over a stored value is a deliberate
      // clearing, and an edit is merged over what is stored: leaving
      // the field out would keep the old value. Text can be emptied;
      // the other types have no empty value in the agent's shape.
      const stored = this.editedRecord;
      const had = (field.storage === 'keys' ? stored?.keys : stored?.values)?.[field.name];
      if (!stored || had === undefined || had === null || had === '') return { omit: true };
      if (field.type !== 'string' && field.type !== 'secret') {
        return { problem: `${label} cannot be emptied once it has a value.` };
      }
      return { value: '' };
    }
    if (field.type === 'number') {
      const parsed = Number(raw);
      return Number.isNaN(parsed) ? { problem: `${label} is a number, like 12 or 3.5.` } : { value: parsed };
    }
    if (field.type === 'object') {
      try {
        return { value: JSON.parse(String(raw)) };
      } catch (error) {
        return { problem: `Not valid JSON: ${(error as Error).message}` };
      }
    }
    return { value: raw };
  }

  /** What is wrong with a field as it stands; '' when nothing is. */
  problemOf(field: RecordField): string {
    return this.read(field).problem || '';
  }

  async saveForm(): Promise<void> {
    const shape = this.formShape;
    if (!shape || this.saving) return;
    this.tried = true;
    this.formError = '';

    const editing = !!this.editingId;
    const fields: Record<string, any> = {};
    for (const field of this.formFieldsOf(shape)) {
      const read = this.read(field);
      // Said under the field it belongs to; nothing is sent.
      if (read.problem) return;
      if (!read.omit) fields[field.name] = read.value;
    }

    const of = { agent: shape.agent, resource: shape.id };
    this.saving = true;
    if (this.formRef) this.formRef.disableClose = true;
    try {
      const result = editing
        ? await this.service.update('data', this.editingId, { fields, ...this.renamed(this.editedRecord?.name) })
        : await this.service.create('data', of, fields, this.formName.trim());
      if (result.error) {
        this.formError = result.error;
        return;
      }
      this.saving = false;
      this.cancelForm();
      await this.reload();
      // A first record of a kind that held none: show it.
      const open = this.activeKind;
      if (!editing && (!open || kindKey(of) !== kindKey(open))) this.openKind(of);
      this.flash(editing ? 'Record updated.' : 'Record created.');
    } finally {
      this.saving = false;
      if (this.formRef) this.formRef.disableClose = false;
    }
  }

  // ── Export ──────────────────────────────────────────────────────────

  /** The records listed (every page of them, as filtered and sorted),
   *  saved as a file made here: the data is already on the page. */
  export(format: 'csv' | 'json'): void {
    const text = format === 'csv' ? recordsAsCsv(this.shown, this.tableShape) : recordsAsJson(this.shown, this.tableShape);
    const link = document.createElement('a');
    link.href = URL.createObjectURL(new Blob([text], {
      type: format === 'csv' ? 'text/csv;charset=utf-8' : 'application/json',
    }));
    const kind = this.kindLabel.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    link.download = `${kind || 'records'}-${new Date().toISOString().slice(0, 10)}.${format}`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  }

  /** Whether the row's menu would hold anything. */
  hasActions(record: AppRecord): boolean {
    return this.isMine(record)
      && (this.can('update') || this.can('transfer') || this.can('delete'));
  }
}
