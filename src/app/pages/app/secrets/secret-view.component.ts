import { Component, EventEmitter, Input, OnChanges, Output } from '@angular/core';

import { fullDate, relativeDate } from 'src/app/components/ui/dates';
import { AppRecord, RecordShape } from 'src/app/services/records.service';
import { ShownField, connects, isConnected, providerName, shownFields } from './secret-shared';

/**
 * One secret, opened: what it is, its fields (the plain ones as text,
 * the encrypted ones said to be set and never shown), the account it
 * connects, the agents that may use it, who can see it, and when it was
 * made.
 *
 * Nothing here changes anything itself: the page owns the calls, and
 * this says which one was asked for.
 */
@Component({
  selector: 'app-secret-view',
  standalone: false,
  templateUrl: './secret-view.component.html',
  styleUrl: './secret-view.component.css',
})
export class SecretViewComponent implements OnChanges {
  @Input({ required: true }) secret!: AppRecord;
  /** Its resource, as its agent declares it; null for one no longer declared. */
  @Input() shape: RecordShape | null = null;
  @Input() title = '';
  @Input() kind = '';
  /** The agents that may use it, by name. */
  @Input() agents: string[] = [];
  /** Who can see it, in the words the list uses. */
  @Input() sharing = '';
  /** Whose it is, when it is not the person's. */
  @Input() madeBy = '';
  /** Whom it is handed to, waiting for them to accept. */
  @Input() handingTo = '';
  /** It is the person's own: only its maker changes it. */
  @Input() mine = false;
  @Input() canUpdate = false;
  @Input() canTransfer = false;
  @Input() canDelete = false;
  /** An action is on its way for it. */
  @Input() busy = false;

  @Output() closed = new EventEmitter<void>();
  @Output() edit = new EventEmitter<void>();
  @Output() connect = new EventEmitter<void>();
  @Output() agentsAsked = new EventEmitter<void>();
  @Output() share = new EventEmitter<void>();
  @Output() handOver = new EventEmitter<void>();
  @Output() withdraw = new EventEmitter<void>();
  @Output() remove = new EventEmitter<void>();

  fields: ShownField[] = [];
  oauth = false;
  connected = false;
  provider = '';

  ngOnChanges(): void {
    this.fields = shownFields(this.secret, this.shape);
    this.oauth = connects(this.shape);
    this.connected = isConnected(this.secret);
    this.provider = providerName(this.shape);
  }

  get account(): string {
    return String(this.secret.keys?.['account'] || '');
  }

  get created(): string {
    return fullDate(this.secret.created_at || '');
  }

  get updated(): string {
    const changed = this.secret.updated_at || '';
    return changed && changed !== this.secret.created_at ? relativeDate(changed).replace(/^J/, 'j') : '';
  }

  get updatedInFull(): string {
    return fullDate(this.secret.updated_at || '');
  }
}
