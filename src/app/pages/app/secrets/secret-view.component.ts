import { Component, EventEmitter, Input, OnChanges, Output, SimpleChanges } from '@angular/core';

import { fullDate, relativeDate } from 'src/app/components/ui/dates';
import { AppRecord, RecordOf, RecordShape } from 'src/app/services/records.service';
import {
  AgentChoice, ShownField, agentChoices, choiceKey, connects, isConnected, providerName, shownFields,
} from './secret-shared';

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
  /** The secret resources of the agents the person may use: what the
   *  agents it may be given to are found among. */
  @Input() shapes: RecordShape[] = [];
  /** Its agents are being chosen, in place. */
  @Input() changingAgents = false;
  /** Its agents are on their way to the server. */
  @Input() agentsBusy = false;
  /** Why the last change of its agents was refused. */
  @Input() agentsProblem = '';

  @Output() closed = new EventEmitter<void>();
  @Output() edit = new EventEmitter<void>();
  @Output() connect = new EventEmitter<void>();
  @Output() agentsAsked = new EventEmitter<void>();
  /** The agents chosen, to save. */
  @Output() agentsSaved = new EventEmitter<RecordOf[]>();
  @Output() agentsCancelled = new EventEmitter<void>();
  @Output() share = new EventEmitter<void>();
  @Output() handOver = new EventEmitter<void>();
  @Output() withdraw = new EventEmitter<void>();
  @Output() remove = new EventEmitter<void>();

  fields: ShownField[] = [];
  oauth = false;
  connected = false;
  provider = '';
  /** The agents it may be given to, and those ticked while choosing. */
  choices: AgentChoice[] = [];
  chosen: string[] = [];

  ngOnChanges(changes: SimpleChanges = {}): void {
    this.fields = shownFields(this.secret, this.shape);
    this.oauth = connects(this.shape);
    this.connected = isConnected(this.secret);
    this.provider = providerName(this.shape);
    // Choosing starts from what it serves now, and starts again when
    // another secret is opened.
    const started = changes['changingAgents']?.currentValue === true;
    const another = changes['secret'] && changes['secret'].previousValue?.record_id !== this.secret.record_id;
    if (started || changes['secret'] || changes['shapes']) {
      this.choices = agentChoices(this.secret.of, this.shapes, this.secret.agents);
    }
    if (started || another) this.chosen = this.secret.agents.map(choiceKey);
  }

  /** Save the agents ticked, the one it was made for always among them. */
  saveAgents(): void {
    const kept = this.choices.filter((choice) => choice.own || this.chosen.includes(choice.key));
    this.agentsSaved.emit(kept.map((choice) => choice.of));
  }

  /** It holds a value that is encrypted, said once in its title row. */
  get encrypted(): boolean {
    return this.fields.some((field) => field.hidden && field.set);
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
