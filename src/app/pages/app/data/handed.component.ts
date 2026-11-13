import { NgFor } from '@angular/common';
import { Component, EventEmitter, Input, Output } from '@angular/core';

import { MoreComponent } from 'src/app/components/ui/more.component';
import { Shown } from 'src/app/components/ui/paging';
import { AppRecord } from 'src/app/services/records.service';

/**
 * Records another member handed to the person, above the list they will
 * join: each in a sentence, to accept or decline. Until accepted, a
 * record stays its maker's. Three at a time: many handed at once (a
 * colleague leaving) would push the list out of sight.
 *
 *   <app-handed [records]="handed" [say]="handedSay" [busy]="busyRef"
 *               (answer)="accept($event.record, $event.yes)"></app-handed>
 */
@Component({
  selector: 'app-handed',
  standalone: true,
  imports: [NgFor, MoreComponent],
  template: `
    <p class="form-notice handed" role="status" *ngFor="let record of shown.of(records); trackBy: byId">
      <span class="handed-words">{{ say(record) }}</span>
      <button class="btn sm" type="button" [disabled]="busy === record.record_id" (click)="answer.emit({ record, yes: true })">Accept</button>
      <button class="btn ghost sm" type="button" [disabled]="busy === record.record_id" (click)="answer.emit({ record, yes: false })">Decline</button>
    </p>
    <app-more class="handed-more" [shown]="shown.count(records)" [total]="records.length" label="Show more handed to you"
              (more)="shown.more()"></app-more>
  `,
  styles: [`
    .handed { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin: 0 0 8px; }
    .handed-words { flex: 1; min-width: 12em; overflow-wrap: anywhere; }
    .handed-more { margin: 0 0 12px; }
  `],
})
export class HandedComponent {
  @Input() records: AppRecord[] = [];
  /** What a handed record is, in a sentence. */
  @Input({ required: true }) say!: (record: AppRecord) => string;
  /** The record an answer is on its way for. */
  @Input() busy = '';
  @Output() answer = new EventEmitter<{ record: AppRecord; yes: boolean }>();

  readonly shown = new Shown(3);

  byId(_: number, record: AppRecord): string {
    return record.record_id;
  }
}
