import { NgIf } from '@angular/common';
import { Component, EventEmitter, Input, Output } from '@angular/core';

/**
 * The foot of a list read down rather than paged: how many are shown,
 * and the button for the next ones. For a list the API server gives a
 * page at a time from the newest (the trail, what a webhook received),
 * or a long one shown a step at a time (a group's people).
 *
 *   <app-more [shown]="lines.length" [hasMore]="!!before" [loading]="loadingMore"
 *             label="Load older" (more)="loadMore()"></app-more>
 *
 *   <app-more [shown]="people.count(all)" [total]="all.length" (more)="people.more()"></app-more>
 *
 * With a `total`, it says "12 of 40" and offers more while some are
 * not shown; without one (the server keeps the count to itself), it
 * offers more while `hasMore`. It is not shown when there is nothing
 * more and nothing worth counting.
 */
@Component({
  selector: 'app-more',
  standalone: true,
  imports: [NgIf],
  styleUrl: './more.component.css',
  host: { '[hidden]': '!visible' },
  template: `
    <span class="more-range" *ngIf="total !== null && total > 0">{{ shown }} of {{ total }}</span>
    <button class="btn sm" type="button" *ngIf="canMore" [disabled]="loading" [attr.aria-busy]="loading || null"
            (click)="more.emit()">
      {{ loading ? "Loading…" : label }}
    </button>
  `,
})
export class MoreComponent {
  /** How many are shown. */
  @Input() shown = 0;
  /** How many there are, when it is known. */
  @Input() total: number | null = null;
  /** Without a total: whether the server has more to give. */
  @Input() hasMore = false;
  @Input() loading = false;
  @Input() label = 'Show more';

  @Output() more = new EventEmitter<void>();

  get canMore(): boolean {
    return this.total !== null ? this.shown < this.total : this.hasMore;
  }

  get visible(): boolean {
    return this.canMore;
  }
}
