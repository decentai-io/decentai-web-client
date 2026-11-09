import { Component, Inject } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';

import { Webhook, WebhooksService } from 'src/app/services/webhooks.service';
import { FIELD_TYPES, WebhookField, exampleBody, fieldsOf } from './webhooks-shared';

/**
 * A test, sent from the page: the body as JSON, started with every field
 * of the webhook, written into its chat with the instruction as a call's
 * would be, and marked a test. It is not checked against the fields, and
 * is not one of the webhook's calls.
 *
 * Closes with whether a runtime took it now; with nothing when it was
 * not sent.
 */
@Component({
  selector: 'app-webhook-test-dialog',
  standalone: false,
  templateUrl: './webhook-test-dialog.component.html',
  styleUrl: './webhook-dialog.component.css',
})
export class WebhookTestDialogComponent {
  readonly fields: WebhookField[];
  body: string;
  sending = false;
  error = '';

  constructor(
    public dialog: MatDialogRef<WebhookTestDialogComponent, boolean>,
    @Inject(MAT_DIALOG_DATA) public webhook: Webhook,
    private service: WebhooksService,
  ) {
    this.fields = fieldsOf(webhook.fields);
    this.body = exampleBody(this.fields, 2);
  }

  typeWord(type: string): string {
    return FIELD_TYPES.find((choice) => choice.value === type)?.name || type;
  }

  /** The body as an object, or why it is not one. */
  private parsed(): Record<string, unknown> | string {
    try {
      const value = JSON.parse(this.body || '{}');
      return value && typeof value === 'object' && !Array.isArray(value)
        ? value : 'The body is one JSON object: { "field": value, … }.';
    } catch {
      return 'That is not JSON. Check the quotes and commas.';
    }
  }

  async send(): Promise<void> {
    if (this.sending) return;
    const data = this.parsed();
    if (typeof data === 'string') {
      this.error = data;
      return;
    }
    this.sending = true;
    this.error = '';
    this.dialog.disableClose = true;
    try {
      const result = await this.service.test(this.webhook.webhook_id, data);
      if (result.error) {
        this.error = result.error;
        return;
      }
      this.dialog.close(result.sent === true);
    } finally {
      this.sending = false;
      this.dialog.disableClose = false;
    }
  }
}
