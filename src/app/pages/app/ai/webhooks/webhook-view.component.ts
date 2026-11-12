import { Component, EventEmitter, Input, OnChanges, Output, SimpleChanges } from '@angular/core';

import { fullDate, relativeDate } from 'src/app/components/ui/dates';
import { Choice } from 'src/app/components/ui/radio-keys';
import { AuthService } from 'src/app/services/auth.service';
import { EngineService } from 'src/app/services/engine.service';
import { Webhook, WebhookExecution, WebhooksService } from 'src/app/services/webhooks.service';
import { TRUST_CHOICES } from '../chat/chat-defaults';
import { FIELD_TYPES, WebhookField, copyText, curlExample, fieldsOf } from './webhooks-shared';

type Tab = 'executions' | 'settings';

/**
 * One webhook, opened: every call it received, newest first, accepted
 * or refused and why, and, for its owner, its settings and the way to
 * call it. What its chat did with a call is read in the chat.
 *
 * Someone it was shared with sees the calls alone. Nothing here
 * changes anything itself: the page owns the doors, and this says which
 * one was asked for. The calls are this view's own read.
 */
@Component({
  selector: 'app-webhook-view',
  standalone: false,
  templateUrl: './webhook-view.component.html',
  styleUrls: ['../schedules/opened-shared.css', './webhook-view.component.css'],
})
export class WebhookViewComponent implements OnChanges {
  @Input({ required: true }) webhook!: Webhook;
  @Input() busy = false;

  @Output() closed = new EventEmitter<void>();
  @Output() edit = new EventEmitter<void>();
  @Output() setEnabled = new EventEmitter<boolean>();
  @Output() test = new EventEmitter<void>();
  @Output() share = new EventEmitter<void>();
  @Output() rotate = new EventEmitter<void>();
  @Output() remove = new EventEmitter<void>();
  @Output() handOver = new EventEmitter<void>();
  @Output() withdraw = new EventEmitter<void>();

  readonly tabs: Choice<Tab>[] = [
    { value: 'executions', name: 'Calls' },
    { value: 'settings', name: 'Settings' },
  ];
  tab: Tab = 'executions';

  loading = true;
  problem = '';
  executions: WebhookExecution[] = [];
  /** A full page came back: there may be older calls. */
  more = false;
  fields: WebhookField[] = [];

  copied: '' | 'url' | 'curl' = '';

  /** The most calls one read answers with. */
  private static readonly PAGE = 100;

  constructor(
    private service: WebhooksService,
    private auth: AuthService,
    private engine: EngineService,
  ) {}

  ngOnChanges(changes: SimpleChanges): void {
    this.fields = fieldsOf(this.webhook.fields);
    // Another webhook starts on its calls, read afresh.
    const before = changes['webhook']?.previousValue as Webhook | undefined;
    if (before?.webhook_id !== this.webhook.webhook_id) {
      this.tab = 'executions';
      this.executions = [];
      this.copied = '';
      void this.load();
    }
  }

  /** The newest calls; with `older`, the page before the last one read. */
  async load(older = false): Promise<void> {
    const id = this.webhook.webhook_id;
    this.loading = true;
    this.problem = '';
    const last = older ? this.executions[this.executions.length - 1]?._id ?? '' : '';
    const page = await this.service.executions(id, last);
    this.loading = false;
    if (id !== this.webhook.webhook_id) return;
    if (page.error) {
      this.problem = page.error;
      return;
    }
    this.executions = older ? [...this.executions, ...page.executions] : page.executions;
    this.more = page.executions.length === WebhookViewComponent.PAGE;
  }

  // ── Who may do what ─────────────────────────────────────────────────

  get isOwner(): boolean { return !this.webhook.role; }
  private may(action: string): boolean { return this.isOwner && this.auth.can(`settings:webhook:${action}`); }
  get mayUpdate(): boolean { return this.may('update'); }
  get mayTest(): boolean { return this.may('test'); }
  get mayShare(): boolean { return this.may('share'); }
  get mayRotate(): boolean { return this.may('rotate'); }
  get mayDelete(): boolean { return this.may('delete'); }
  get mayHandOver(): boolean { return this.may('transfer') && !this.webhook.handing; }
  get mayWithdraw(): boolean { return this.may('withdraw') && !!this.webhook.handing; }

  // ── Words ───────────────────────────────────────────────────────────

  /** How many of the calls read ended this way, for the tiles. */
  count(outcome: WebhookExecution['outcome']): number {
    return this.executions.filter((run) => run.outcome === outcome).length;
  }

  /** A call's outcome as its icon. */
  outcomeIcon(run: WebhookExecution): string {
    return run.outcome === 'accepted' ? 'circle-check' : run.outcome === 'test' ? 'circle-dot' : 'circle-x';
  }

  when(run: WebhookExecution): string { return relativeDate(run.at); }
  whenInFull(run: WebhookExecution): string { return fullDate(run.at); }

  /** The whole address a caller posts to: the API server's, which
   *  receives webhooks — not this page's. */
  get url(): string {
    return this.engine.http(this.webhook.path);
  }

  get trustWord(): string {
    return TRUST_CHOICES.find((choice) => choice.value === this.webhook.trust)?.name || String(this.webhook.trust ?? '');
  }

  typeWord(type: string): string {
    return FIELD_TYPES.find((choice) => choice.value === type)?.name || type;
  }

  /** The whole call, the secret aside: that is shown once, so the
   *  command reads it from the shell. */
  get curl(): string {
    return curlExample(this.url, '$WEBHOOK_SECRET', this.fields, !!this.webhook.require_signature);
  }

  async copy(what: 'url' | 'curl'): Promise<void> {
    this.copied = (await copyText(what === 'url' ? this.url : this.curl)) ? what : '';
  }
}
