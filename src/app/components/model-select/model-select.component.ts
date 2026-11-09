import { Component, EventEmitter, Input, OnChanges, Output } from '@angular/core';

import { Choice } from 'src/app/components/ui/radio-keys';
import { LlmConnection } from 'src/app/services/settings-llm.service';

/** A model connection, and one of its models. */
export interface ModelChoice {
  connectionId: string;
  model: string;
}

/**
 * Choosing a model: which connection, then which of the models it
 * offers.
 *
 * The list is an offer, never a gate: a model that is not on it — one
 * newer than the connection was told of, a deployment by its own name —
 * is typed, by the provider's own id for it.
 */
@Component({
  selector: 'app-model-select',
  standalone: false,
  templateUrl: './model-select.component.html',
  styleUrls: ['./model-select.component.css'],
})
export class ModelSelectComponent implements OnChanges {
  /** The connections to choose among — already narrowed by the page to
   *  the ones that may be used here. */
  @Input() connections: LlmConnection[] = [];
  @Input() connectionId = '';
  @Input() model = '';
  @Input() disabled = false;
  /** What choosing no connection means here, in words. */
  @Input() noneLabel = 'None';

  @Output() changed = new EventEmitter<ModelChoice>();

  /** The model is being typed rather than picked from the list. */
  typing = false;

  /** The select's value for "not on the list". */
  readonly other = '__other__';

  /** The connections, with "none of them" first; and the chosen one's
   *  models, with the way to one not listed last. */
  providerChoices: Choice[] = [];
  modelChoices: Choice[] = [];

  /** The chosen connection's models. */
  get models(): string[] {
    return this.connections.find((connection) => connection.connection_id === this.connectionId)?.models ?? [];
  }

  ngOnChanges(): void {
    this.providerChoices = [
      { value: '', name: this.noneLabel },
      ...this.connections.map((connection) => ({ value: connection.connection_id, name: connection.name })),
    ];
    this.offer();
  }

  private offer(): void {
    this.modelChoices = [...this.models.map((model) => ({ value: model, name: model })), { value: this.other, name: 'Another model…' }];
    this.typing = !!this.connectionId && (!this.models.length || (!!this.model && !this.models.includes(this.model)));
  }

  /** A connection chosen: the first model it offers with it. */
  chooseConnection(connectionId: string): void {
    this.connectionId = connectionId;
    this.model = connectionId ? this.models[0] ?? '' : '';
    this.offer();
    this.changed.emit({ connectionId, model: this.model });
  }

  chooseModel(model: string): void {
    this.typing = model === this.other;
    this.model = this.typing ? '' : model;
    this.changed.emit({ connectionId: this.connectionId, model: this.model });
  }

  typeModel(model: string): void {
    this.model = model.trim();
    this.changed.emit({ connectionId: this.connectionId, model: this.model });
  }

  /** Back from typing to the list, where there is one. */
  pickFromList(): void {
    this.chooseModel(this.models[0] ?? '');
  }
}
