import { Component, OnDestroy, OnInit } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { ActivatedRoute, NavigationEnd, Router } from '@angular/router';
import { firstValueFrom, Subscription } from 'rxjs';

import { Candidate } from 'src/app/components/transfer-dialog/transfer-dialog.component';
import { AuthService } from 'src/app/services/auth.service';
import { ConfirmService } from 'src/app/services/confirm.service';
import { ProfileService } from 'src/app/services/profile.service';
import { Webhook, WebhooksService } from 'src/app/services/webhooks.service';
import { DataPageBase } from '../../data-page-base';
import { ShareEditor } from '../../share-editor';
import { WebhookDialogComponent, WebhookDialogData } from './webhook-dialog.component';
import { WebhookTestDialogComponent } from './webhook-test-dialog.component';

/** How wide the dialogs open. */
const WIDE = { width: '640px', maxWidth: '100vw' };

/**
 * Webhooks: addresses other services post events to, each waking a chat
 * of the person's, which acts on it with their permissions. Beside them,
 * the webhooks colleagues shared, to watch, and those they are handing
 * over, to accept or decline.
 *
 * A row's name opens the webhook at /ai/webhooks/<id>, beside the list
 * on a wide screen, as a schedule opens: every call it received and how
 * it was answered, and, for its owner, its settings. Making one and
 * changing one are the same dialog (webhook-dialog.component).
 *
 * Notifications out are a setting of the person's, under Settings.
 */
@Component({
  selector: 'app-webhooks',
  standalone: false,
  templateUrl: './webhooks.component.html',
  styleUrl: './webhooks.component.css',
})
export class WebhooksComponent extends DataPageBase implements OnInit, OnDestroy {
  loading = true;
  /** Why the webhooks could not be read. */
  loadError = '';
  webhooks: Webhook[] = [];
  shared: Webhook[] = [];
  /** Handed to the person, not yet accepted. */
  handed: Webhook[] = [];
  limit = 0;

  /** The webhook being handed over, while its dialog is open. */
  handing: Webhook | null = null;
  transferring = false;

  /** The webhook opened beside the list; '' for none. */
  openId = '';
  private address = new Subscription();

  /** The webhook an action is on its way for. */
  busyId = '';

  /** Who sees a webhook's calls, beside its owner. */
  readonly share = new ShareEditor(() => this.auth.user?.user_id ?? '');
  shareProblem = '';

  constructor(
    private service: WebhooksService,
    private profiles: ProfileService,
    public auth: AuthService,
    private router: Router,
    private route: ActivatedRoute,
    private dialog: MatDialog,
    private confirm: ConfirmService,
  ) {
    super();
  }

  async ngOnInit(): Promise<void> {
    this.address.add(this.router.events.subscribe((event) => {
      if (event instanceof NavigationEnd) this.readOpened();
    }));
    const [, peers] = await Promise.all([this.reload(), this.profiles.peers().catch(() => null)]);
    if (peers) this.share.peers = peers;
    this.loading = false;
    this.readOpened();
  }

  ngOnDestroy(): void {
    this.address.unsubscribe();
  }

  async reload(): Promise<void> {
    this.loadError = '';
    const page = await this.service.list();
    // A read that failed says so and leaves what was on screen.
    if (page.error) {
      this.loadError = page.error;
      return;
    }
    this.webhooks = page.webhooks;
    this.shared = page.shared;
    this.handed = page.handed;
    this.limit = page.limit;
  }

  // ── What the person may do ──────────────────────────────────────────

  get mayCreate(): boolean { return this.auth.can('settings:webhook:create'); }
  get mayUpdate(): boolean { return this.auth.can('settings:webhook:update'); }

  get atLimit(): boolean { return this.limit > 0 && this.webhooks.length >= this.limit; }

  get foot(): string {
    if (!this.webhooks.length) return '';
    const on = this.webhooks.filter((hook) => hook.enabled).length;
    return this.limit ? `${on} on · ${this.webhooks.length} of ${this.limit}` : `${on} on`;
  }

  // ── The numbers at the head ─────────────────────────────────────────

  /** The person's webhooks that take calls. */
  get onCount(): number { return this.webhooks.filter((hook) => hook.enabled).length; }
  /** Those whose calls must be signed. */
  get signedCount(): number { return this.webhooks.filter((hook) => hook.require_signature).length; }

  // ── The address ─────────────────────────────────────────────────────

  private readOpened(): void {
    this.openId = this.route.snapshot.firstChild?.paramMap.get('id') || '';
    if (this.openId && !this.loading && !this.loadError && !this.opened) {
      this.fail('That webhook is not yours, or shared with you, any more.');
      this.closeOpened();
    }
  }

  get opened(): Webhook | null {
    return [...this.webhooks, ...this.shared, ...this.handed].find((hook) => hook.webhook_id === this.openId) || null;
  }

  closeOpened(): void {
    void this.router.navigate(['/ai/webhooks']);
  }

  sharedWith(webhook: Webhook): boolean {
    return !!(webhook.viewers?.groups?.length || webhook.viewers?.users?.length);
  }

  // ── Making and changing: the one dialog ─────────────────────────────

  private take(webhook: Webhook): void {
    const known = this.webhooks.some((one) => one.webhook_id === webhook.webhook_id);
    this.webhooks = known
      ? this.webhooks.map((one) => one.webhook_id === webhook.webhook_id ? webhook : one)
      : [...this.webhooks, webhook];
  }

  private async openWebhook(data: WebhookDialogData | null): Promise<Webhook | null> {
    const ref = this.dialog.open<WebhookDialogComponent, WebhookDialogData | null, Webhook | null>(
      WebhookDialogComponent, { ...WIDE, data });
    return (await firstValueFrom(ref.afterClosed())) ?? null;
  }

  async create(): Promise<void> {
    const made = await this.openWebhook(null);
    if (!made) return;
    this.take(made);
    this.flash(`${made.name} is ready. What it receives wakes a chat of its own.`);
    void this.router.navigate(['/ai/webhooks', made.webhook_id]);
  }

  async edit(webhook: Webhook): Promise<void> {
    const changed = await this.openWebhook({ webhook });
    if (changed) {
      this.take(changed);
      this.flash(`${changed.name} saved.`);
    }
  }

  async setEnabled(webhook: Webhook, enabled: boolean): Promise<void> {
    this.busyId = webhook.webhook_id;
    const result = await this.service.update(webhook.webhook_id, { enabled });
    this.busyId = '';
    if (result.error || !result.webhook) return this.fail(result.error || 'That could not be saved.');
    this.take(result.webhook);
    this.flash(enabled ? `${webhook.name} is on.` : `${webhook.name} is off. Calls to it are refused.`);
  }

  async sendTest(webhook: Webhook): Promise<void> {
    const ref = this.dialog.open<WebhookTestDialogComponent, Webhook, boolean>(
      WebhookTestDialogComponent, { ...WIDE, data: webhook });
    const sent = await firstValueFrom(ref.afterClosed());
    if (sent === undefined) return;
    this.flash(sent ? 'Test sent to its chat. What the chat does with it shows there.'
      : 'Test written in its chat. No runtime took it now: it is read when the chat next runs.');
  }

  async rotate(webhook: Webhook): Promise<void> {
    const sure = await this.confirm.ask({
      title: `Replace the secret of ${webhook.name}?`,
      body: 'The old secret stops working at once. Whatever sends to this webhook needs the new one.',
      confirm: 'Replace',
      danger: true,
    });
    if (!sure) return;
    this.busyId = webhook.webhook_id;
    const result = await this.service.rotate(webhook.webhook_id);
    this.busyId = '';
    if (result.error || !result.secret) return this.fail(result.error || 'The secret could not be replaced.');
    await this.openWebhook({ webhook, secret: result.secret });
  }

  async remove(webhook: Webhook): Promise<void> {
    const sure = await this.confirm.ask({
      title: `Delete ${webhook.name}?`,
      body: 'Calls to it are refused from now on. Its chat is archived, with everything it heard.',
      confirm: 'Delete',
      danger: true,
    });
    if (!sure) return;
    this.busyId = webhook.webhook_id;
    const result = await this.service.remove(webhook.webhook_id);
    this.busyId = '';
    if (result.error) return this.fail(result.error);
    if (this.openId === webhook.webhook_id) this.closeOpened();
    this.webhooks = this.webhooks.filter((one) => one.webhook_id !== webhook.webhook_id);
    this.flash(`${webhook.name} deleted. Its chat is in your archived chats.`);
  }

  // ── Handing over, and taking one handed over ────────────────────────

  async handOver(person: Candidate): Promise<void> {
    const webhook = this.handing;
    if (!webhook) return;
    this.transferring = true;
    const result = await this.service.transfer(webhook.webhook_id, person.user_id);
    this.transferring = false;
    // Closed either way: a refusal is said on the page, where it can be read.
    this.handing = null;
    if (result.error) return this.fail(result.error);
    await this.reload();
    this.flash(`Offered to ${person.name || person.email}. It is theirs, with its chat, once they accept.`);
  }

  /** Take back a hand-over not yet accepted. */
  async withdraw(webhook: Webhook): Promise<void> {
    this.busyId = webhook.webhook_id;
    const result = await this.service.withdraw(webhook.webhook_id);
    this.busyId = '';
    if (result.error || !result.webhook) return this.fail(result.error || 'The hand-over was not withdrawn.');
    this.take(result.webhook);
    this.flash(`${webhook.name} is no longer being handed over.`);
  }

  async accept(webhook: Webhook, accept: boolean): Promise<void> {
    this.busyId = webhook.webhook_id;
    const result = await this.service.accept(webhook.webhook_id, accept);
    this.busyId = '';
    if (result.error) return this.fail(result.error);
    await this.reload();
    this.flash(accept ? `${webhook.name} is yours now, with its chat.` : `${webhook.name} declined.`);
  }

  // ── Sharing: to watch, never to change ──────────────────────────────

  openShare(webhook: Webhook): void {
    this.shareProblem = '';
    this.share.open(webhook.webhook_id, webhook.viewers);
  }

  async saveShare(): Promise<void> {
    this.share.saving = true;
    this.shareProblem = '';
    try {
      // The owner map names its owner; the viewers are everyone else.
      const owner = this.share.owner();
      const viewers = { groups: owner.groups, users: owner.users.filter((id) => id !== this.share.myUserId) };
      const result = await this.service.share(this.share.ref, viewers);
      if (result.error || !result.webhook) {
        this.shareProblem = result.error || 'Sharing could not be saved.';
        return;
      }
      this.take(result.webhook);
      this.share.close();
      this.flash('Sharing updated.');
    } finally {
      this.share.saving = false;
    }
  }
}
