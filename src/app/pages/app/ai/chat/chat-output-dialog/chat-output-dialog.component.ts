import { Component, Inject, OnInit } from '@angular/core';
import { MAT_DIALOG_DATA } from '@angular/material/dialog';

import { AiSessionService } from 'src/app/services/ai-session.service';

/** What the dialog reads: a chat's piece of work, by its output's ref. */
export interface OutputDialogData {
  chatId: string;
  ref: string;
  title: string;
}

/**
 * The whole output of a piece of the assistant's work, as it was kept: a
 * page at a time, the rest on asking, and copied whole.
 */
@Component({
  selector: 'app-chat-output-dialog',
  standalone: false,
  template: `
    <h2 mat-dialog-title>{{ data.title }}</h2>
    <mat-dialog-content>
      @if (error) {
        <p class="form-notice is-error" role="alert">{{ error }}</p>
      } @else if (loading && !text) {
        <p class="dialog-note">Reading the output…</p>
      } @else {
        <pre class="output-text">{{ text }}</pre>
        @if (text.length < size) {
          <button class="btn sm" type="button" [disabled]="loading" (click)="more()">
            {{ loading ? 'Reading…' : 'Read on (' + (size - text.length) + ' more characters)' }}
          </button>
        }
      }
    </mat-dialog-content>
    <mat-dialog-actions>
      <button class="btn" type="button" [disabled]="!text" (click)="copy()">{{ copied ? 'Copied' : 'Copy' }}</button>
      <button class="btn primary" type="button" mat-dialog-close>Close</button>
    </mat-dialog-actions>
  `,
  styles: [`.output-text { max-height: 60vh; margin: 0 0 12px; padding: 12px; overflow: auto;
    border-radius: var(--r-md); background: var(--surface-2); font: 400 var(--t-sm) / var(--lh-sm) var(--font-mono);
    white-space: pre-wrap; overflow-wrap: anywhere; }`],
})
export class ChatOutputDialogComponent implements OnInit {
  text = '';
  size = 0;
  loading = false;
  error = '';
  copied = false;

  constructor(@Inject(MAT_DIALOG_DATA) readonly data: OutputDialogData, private session: AiSessionService) {}

  ngOnInit(): Promise<void> {
    return this.more();
  }

  /** The next page of it. */
  async more(): Promise<void> {
    this.loading = true;
    const res = await this.session.output(this.data.chatId, this.data.ref, this.text.length);
    this.loading = false;
    if (res.error || !res.data) {
      this.error = res.error || 'The output could not be read.';
      return;
    }
    this.text += res.data.text;
    this.size = res.data.size;
  }

  /** All of it, read first where it is not yet. */
  async copy(): Promise<void> {
    while (this.text.length < this.size && !this.error) await this.more();
    await navigator.clipboard?.writeText(this.text);
    this.copied = true;
  }
}
