import { Component, Inject } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';

import { Choice } from 'src/app/components/ui/radio-keys';
import { EngineService } from 'src/app/services/engine.service';
import { Webhook, WebhookDraft, WebhooksService } from 'src/app/services/webhooks.service';
import { TRUST_CHOICES } from '../chat/chat-defaults';
import {
  FIELD_TYPES, HMAC_LINE, WebhookField, copyText, curlExample, fieldNameProblem, fieldsOf, schemaOf,
} from './webhooks-shared';

/** What the dialog is opened with: nothing to make one; a webhook to
 *  change it; a webhook and its new secret to show the secret once. */
export interface WebhookDialogData {
  webhook?: Webhook;
  secret?: string;
}

/**
 * Making or changing a webhook, and — after it is made or its secret
 * replaced — the one moment its secret is in the open, with its address
 * and a call to paste.
 *
 * Its chat runs at the webhook's trust level, which the organization
 * caps; the chat's model and agents are the chat's own settings, changed
 * in the chat. The dialog closes with the webhook as it now is, or
 * nothing when nothing changed.
 *
 * Once the secret is shown the dialog is not dismissed by Escape or a
 * click outside, and Done asks twice if the secret was not copied, as
 * an API key's does.
 */
@Component({
  selector: 'app-webhook-dialog',
  standalone: false,
  templateUrl: './webhook-dialog.component.html',
  styleUrl: './webhook-dialog.component.css',
})
export class WebhookDialogComponent {
  readonly types = FIELD_TYPES;
  readonly trustChoices: Choice<number>[] = TRUST_CHOICES;
  readonly hmacLine = HMAC_LINE;

  /** The webhook being changed, or null while one is being made. */
  readonly editing: Webhook | null;

  name = '';
  instruction = '';
  fields: WebhookField[] = [];
  requireSignature = false;
  trust = 0;

  /** Save was pressed: what is missing is said under its field. */
  tried = false;
  saving = false;
  error = '';

  /** The webhook and its secret, once made or replaced. */
  made: Webhook | null = null;
  secret = '';
  copied: Record<string, boolean> = {};
  copyFailed = false;
  /** The secret, alone or in the call, was copied. */
  secretCopied = false;
  /** Done was pressed without the secret having been copied. */
  warned = false;

  constructor(
    public dialog: MatDialogRef<WebhookDialogComponent, Webhook | null>,
    @Inject(MAT_DIALOG_DATA) data: WebhookDialogData | null,
    private service: WebhooksService,
    private engine: EngineService,
  ) {
    this.editing = data?.webhook && !data.secret ? data.webhook : null;
    if (data?.webhook && data.secret) this.show(data.webhook, data.secret);
    const from = this.editing;
    if (from) {
      this.name = from.name;
      this.instruction = from.instruction;
      this.fields = fieldsOf(from.fields);
      this.requireSignature = !!from.require_signature;
      this.trust = from.trust ?? 0;
    }
  }

  // ── Fields ──────────────────────────────────────────────────────────

  addField(): void {
    this.fields = [...this.fields, { name: '', type: 'text', required: false, description: '' }];
  }

  removeField(index: number): void {
    this.fields = this.fields.filter((_, at) => at !== index);
  }

  fieldProblem(field: WebhookField): string {
    return this.tried ? fieldNameProblem(field.name, this.fields) : '';
  }

  // ── Saving ──────────────────────────────────────────────────────────

  get valid(): boolean {
    return !!this.name.trim() && !!this.instruction.trim()
      && this.fields.every((field) => !fieldNameProblem(field.name, this.fields));
  }

  /** What is sent: everything for a new one; what changed for one being edited. */
  draft(): WebhookDraft {
    const fields = schemaOf(this.fields.map((field) => ({
      ...field, name: field.name.trim(), description: field.description.trim(),
    })));
    const all: WebhookDraft = {
      name: this.name.trim(), instruction: this.instruction.trim(), fields,
      require_signature: this.requireSignature, trust: this.trust,
    };
    const from = this.editing;
    if (!from) return all;
    const changes: WebhookDraft = {};
    if (all.name !== from.name) changes.name = all.name;
    if (all.instruction !== from.instruction) changes.instruction = all.instruction;
    if (JSON.stringify(fields) !== JSON.stringify(schemaOf(fieldsOf(from.fields)))) changes.fields = fields;
    if (all.require_signature !== !!from.require_signature) changes.require_signature = all.require_signature;
    if (all.trust !== from.trust) changes.trust = all.trust;
    return changes;
  }

  async save(): Promise<void> {
    if (this.saving) return;
    this.tried = true;
    this.error = '';
    if (!this.valid) return;
    const draft = this.draft();
    if (this.editing && !Object.keys(draft).length) {
      this.dialog.close(null);
      return;
    }
    this.saving = true;
    this.dialog.disableClose = true;
    try {
      if (this.editing) {
        const result = await this.service.update(this.editing.webhook_id, draft);
        if (result.error || !result.webhook) {
          this.error = result.error || 'The webhook could not be saved.';
          return;
        }
        this.dialog.close(result.webhook);
      } else {
        const result = await this.service.create(draft);
        if (result.error || !result.webhook || !result.secret) {
          this.error = result.error || 'The webhook could not be made.';
          return;
        }
        this.show(result.webhook, result.secret);
      }
    } finally {
      this.saving = false;
      if (!this.made) this.dialog.disableClose = false;
    }
  }

  // ── Shown once ──────────────────────────────────────────────────────

  private show(webhook: Webhook, secret: string): void {
    this.made = webhook;
    this.secret = secret;
    this.dialog.disableClose = true;
  }

  /** The whole address a caller posts to: the API server's, which
   *  receives webhooks — not this page's. */
  get url(): string {
    return this.made ? this.engine.http(this.made.path) : '';
  }

  get curl(): string {
    return this.made
      ? curlExample(this.url, this.secret, fieldsOf(this.made.fields), !!this.made.require_signature) : '';
  }

  async copy(what: 'url' | 'secret' | 'curl'): Promise<void> {
    const text = what === 'url' ? this.url : what === 'secret' ? this.secret : this.curl;
    if (!(await copyText(text))) {
      this.copyFailed = true;
      return;
    }
    this.copyFailed = false;
    this.copied = { [what]: true };
    // The call carries the secret, so copying it is copying the secret.
    if (what !== 'url') {
      this.secretCopied = true;
      this.warned = false;
    }
  }

  done(): void {
    if (!this.secretCopied && !this.warned) {
      this.warned = true;
      return;
    }
    this.dialog.close(this.made);
  }
}
