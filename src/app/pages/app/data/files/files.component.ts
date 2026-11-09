import { Component, OnDestroy, OnInit } from '@angular/core';
import { ActivatedRoute, NavigationEnd, Router } from '@angular/router';
import { Subscription } from 'rxjs';

import { fullDate, relativeDate } from 'src/app/components/ui/dates';
import { extensionOf, FILE_GROUPS, fileKindOf, sizeLabel } from 'src/app/components/ui/file-types';
import { FilterGroup, FilterItem } from 'src/app/components/ui/filter-column.component';
import { Choice } from 'src/app/components/ui/radio-keys';
import { Sort } from 'src/app/components/ui/sort-header.component';
import { AuthService } from 'src/app/services/auth.service';
import { ConfirmService } from 'src/app/services/confirm.service';
import { FilesService } from 'src/app/services/files.service';
import { ProfileService } from 'src/app/services/profile.service';
import { AppRecord, RecordsService } from 'src/app/services/records.service';
import { RecordPage } from '../record-page';

/** Whose files are listed. */
type Show = 'all' | 'mine' | 'shared';

/** One file on its way in, as a row above the list. */
interface Upload {
  file: File;
  /** How much has been sent, from 0 to 1. */
  sent: number;
  state: 'waiting' | 'uploading' | 'done' | 'failed';
  /** Why it failed. */
  problem: string;
  cancel?: () => void;
}

/** How long a finished upload's row stays before it leaves. */
const DONE_FOR_MS = 2500;

/** Where the person's own files are counted in the column: uploaded,
 *  attached to a chat, or made by an agent in one. */
const OWN = 'own';

/** The sorts the address can name, each a column and a direction. The
 *  toolbar offers the first four; a column's heading reaches them all. */
const SORTS: Record<string, Sort> = {
  newest: { key: 'changed', direction: 'desc' },
  oldest: { key: 'changed', direction: 'asc' },
  name: { key: 'name', direction: 'asc' },
  size: { key: 'size', direction: 'desc' },
  'name-desc': { key: 'name', direction: 'desc' },
  'size-asc': { key: 'size', direction: 'asc' },
};

/** The address's name for a sort. */
function nameOfSort(sort: Sort): string {
  return Object.keys(SORTS).find((name) =>
    SORTS[name].key === sort.key && SORTS[name].direction === sort.direction) ?? 'newest';
}

/**
 * Files: every file the person may see. A file is the person's own (one
 * they uploaded, attached to a chat, or an agent returned) or of a file
 * resource an agent declares. Read, download, rename, share, give to
 * agents, hand over and delete.
 *
 * One list. The column at its left narrows it: whose files, whose they
 * are for (the person's own, or an agent's), and what type they are.
 * What is chosen there, the search, the sort and the page are in the
 * address, so a view of the list can be linked to and returned to.
 *
 * A file's name opens it at /data/files/<id>: shown beside the list on
 * a wide screen, in its place on a narrow one.
 */
@Component({
  selector: 'app-files',
  standalone: false,
  templateUrl: './files.component.html',
  styleUrl: './files.component.css',
})
export class FilesComponent extends RecordPage implements OnInit, OnDestroy {
  protected override readonly nouns: [string, string] = ['file', 'files'];

  // ── What the address says ───────────────────────────────────────────
  show: Show = 'all';
  /** '', 'own', or an agent's id. */
  source = '';
  /** '' or one of FILE_GROUPS. */
  type = '';
  query = '';
  sort: Sort = SORTS['newest'];
  page = 1;

  /** The file the address names, opened beside the list; '' for none. */
  openId = '';

  readonly pageSize = 20;
  readonly sortChoices: Choice[] = [
    { value: 'newest', name: 'Newest' },
    { value: 'oldest', name: 'Oldest' },
    { value: 'name', name: 'Name' },
    { value: 'size', name: 'Size' },
  ];

  /** The largest file `/upload` takes, in MB. */
  readonly uploadLimitMb = FilesService.MAX_UPLOAD_MB;
  /** The files on their way in, oldest first: sent one at a time. */
  uploads: Upload[] = [];
  /** Files are being dragged over the list. */
  dropping = false;

  /** A file's new name: the answer to the last try, said under the box. */
  renaming = false;
  renameProblem = '';

  private address?: Subscription;

  constructor(
    service: RecordsService,
    profiles: ProfileService,
    auth: AuthService,
    confirm: ConfirmService,
    private files: FilesService,
    private router: Router,
    private route: ActivatedRoute,
  ) {
    super('file', service, profiles, auth, confirm);
  }

  async ngOnInit(): Promise<void> {
    this.address = this.route.queryParamMap.subscribe((params) => {
      const show = params.get('show');
      this.show = show === 'mine' || show === 'shared' ? show : 'all';
      this.source = params.get('source') ?? '';
      this.type = params.get('type') ?? '';
      this.query = params.get('q') ?? '';
      this.sort = SORTS[params.get('sort') ?? ''] ?? SORTS['newest'];
      this.page = Math.max(1, Number(params.get('page')) || 1);
    });
    this.address.add(this.router.events.subscribe((event) => {
      if (event instanceof NavigationEnd) this.readOpened();
    }));
    await this.load();
    this.readOpened();
  }

  ngOnDestroy(): void {
    this.address?.unsubscribe();
  }

  // ── The opened file ─────────────────────────────────────────────────

  /** Opens what the address names. An id that names nothing the person
   *  can see, once the list is read, goes back to the list and says so. */
  private readOpened(): void {
    this.openId = this.route.snapshot.firstChild?.paramMap.get('ref') || '';
    if (this.openId && !this.loading && !this.opened) {
      this.fail('That file is not one you can see any more.');
      this.closeOpened();
    }
  }

  get opened(): AppRecord | null {
    return this.records.find((file) => file.record_id === this.openId) || null;
  }

  /** Back to the list as it was: its filters, its sort, its page. */
  closeOpened(): void {
    void this.router.navigate(['/data/files'], { queryParamsHandling: 'preserve' });
  }

  /** Changes what the address says, and so what is listed. A value of
   *  '' (or the default) leaves the address without it. The opened
   *  file, when there is one, stays open. */
  private go(changes: Record<string, string | number | null>): void {
    const queryParams: Record<string, string | number | null> = {};
    for (const [key, value] of Object.entries(changes)) queryParams[key] = value || null;
    void this.router.navigate([], {
      relativeTo: this.route.firstChild ?? this.route,
      queryParams,
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }

  // ── Access ──────────────────────────────────────────────────────────

  get canDownload(): boolean {
    return this.auth.can('files:file:download');
  }

  get canUpload(): boolean {
    return this.auth.can('files:file:upload');
  }

  /** "Use in a chat" opens a new chat with the file staged. */
  get canChat(): boolean {
    return this.auth.can('ai:chat:create');
  }

  // ── Whose it is for ─────────────────────────────────────────────────

  /** 'own', or the agent whose resource it is of. */
  sourceOf(file: AppRecord): string {
    return file.of?.agent || OWN;
  }

  /** Whose it is for: the agent and the resource, or the person's own. */
  sourceLabel(file: AppRecord): string {
    return file.of ? `${this.agentName(file.of.agent)} · ${this.resourceLabel(file.of)}` : 'Your own';
  }

  // ── The filters ─────────────────────────────────────────────────────

  /** The files of the chosen "whose": what the sources and the types
   *  are counted in. */
  private get pool(): AppRecord[] {
    if (this.show === 'mine') return this.records.filter((file) => this.isMine(file));
    if (this.show === 'shared') return this.records.filter((file) => !this.isMine(file));
    return this.records;
  }

  private typeOf(file: AppRecord): string {
    const kind = fileKindOf(this.nameOf(file), file.file?.type);
    return FILE_GROUPS.find((group) => group.kinds.includes(kind))!.value;
  }

  get chosen(): Record<string, string> {
    return { show: this.show, source: this.source, type: this.type };
  }

  /** The column at the list's left: whose, then the sources and the
   *  types that hold something, each with its count. */
  get filters(): FilterGroup[] {
    const mine = this.records.filter((file) => this.isMine(file)).length;
    const pool = this.pool;

    const sources = new Map<string, FilterItem>();
    for (const file of pool) {
      const id = this.sourceOf(file);
      const name = id === OWN ? 'Your own' : this.agentName(id);
      const item = sources.get(id) ?? (id === OWN ? { value: id, name, icon: 'upload' } : { value: id, name, agent: { name } });
      item.count = (item.count ?? 0) + 1;
      sources.set(id, item);
    }

    return [
      {
        key: 'show',
        required: true,
        items: [
          { value: 'all', name: 'All', count: this.records.length },
          { value: 'mine', name: 'Mine', count: mine },
          { value: 'shared', name: 'Shared with me', count: this.records.length - mine },
        ],
      },
      {
        key: 'source',
        label: 'Sources',
        // The person's own first, then the agents by name.
        items: [...sources.values()].sort((a, b) =>
          Number(b.value === OWN) - Number(a.value === OWN) || a.name.localeCompare(b.name)),
      },
      {
        key: 'type',
        label: 'Types',
        items: FILE_GROUPS
          .map((group) => ({
            value: group.value,
            name: group.name,
            icon: group.icon,
            count: pool.filter((file) => this.typeOf(file) === group.value).length,
          }))
          .filter((item) => item.count > 0),
      },
    ].filter((group) => group.items.length > 0);
  }

  filter(key: string, value: string): void {
    this.selected.clear();
    this.share.close();
    this.go({ [key]: key === 'show' && value === 'all' ? '' : value, page: null });
  }

  get filtered(): boolean {
    return !!(this.source || this.type || this.query || this.show !== 'all');
  }

  clearFilters(): void {
    this.go({ show: null, source: null, type: null, q: null, page: null });
  }

  search(value: string): void {
    this.go({ q: value, page: null });
  }

  // ── Sorting ─────────────────────────────────────────────────────────

  /** The toolbar's choice: the sort's name, which is none of its four
   *  when a heading set another (name, Z to A). */
  get sortChoice(): string {
    return nameOfSort(this.sort);
  }

  sortByChoice(name: string): void {
    this.go({ sort: name === 'newest' ? null : name, page: null });
  }

  /** A column heading was clicked. */
  sortBy(sort: Sort): void {
    this.sortByChoice(nameOfSort(sort));
  }

  private sorted(files: AppRecord[]): AppRecord[] {
    const way = this.sort.direction === 'asc' ? 1 : -1;
    const value = (file: AppRecord): string | number =>
      this.sort.key === 'name' ? this.nameOf(file).toLowerCase()
        : this.sort.key === 'size' ? Number(file.file?.size ?? 0)
        : this.changedAt(file);
    return [...files].sort((a, b) => {
      const [left, right] = [value(a), value(b)];
      return (left < right ? -1 : left > right ? 1 : 0) * way;
    });
  }

  // ── What is listed ──────────────────────────────────────────────────

  get shown(): AppRecord[] {
    const query = this.query.trim().toLowerCase();
    return this.sorted(this.pool.filter((file) =>
      (!this.source || this.sourceOf(file) === this.source)
      && (!this.type || this.typeOf(file) === this.type)
      && (!query || [this.nameOf(file), this.sourceLabel(file)].join(' ').toLowerCase().includes(query))));
  }

  get pagedFiles(): AppRecord[] {
    const start = (this.page - 1) * this.pageSize;
    return this.shown.slice(start, start + this.pageSize);
  }

  toPage(page: number): void {
    this.go({ page: page === 1 ? null : page });
  }

  // ── Upload ──────────────────────────────────────────────────────────

  onPicked(event: Event): void {
    const input = event.target as HTMLInputElement;
    this.queue(Array.from(input.files ?? []));
    input.value = ''; // the same file can be picked again
  }

  // Dropped anywhere over the list. Only files count: dragging a row's
  // text or a link over the page is not an upload.
  private carriesFiles(event: DragEvent): boolean {
    return this.canUpload && Array.from(event.dataTransfer?.types ?? []).includes('Files');
  }

  onDragOver(event: DragEvent): void {
    if (!this.carriesFiles(event)) return;
    event.preventDefault();
    this.dropping = true;
  }

  onDragLeave(event: DragEvent): void {
    // Leaving for a child of the list is not leaving the list.
    const into = event.relatedTarget as Node | null;
    if (!into || !(event.currentTarget as Node).contains(into)) this.dropping = false;
  }

  onDrop(event: DragEvent): void {
    if (!this.carriesFiles(event)) return;
    event.preventDefault();
    this.dropping = false;
    this.queue(Array.from(event.dataTransfer?.files ?? []));
  }

  /** Adds files to the queue. One too large is refused here, in its
   *  row, without being sent to be refused. */
  private queue(chosen: File[]): void {
    const limit = this.uploadLimitMb * 1024 * 1024;
    for (const file of chosen) {
      const large = file.size > limit;
      this.uploads.push({
        file, sent: 0,
        state: large ? 'failed' : 'waiting',
        problem: large ? `Larger than ${this.uploadLimitMb} MB` : '',
      });
    }
    void this.sendNext();
  }

  /** Sends the next waiting file, when none is on its way. The list is
   *  read again as each arrives, and stays where it is. */
  private async sendNext(): Promise<void> {
    if (this.uploads.some((upload) => upload.state === 'uploading')) return;
    const next = this.uploads.find((upload) => upload.state === 'waiting');
    if (!next) return;

    next.state = 'uploading';
    const sending = this.files.upload(next.file, (sent) => (next.sent = sent));
    next.cancel = sending.cancel;
    const result = await sending.done;
    next.cancel = undefined;
    if (result.error) {
      next.state = 'failed';
      next.problem = result.error;
    } else {
      next.state = 'done';
      next.sent = 1;
      await this.reload().catch(() => undefined);
      setTimeout(() => this.dismiss(next), DONE_FOR_MS);
    }
    void this.sendNext();
  }

  retry(upload: Upload): void {
    upload.state = 'waiting';
    upload.problem = '';
    upload.sent = 0;
    void this.sendNext();
  }

  /** Stops one on its way, or takes a row that is over off the list. */
  dismiss(upload: Upload): void {
    upload.cancel?.();
    this.uploads = this.uploads.filter((entry) => entry !== upload);
  }

  uploadWords(upload: Upload): string {
    switch (upload.state) {
      case 'waiting': return 'Waiting';
      case 'uploading': return `Uploading ${Math.round(upload.sent * 100)}%`;
      case 'done': return 'Done';
      default: return `Failed: ${upload.problem}`;
    }
  }

  // ── Display ─────────────────────────────────────────────────────────

  nameOf(file: AppRecord): string {
    return file.file?.name || 'Untitled file';
  }

  /** The name without its extension, and the extension: the row says
   *  the second more quietly. */
  stem(file: AppRecord): string {
    const name = this.nameOf(file);
    const extension = extensionOf(name);
    return extension ? name.slice(0, -(extension.length + 1)) : name;
  }

  extension(file: AppRecord): string {
    return extensionOf(this.nameOf(file));
  }

  sizeOf(file: AppRecord): string {
    return sizeLabel(Number(file.file?.size ?? 0));
  }

  /** When the file last changed: files are written once, so for most
   *  this is when they were stored. */
  private changedAt(file: AppRecord): string {
    return file.updated_at || file.created_at || '';
  }

  changed(file: AppRecord): string {
    return relativeDate(this.changedAt(file));
  }

  changedInFull(file: AppRecord): string {
    return fullDate(this.changedAt(file));
  }

  // ── Actions ─────────────────────────────────────────────────────────

  /** A new chat's composer with this file staged in it, as its record:
   *  the person says what to do with it. No chat is made until they
   *  send: one made now and left unsent would be an empty chat in the
   *  list, and the file would not be in it. */
  useInChat(file: AppRecord): void {
    this.error = '';
    void this.router.navigate(['ai/chats'], { state: { stagedFiles: [file] } });
  }

  download(file: AppRecord): void {
    // Fetched with the session and saved from here: a bare link to the
    // API server carries no token.
    this.files.download(file.record_id, this.nameOf(file)).catch(() => {
      this.error = 'The file could not be downloaded just now.';
    });
  }

  async rename(file: AppRecord, name: string): Promise<void> {
    this.renaming = true;
    this.renameProblem = '';
    try {
      const result = await this.service.update('file', file.record_id, { name });
      if (result.error || !result.record) {
        this.renameProblem = result.error || 'The name could not be changed.';
        return;
      }
      this.records = this.records.map((entry) => entry.record_id === file.record_id ? result.record! : entry);
    } finally {
      this.renaming = false;
    }
  }

  protected override deleted(file: AppRecord): void {
    if (file.record_id === this.openId) this.closeOpened();
  }

  /** Whether the row's menu would hold anything. */
  hasActions(file: AppRecord): boolean {
    return this.isMine(file) && (this.can('update') || this.can('transfer') || this.can('delete'));
  }
}
