/**
 * The page of a list shown, on the client: for lists the API server
 * answers whole (users, groups, keys…), or reads whole a page at a time
 * (records, skills), and that are searched and sorted here.
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
