import { NgFor, NgIf } from '@angular/common';
import { Component, EventEmitter, Input, OnChanges, OnDestroy, OnInit, Output, SimpleChanges } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { LucideAngularModule } from 'lucide-angular';

import { MoreComponent } from './more.component';
import { ServerList, ServerPage } from './paging';

/** One thing a picker offers: a group, a policy. */
export interface Pick {
  id: string;
  name: string;
  hint?: string;
}

/** Reads a page of what may be picked, `q` in it. */
export type PickSearch = (q: string, after: string, limit: number) => Promise<ServerPage<Pick>>;

/** How many rows fit before the list scrolls in a box and is searched. */
const FITS = 6;

/**
 * Tick rows under one heading, for a list the API server pages: the
 * groups a person is placed in, the policies a group gives. What is
 * offered is read from the server a page at a time and searched there,
 * so an organization of thousands of groups is never read whole; the
 * ones chosen and not on the page read are shown first, by name.
 *
 *   <app-search-picks legend="Groups" [search]="searchGroups" [selected]="chosen"
 *                     [named]="chosenGroups"></app-search-picks>
 *
 * Ticking changes `selected` in place, and says which in `changed`.
 */
@Component({
  selector: 'app-search-picks',
  standalone: true,
  imports: [NgFor, NgIf, FormsModule, MatCheckboxModule, LucideAngularModule, MoreComponent],
  styleUrl: '../../pages/admin/admin-shared.css',
  styles: [`
    .picks-search { margin-bottom: 8px; }
    .picks-none { margin: 4px 0; color: var(--ink-2); font-size: var(--t-sm); }
  `],
  template: `
    <fieldset class="admin-picks">
      <legend>{{ legend }}<span class="admin-count" *ngIf="loaded">{{ selected.size }} of {{ all }}</span></legend>
      <span class="search-field picks-search" *ngIf="all > fits || query">
        <lucide-icon name="search" [size]="16" aria-hidden="true"></lucide-icon>
        <input class="input" type="search" [placeholder]="placeholder" [attr.aria-label]="placeholder"
               [(ngModel)]="query" [ngModelOptions]="{ standalone: true }" (ngModelChange)="list.search()" />
      </span>
      <div class="ui-checks" [class.is-long]="all > fits" [attr.aria-busy]="list.loading || null">
        <mat-checkbox class="check-row" *ngFor="let pick of rows" [checked]="selected.has(pick.id)"
                      [disabled]="disabled" (change)="toggle(pick.id)">
          <span class="check-name">{{ pick.name }}</span>
          <span class="check-hint" *ngIf="pick.hint">{{ pick.hint }}</span>
        </mat-checkbox>
        <p class="picks-none" *ngIf="list.loaded && !rows.length">{{ query.trim() ? 'Nothing matches.' : none }}</p>
      </div>
      <app-more [shown]="list.rows.length" [total]="list.total" [loading]="list.loading" label="Show more"
                (more)="list.more()"></app-more>
    </fieldset>
  `,
})
export class SearchPicksComponent implements OnInit, OnChanges, OnDestroy {
  @Input({ required: true }) legend = '';
  @Input({ required: true }) search!: PickSearch;
  /** The ids chosen; changed in place. */
  @Input({ required: true }) selected = new Set<string>();
  /** The chosen ones by name, to show those not on the page read. */
  @Input() named: Pick[] = [];
  @Input() disabled = false;
  @Input() placeholder = 'Search';
  /** Said when there is nothing to pick at all. */
  @Input() none = 'Nothing to choose from yet.';

  @Output() changed = new EventEmitter<string>();

  readonly fits = FITS;
  query = '';
  /** How many there are to pick from, unsearched. */
  all = 0;
  loaded = false;
  readonly list = new ServerList<Pick>(20, async (after, limit) => {
    const q = this.query.trim();
    const page = await this.search(q, after, limit);
    if (!q && !page.error) {
      this.all = page.total;
      this.loaded = true;
    }
    return page;
  });

  ngOnInit(): void {
    void this.list.first();
  }

  ngOnChanges(changes: SimpleChanges): void {
    // Another search (a dialog opened for another thing): read again.
    if (changes['search'] && !changes['search'].firstChange) void this.list.first();
  }

  ngOnDestroy(): void {
    this.list.cancel();
  }

  /** The chosen ones not on the page read, first; then the page. */
  get rows(): Pick[] {
    if (this.query.trim()) return this.list.rows;
    const read = new Set(this.list.rows.map((pick) => pick.id));
    const chosen = this.named.filter((pick) => this.selected.has(pick.id) && !read.has(pick.id));
    return [...chosen, ...this.list.rows];
  }

  toggle(id: string): void {
    if (!this.selected.delete(id)) this.selected.add(id);
    this.changed.emit(id);
  }
}
