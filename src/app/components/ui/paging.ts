/**
 * The page of a list shown, on the client: for lists the API server
 * answers whole (keys, memories…), or reads whole a page at a time
 * (records, skills), and that are searched and sorted here. A list the
 * server pages and searches itself (people, groups, policies…) is a
 * ServerPages or a ServerList, below.
 *
 *   readonly paging = new Paging(20);
 *
 *   <app-row *ngFor="let user of paging.of(shown, query)">…</app-row>
 *   <app-pager [page]="paging.page" [pageSize]="paging.size"
 *              [total]="shown.length" (pageChange)="paging.page = $event"></app-pager>
 *
 * `of` cuts the rows of the page shown. Given a key (the search, the
 * filter, as one string), it goes back to the first page when the key
 * changes: a narrower search never leaves you on an empty page 4. Past
 * the last page (rows went), it shows the last one.
 *
 * The pager goes after the rows in the template, so it reads the page
 * `of` has settled.
 */
export class Paging {
  /** The page shown, from 1. */
  page = 1;
  private key: string | undefined;

  constructor(readonly size = 20) {}

  of<T>(rows: readonly T[], key = ''): T[] {
    if (key !== this.key) {
      if (this.key !== undefined) this.page = 1;
      this.key = key;
    }
    const last = Math.max(1, Math.ceil(rows.length / this.size));
    if (this.page > last) this.page = last;
    if (this.page < 1) this.page = 1;
    return rows.slice((this.page - 1) * this.size, this.page * this.size);
  }

  /** Whether the rows are more than a page: the pager is worth showing. */
  more(rows: readonly unknown[]): boolean {
    return rows.length > this.size;
  }
}

/**
 * The first rows of a list that is read down rather than paged through
 * (a group's people, a run's files, a profile's groups): `step` at a
 * time, with a "Show more" under them.
 *
 *   readonly people = new Shown(10);
 *
 *   <li *ngFor="let person of people.of(editingPeople)">…</li>
 *   <app-more [shown]="people.count(editingPeople)" [total]="editingPeople.length"
 *             (more)="people.more()"></app-more>
 */
export class Shown {
  private limit: number;

  constructor(readonly step = 10) {
    this.limit = step;
  }

  of<T>(rows: readonly T[]): T[] {
    return rows.length > this.limit ? rows.slice(0, this.limit) : (rows as T[]);
  }

  count(rows: readonly unknown[]): number {
    return Math.min(rows.length, this.limit);
  }

  more(): void {
    this.limit += this.step;
  }

  /** Back to the first `step`: a dialog opened again, another item. */
  reset(): void {
    this.limit = this.step;
  }
}

/**
 * One page of a list the API server pages: its rows, the cursor of the
 * page after it (null at the end), and how many rows match in all.
 */
export interface ServerPage<T> {
  rows: T[];
  next: string | null;
  total: number;
  error?: string;
}

/** Reads a page: after the cursor given ('' for the first), `limit` rows. */
export type PageReader<T> = (after: string, limit: number) => Promise<ServerPage<T>>;

/** How long a search waits for the typing to stop before asking. */
export const SEARCH_WAIT = 250;

/**
 * A list the API server pages, shown a page at a time with the pager:
 * page N is read after the cursor page N-1 answered, so the pages read
 * are remembered and an earlier one is read again from its own cursor.
 *
 *   readonly pages = new ServerPages<Member>(20, (after, limit) => this.read(after, limit));
 *
 *   <app-row *ngFor="let member of pages.rows">…</app-row>
 *   <app-pager [page]="pages.page" [pageSize]="pages.size" [total]="pages.total"
 *              (pageChange)="pages.go($event)"></app-pager>
 *
 * A new search or filter goes back to the first page (`first`, or
 * `search` to wait for the typing to stop); a change to a row reads the
 * page shown again (`reload`), and the one before when it emptied. An
 * answer overtaken by a later ask is dropped, and a refusal leaves the
 * rows shown as they were.
 */
export class ServerPages<T> {
  /** The page shown, from 1. */
  page = 1;
  rows: T[] = [];
  /** How many rows match, in all. */
  total = 0;
  loading = false;
  /** Read once at least: an empty list is empty, not unread. */
  loaded = false;
  error = '';
  /** The cursor each page read was read after: page N's is [N-1]. */
  private cursors: string[] = [''];
  private next: string | null = null;
  private asked = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(readonly size: number, private read: PageReader<T>, private wait = SEARCH_WAIT) {}

  /** Whether the server has a page after this one. */
  get hasNext(): boolean {
    return this.next !== null;
  }

  /** The first page, read again: a new search, a new filter. */
  first(): Promise<void> {
    this.cancel();
    this.page = 1;
    this.cursors = [''];
    return this.load();
  }

  /** The first page once the typing has stopped. */
  search(): void {
    this.cancel();
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.first();
    }, this.wait);
  }

  /** A page the pager asks for: the next one, or one read before. */
  async go(page: number): Promise<void> {
    if (page === this.page + 1 && this.next !== null) {
      this.cursors[this.page] = this.next;
      this.page = page;
      return this.load();
    }
    if (page >= 1 && page < this.page && this.cursors[page - 1] !== undefined) {
      this.page = page;
      return this.load();
    }
  }

  /** The page shown, read again after a change; the one before when it
   *  emptied. */
  async reload(): Promise<void> {
    await this.load();
    if (!this.rows.length && this.page > 1 && !this.error) {
      this.page -= 1;
      await this.load();
    }
  }

  /** A pending search dropped: the page is going away. */
  cancel(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  private async load(): Promise<void> {
    const ask = ++this.asked;
    this.loading = true;
    try {
      const answer = await this.read(this.cursors[this.page - 1] ?? '', this.size);
      if (ask !== this.asked) return;
      this.error = answer.error ?? '';
      if (answer.error) return;
      this.rows = answer.rows;
      this.total = answer.total;
      this.next = answer.next;
      this.loaded = true;
    } finally {
      if (ask === this.asked) this.loading = false;
    }
  }
}

/**
 * A list the API server pages, read down: the first page, then "Load
 * more" adds the next one under it.
 *
 *   readonly list = new ServerList<Card>(50, (after, limit) => this.read(after, limit));
 *
 *   <app-more [shown]="list.rows.length" [total]="list.total" [loading]="list.loading"
 *             (more)="list.more()"></app-more>
 */
export class ServerList<T> {
  rows: T[] = [];
  total = 0;
  loading = false;
  loaded = false;
  error = '';
  private next: string | null = null;
  private asked = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(readonly size: number, private read: PageReader<T>, private wait = SEARCH_WAIT) {}

  get hasMore(): boolean {
    return this.next !== null;
  }

  /** The first page, in place of every row read. */
  async first(): Promise<void> {
    this.cancel();
    const ask = ++this.asked;
    this.loading = true;
    try {
      const answer = await this.read('', this.size);
      if (ask !== this.asked) return;
      this.error = answer.error ?? '';
      if (answer.error) return;
      this.rows = answer.rows;
      this.total = answer.total;
      this.next = answer.next;
      this.loaded = true;
    } finally {
      if (ask === this.asked) this.loading = false;
    }
  }

  /** The first page once the typing has stopped. */
  search(): void {
    this.cancel();
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.first();
    }, this.wait);
  }

  /** The next page, under the rows read. */
  async more(): Promise<void> {
    if (this.next === null || this.loading) return;
    const ask = ++this.asked;
    this.loading = true;
    try {
      const answer = await this.read(this.next, this.size);
      if (ask !== this.asked) return;
      this.error = answer.error ?? '';
      if (answer.error) return;
      this.rows = [...this.rows, ...answer.rows];
      this.total = answer.total;
      this.next = answer.next;
    } finally {
      if (ask === this.asked) this.loading = false;
    }
  }

  /** Rows gone (answered, deleted): out of the rows, and of the count. */
  drop(gone: (row: T) => boolean): void {
    const before = this.rows.length;
    this.rows = this.rows.filter((row) => !gone(row));
    this.total = Math.max(0, this.total - (before - this.rows.length));
  }

  cancel(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }
}

/** Every page of a list, read one after another until the last: for a
 *  picker of a list that stays short (the model connections a person
 *  may use). A refusal ends the reading with what was read. */
export async function readEvery<T>(read: PageReader<T>, limit = 100): Promise<{ rows: T[]; total: number; error?: string }> {
  const rows: T[] = [];
  let after = '';
  for (;;) {
    const page = await read(after, limit);
    if (page.error) return { rows, total: rows.length, error: page.error };
    rows.push(...page.rows);
    if (page.next === null || !page.rows.length) return { rows, total: Math.max(page.total, rows.length) };
    after = page.next;
  }
}

/** What a paged request sends: the cursor when there is one, the size,
 *  and each filter that is set ('' and 'all' are none). */
export function pageAsk(after: string, limit: number, filters: Record<string, unknown> = {}): Record<string, unknown> {
  const ask: Record<string, unknown> = { limit };
  if (after) ask['after'] = after;
  for (const [key, raw] of Object.entries(filters)) {
    const value = typeof raw === 'string' ? raw.trim() : raw;
    if (value === '' || value === null || value === undefined || value === 'all') continue;
    ask[key] = value;
  }
  return ask;
}

/** A server answer's `next`: a cursor, or null at the end. */
export function nextOf(answer: { next?: unknown }): string | null {
  return typeof answer.next === 'string' && answer.next ? answer.next : null;
}
