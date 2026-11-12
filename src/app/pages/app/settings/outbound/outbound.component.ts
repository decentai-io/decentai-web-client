import { Component, OnInit } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { firstValueFrom } from 'rxjs';

import { AuthService } from 'src/app/services/auth.service';
import { ConfirmService } from 'src/app/services/confirm.service';
import {
  OutboundAddress, OutboundFormat, OutboundService, eventName, formatName,
} from 'src/app/services/outbound.service';
import { DataPageBase } from '../../data-page-base';
import { DeliveriesDialogComponent, DeliveriesDialogData } from './deliveries-dialog.component';
import { OutboundDialogComponent, OutboundDialogData } from './outbound-dialog.component';

/** How wide the dialogs open. */
const WIDE = { width: '640px', maxWidth: '100vw' };

/**
 * Settings › Notifications out: addresses the platform posts to when
 * something happens that the person would want to know — a line and a
 * link, and the reply's text only where they asked for it.
 *
 * Webhooks in, which other services post to, have their own page under
 * AI › Webhooks.
 */
@Component({
  selector: 'app-outbound',
  standalone: false,
  templateUrl: './outbound.component.html',
  styleUrl: './outbound.component.css',
})
export class OutboundComponent extends DataPageBase implements OnInit {
  loading = true;
  /** Why the addresses could not be read. */
  loadError = '';
  addresses: OutboundAddress[] = [];
  events: string[] = [];
  formats: OutboundFormat[] = [];
  readonly limit = OutboundService.MOST;

  /** The row an action is on its way for. */
  busy = '';

  constructor(
    private service: OutboundService,
    public auth: AuthService,
    private dialog: MatDialog,
    private confirm: ConfirmService,
  ) {
    super();
  }

  ngOnInit(): Promise<void> {
    return this.load();
  }

  async load(): Promise<void> {
    this.loading = true;
    this.loadError = '';
    const page = await this.service.list();
    this.loadError = page.error ?? '';
    this.addresses = page.addresses;
    this.events = page.events;
    this.formats = page.formats;
    this.loading = false;
  }

  // ── What the person may do ──────────────────────────────────────────

  get mayCreate(): boolean { return this.auth.can('settings:outbound:create'); }
  get mayUpdate(): boolean { return this.auth.can('settings:outbound:update'); }
  get mayDelete(): boolean { return this.auth.can('settings:outbound:delete'); }
  get mayTest(): boolean { return this.auth.can('settings:outbound:test'); }
  get mayReadSends(): boolean { return this.auth.can('settings:outbound:deliveries'); }
  get mayListWebhooks(): boolean { return this.auth.can('settings:webhook:list'); }

  get atLimit(): boolean { return this.addresses.length >= this.limit; }

  /** How many are paused: by hand, or after failing twenty times. */
  get pausedCount(): number { return this.addresses.filter((one) => one.paused).length; }

  get foot(): string {
    return this.addresses.length ? `${this.addresses.length} of ${this.limit}` : '';
  }

  // ── Changing them ───────────────────────────────────────────────────

  private take(address: OutboundAddress): void {
    const known = this.addresses.some((one) => one.id === address.id);
    this.addresses = known
      ? this.addresses.map((one) => one.id === address.id ? address : one)
      : [...this.addresses, address];
  }

  private async open(address?: OutboundAddress): Promise<OutboundAddress | null> {
    const ref = this.dialog.open<OutboundDialogComponent, OutboundDialogData, OutboundAddress | null>(
      OutboundDialogComponent,
      { ...WIDE, data: { address, events: this.events, formats: this.formats } });
    return (await firstValueFrom(ref.afterClosed())) ?? null;
  }

  async create(): Promise<void> {
    const made = await this.open();
    if (made) {
      this.take(made);
      this.flash(`${made.name || made.url} is ready. Send a test to see it arrive.`);
    }
  }

  async edit(address: OutboundAddress): Promise<void> {
    const changed = await this.open(address);
    if (changed) {
      this.take(changed);
      this.flash(`${changed.name || changed.url} saved.`);
    }
  }

  /** Turning one on also lifts a pause the platform put on it. */
  async setOn(address: OutboundAddress, on: boolean): Promise<void> {
    this.busy = address.id;
    const result = await this.service.update(address.id, { paused: !on });
    this.busy = '';
    if (result.error || !result.address) return this.fail(result.error || 'That could not be saved.');
    this.take(result.address);
    this.flash(on ? `${this.named(address)} is on.` : `${this.named(address)} is paused. Nothing is sent to it.`);
  }

  async test(address: OutboundAddress): Promise<void> {
    this.busy = address.id;
    const result = await this.service.test(address.id);
    this.busy = '';
    if (result.error) return this.fail(result.error);
    this.flash(`A test is on its way to ${this.named(address)}: its deliveries say how it went.`);
  }

  async remove(address: OutboundAddress): Promise<void> {
    const sure = await this.confirm.ask({
      title: `Delete ${this.named(address)}?`,
      body: 'Nothing more is sent to its address.',
      confirm: 'Delete',
      danger: true,
    });
    if (!sure) return;
    this.busy = address.id;
    const result = await this.service.remove(address.id);
    this.busy = '';
    if (result.error) return this.fail(result.error);
    this.addresses = this.addresses.filter((one) => one.id !== address.id);
    this.flash(`${this.named(address)} deleted.`);
  }

  deliveries(address: OutboundAddress): void {
    this.dialog.open<DeliveriesDialogComponent, DeliveriesDialogData>(
      DeliveriesDialogComponent,
      { ...WIDE, data: { id: address.id, name: this.named(address) } });
  }

  // ── Words ───────────────────────────────────────────────────────────

  /** Its name, or its address where it has none. */
  named(address: OutboundAddress): string {
    return address.name || address.url;
  }

  formatName(format: string): string {
    return formatName(format);
  }

  eventsWord(address: OutboundAddress): string {
    const events = address.events || [];
    if (events.length === 1) return eventName(events[0]);
    return `${events.length} events`;
  }

  eventsInFull(address: OutboundAddress): string {
    return (address.events || []).map(eventName).join(', ');
  }
}
