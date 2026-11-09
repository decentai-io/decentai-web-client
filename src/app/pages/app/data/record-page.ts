import { AuthService } from 'src/app/services/auth.service';
import { ConfirmService } from 'src/app/services/confirm.service';
import { Peer, ProfileService } from 'src/app/services/profile.service';
import { Failure, Refused } from 'src/app/services/request.service';
import {
  AppRecord, RecordKind, RecordOf, RecordShape, RecordsService,
} from 'src/app/services/records.service';
import { DataPageBase } from '../data-page-base';
import { ShareEditor, SharingChip } from '../share-editor';

/** The actions of each kind, as the catalog names them. */
const ACTIONS: Record<RecordKind, string> = {
  secret: 'secrets:secret', data: 'data:record', file: 'files:file',
};

/** An agent's id said as a name, for an agent no shape names any more:
 *  "google_drive" is "Google drive". */
export function agentLabel(id: string): string {
  const words = String(id || '').replace(/_/g, ' ').trim();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : '';
}

/**
 * What the Secrets, Records and Files pages share: one kind of record,
 * listed with those handed to the person, and the same things done to
 * any of them. Each record may be shared, given to more agents, handed
 * to another member (who accepts it before it is theirs) and deleted;
 * only its maker does any of that.
 *
 * The resources of the kind that the person's agents declare (`shapes`)
 * name the agents and the kinds, say what may be made by hand, and are
 * what a record may be given to.
 */
export abstract class RecordPage extends DataPageBase {
  loading = true;
  records: AppRecord[] = [];
  /** Handed to the person by another member, waiting for an answer. */
  handed: AppRecord[] = [];
  shapes: RecordShape[] = [];

  /** The record an action is on its way for. */
  busyRef = '';

  /** Who can see a record, chosen in its dialog. */
  readonly share = new ShareEditor(() => this.myUserId);
  shareProblem = '';

  /** The record being handed over, and its hand-over on its way. */
  transferTarget: AppRecord | null = null;
  transferring = false;

  /** The record whose agents are being chosen. */
  agentsTarget: AppRecord | null = null;
  agentsSaving = false;
  agentsProblem = '';

  /** Records ticked to go together, by id. */
  selected = new Set<string>();
  bulkBusy = false;

  /** What one and several of the kind are called. */
  protected abstract readonly nouns: [one: string, many: string];

  constructor(
    readonly kind: RecordKind,
    protected service: RecordsService,
    protected profiles: ProfileService,
    public auth: AuthService,
    protected confirm: ConfirmService,
  ) {
    super();
  }

  /** What a record is called on this page. */
  abstract nameOf(record: AppRecord): string;

  /** The records the page shows, as filtered and searched. */
  abstract get shown(): AppRecord[];

  // ── Reading ─────────────────────────────────────────────────────────

  /** The list, the shapes and whom the person may share with. */
  protected async load(): Promise<void> {
    const [, shapes, peers] = await Promise.all([
      this.reload().catch((failed) => this.fail(Refused.words(failed))),
      this.service.shapes(this.kind).catch(() => []),
      this.profiles.peers().catch(() => null),
    ]);
    this.shapes = shapes;
    if (peers) this.share.peers = peers;
    this.loading = false;
  }

  protected async reload(): Promise<void> {
    const found = await this.service.list(this.kind);
    this.records = found.records;
    this.handed = found.handed;
    // A tick on a record that is no longer there means nothing.
    this.selected = new Set([...this.selected].filter((id) => this.records.some((record) => record.record_id === id)));
  }

  // ── Access ──────────────────────────────────────────────────────────

  /** Whether the person may take an action on this kind: `update`,
   *  `transfer`, `delete`… */
  can(action: string): boolean {
    return this.auth.can(`${ACTIONS[this.kind]}:${action}`);
  }

  get myUserId(): string {
    return this.auth.user?.user_id ?? '';
  }

  /** Only a record's maker changes it. */
  isMine(record: AppRecord): boolean {
    return record.created_by === this.myUserId;
  }

  // ── Naming ──────────────────────────────────────────────────────────

  shapeOf(of: RecordOf | null): RecordShape | null {
    return of ? this.shapes.find((shape) => shape.agent === of.agent && shape.id === of.resource) ?? null : null;
  }

  agentName(agentId: string): string {
    return this.shapes.find((shape) => shape.agent === agentId)?.agent_name || agentLabel(agentId);
  }

  /** A resource as the manifest labels it: "Sign-ins", not "logins". */
  resourceLabel(of: RecordOf): string {
    return this.shapeOf(of)?.label || of.resource;
  }

  /** The agents a record serves, by name, the one it was made for first. */
  servedBy(record: AppRecord): string[] {
    return [...new Set(record.agents.map((entry) => this.agentName(entry.agent)))];
  }

  sharing(record: AppRecord): SharingChip {
    return this.share.chip(record.owner, record.created_by);
  }

  /** Whose it is, by name, for a record that is somebody else's. */
  madeBy(record: AppRecord): string {
    return this.isMine(record) ? '' : this.share.personName(record.created_by) || 'a colleague';
  }

  /** A record of the person's on its way to another, who has not yet
   *  accepted it: to whom. */
  handingTo(record: AppRecord): string {
    return record.handing ? this.share.personName(record.handing.to) || 'a colleague' : '';
  }

  /** A record handed to the person, in words. */
  readonly handedSay = (record: AppRecord): string =>
    `${this.share.personName(record.handing?.by ?? '') || 'A colleague'} handed you the ${this.nouns[0]} “${this.nameOf(record)}”.`;

  // ── What is handed to the person ────────────────────────────────────

  /** Accept, and it is theirs; decline, and it stays its maker's. */
  async accept(record: AppRecord, yes: boolean): Promise<void> {
    await this.act(record, () => this.service.accept(this.kind, record.record_id, yes),
      yes ? `It is yours now.` : 'Declined.');
  }

  /** Whether the person is handing it on, and may take it back. */
  handingOn(record: AppRecord): boolean {
    return record.handing?.by === this.myUserId;
  }

  /** Take back a hand-over not yet accepted. */
  async withdraw(record: AppRecord): Promise<void> {
    await this.act(record, () => this.service.withdraw(this.kind, record.record_id),
      `No longer handed to ${this.handingTo(record)}.`);
  }

  // ── Sharing ─────────────────────────────────────────────────────────

  openShare(record: AppRecord): void {
    this.shareProblem = '';
    this.share.open(record.record_id, record.owner);
  }

  async saveShare(): Promise<void> {
    this.share.saving = true;
    this.shareProblem = '';
    try {
      const result = await this.service.update(this.kind, this.share.ref, { owner: this.share.owner() });
      if (result.error) {
        this.shareProblem = result.error;
        return;
      }
      this.share.close();
      await this.reload();
      this.flash('Sharing updated.');
    } finally {
      this.share.saving = false;
    }
  }

  // ── The agents a record serves ──────────────────────────────────────

  openAgents(record: AppRecord): void {
    this.agentsProblem = '';
    this.agentsTarget = record;
  }

  closeAgents(): void {
    if (!this.agentsSaving) this.agentsTarget = null;
  }

  /** The API server checks each agent added: the kinds match, and the
   *  record has every field its resource requires. A refusal says why,
   *  in the dialog. */
  async saveAgents(agents: RecordOf[]): Promise<void> {
    const record = this.agentsTarget;
    if (!record) return;
    this.agentsSaving = true;
    this.agentsProblem = '';
    try {
      const result = await this.service.update(this.kind, record.record_id, { agents });
      if (result.error) {
        this.agentsProblem = result.error;
        return;
      }
      this.agentsTarget = null;
      await this.reload();
      this.flash('Its agents are updated.');
    } finally {
      this.agentsSaving = false;
    }
  }

  // ── Handing over ────────────────────────────────────────────────────

  requestTransfer(record: AppRecord): void {
    this.transferTarget = record;
    this.error = '';
  }

  closeTransfer(): void {
    if (!this.transferring) this.transferTarget = null;
  }

  async transfer(person: Peer): Promise<void> {
    const record = this.transferTarget;
    if (!record) return;
    this.transferring = true;
    try {
      const result = await this.service.transfer(this.kind, record.record_id, person.user_id);
      // Closed either way: a refusal is said on the page, where it can
      // be read, not under the dialog.
      this.transferTarget = null;
      if (result.error) return this.fail(result.error);
      await this.reload();
      this.flash(`Handed to ${person.name || person.email}. It is theirs once they accept it.`);
    } finally {
      this.transferring = false;
    }
  }

  // ── Choosing several at once ────────────────────────────────────────

  deletable(record: AppRecord): boolean {
    return this.can('delete') && this.isMine(record);
  }

  isSelected(record: AppRecord): boolean {
    return this.selected.has(record.record_id);
  }

  toggleSelected(record: AppRecord): void {
    if (!this.selected.delete(record.record_id)) this.selected.add(record.record_id);
  }

  /** "All" means all of what the filters and the search show: never
   *  records the person cannot see from here. */
  get selectableShown(): AppRecord[] {
    return this.shown.filter((record) => this.deletable(record));
  }

  get allShownSelected(): boolean {
    const shown = this.selectableShown;
    return shown.length > 0 && shown.every((record) => this.isSelected(record));
  }

  selectAllShown(): void {
    for (const record of this.selectableShown) this.selected.add(record.record_id);
  }

  clearSelection(): void {
    this.selected.clear();
  }

  // ── Deleting ────────────────────────────────────────────────────────

  get deleteBusy(): boolean {
    return !!this.busyRef || this.bulkBusy;
  }

  deleteOne(record: AppRecord): Promise<void> {
    return this.delete([record]);
  }

  deleteSelected(): Promise<void> {
    return this.delete(this.records.filter((record) => this.isSelected(record)));
  }

  /** What deleting loses beyond the record, said in the question. */
  protected deleteNote(going: AppRecord[]): string {
    return going.some((record) => record.agents.length)
      ? ` The agents that use ${going.length === 1 ? 'it' : 'them'} can no longer.` : '';
  }

  /** Called once a record is gone, for a page that has it open. */
  protected deleted(record: AppRecord): void {}

  /** One record or many, the same way: asked first, then each through
   *  the door that checks who may delete what. One that is refused does
   *  not stop the rest, and stays ticked so it is clear what did not go. */
  private async delete(going: AppRecord[]): Promise<void> {
    if (!going.length) return;
    const [one, many] = this.nouns;
    const names = going.map((record) => this.nameOf(record));
    const listed = names.length <= 3 ? names.join(', ') : `${names.slice(0, 3).join(', ')} and ${names.length - 3} more`;
    const sure = await this.confirm.ask({
      title: going.length === 1 ? `Delete this ${one}?` : `Delete ${going.length} ${many}?`,
      body: `${listed}. Deleted ${many} cannot be recovered.${this.deleteNote(going)}`,
      confirm: going.length === 1 ? `Delete ${one}` : `Delete ${going.length} ${many}`,
      danger: true,
    });
    if (!sure) return;

    const refused: string[] = [];
    let gone = 0;
    this.bulkBusy = true;
    try {
      for (const record of going) {
        this.busyRef = record.record_id;
        const result = await this.service.remove(this.kind, record.record_id);
        if (result.error) {
          refused.push(this.nameOf(record));
          continue;
        }
        gone += 1;
        this.selected.delete(record.record_id);
        this.deleted(record);
      }
    } finally {
      this.busyRef = '';
      this.bulkBusy = false;
    }
    await this.reload().catch(() => undefined);
    if (refused.length) return this.fail(`Deleted ${gone}. Still here: ${refused.join(', ')}.`);
    this.flash(gone === 1 ? `${one.charAt(0).toUpperCase()}${one.slice(1)} deleted.` : `${gone} ${many} deleted.`);
  }

  // ── Doing one thing to one record ───────────────────────────────────

  /** One call for one record: the record is busy meanwhile, a refusal is
   *  said on the page, and the list is read again after. */
  protected async act(record: AppRecord, call: () => Promise<Failure>, notice: string): Promise<boolean> {
    this.busyRef = record.record_id;
    try {
      const result = await call();
      if (result.error) {
        this.fail(result.error);
        return false;
      }
      await this.reload();
      this.flash(notice);
      return true;
    } finally {
      this.busyRef = '';
    }
  }
}
