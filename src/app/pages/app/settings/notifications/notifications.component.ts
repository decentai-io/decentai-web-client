import { Component, OnDestroy, OnInit } from '@angular/core';
import { Refused } from 'src/app/services/request.service';
import { SwPush } from '@angular/service-worker';
import { Subscription } from 'rxjs';

import { NotificationSettings, NotificationsService } from 'src/app/services/notifications.service';

/** How long "Saved" shows beside a switch that saves itself. */
const NOTE_FOR_MS = 2000;

/**
 * Settings › Notifications: where a person hears that a chat needs them
 * after they closed it. This device (web push, turned on and off here),
 * an email when no device can be reached, and a test. Nothing here is a
 * form: each control acts as it is used and says what happened beside
 * itself.
 */
@Component({
  selector: 'app-notifications',
  standalone: false,
  templateUrl: './notifications.component.html',
  styleUrls: ['./notifications.component.css'],
})
export class NotificationsComponent implements OnInit, OnDestroy {
  loading = true;
  loadError = '';
  settings: NotificationSettings | null = null;
  /** This browser's own subscription, when it has one. */
  thisDevice: PushSubscription | null = null;
  busy = false;

  /** What went wrong turning this device on or off. */
  deviceError = '';
  /** "Saved", or why not, beside the email switch. */
  emailNote = '';
  emailError = '';
  /** "Saved", or why not, beside the text switch. */
  textNote = '';
  textError = '';
  /** What the test reached, or why it could not be sent. */
  testResult = '';

  private subscription?: Subscription;

  constructor(
    private notifications: NotificationsService,
    private swPush: SwPush,
  ) {}

  ngOnInit(): Promise<void> {
    return this.load();
  }

  ngOnDestroy(): void {
    this.subscription?.unsubscribe();
  }

  async load(): Promise<void> {
    this.loading = true;
    this.loadError = '';
    try {
      this.settings = await this.notifications.get();
      if (this.pushSupported && !this.subscription) {
        this.subscription = this.swPush.subscription.subscribe((own) => (this.thisDevice = own));
      }
    } catch (failed) {
      this.loadError = Refused.words(failed);
    } finally {
      this.loading = false;
    }
  }

  // ── This device ─────────────────────────────────────────────────────

  /** Whether the deployment pushes at all: it has a key for it. */
  get pushConfigured(): boolean {
    return !!this.settings?.push_key;
  }

  /** Push needs the service worker, which runs only in a built app,
   *  and a browser that offers the API. */
  get pushSupported(): boolean {
    return this.swPush.isEnabled && typeof Notification !== 'undefined';
  }

  get pushDenied(): boolean {
    return typeof Notification !== 'undefined' && Notification.permission === 'denied';
  }

  /** Where this device stands, in a line. */
  get deviceStatus(): string {
    if (!this.pushConfigured) return 'Not available on this deployment';
    if (!this.pushSupported) return 'Not available in this window';
    return this.thisDevice ? 'On here' : 'Not turned on here';
  }

  /** What a person can do about it, or how many devices there are. */
  get deviceHelp(): string {
    if (!this.pushConfigured) return 'An administrator adds the keys.';
    if (!this.pushSupported) return this.unsupportedReason;
    if (this.pushDenied) return 'Notifications are blocked for this site in the browser; allow them in the site settings.';
    if (!this.thisDevice && this.isBrave) return this.braveHint;
    const devices = this.settings?.devices ?? 0;
    return `${devices} device${devices === 1 ? '' : 's'} turned on in all.`;
  }

  /** Why this window cannot turn push on, said in the person's words:
   *  the reason decides what they do next, so it is never one sentence
   *  for every case. */
  private get unsupportedReason(): string {
    if (typeof Notification === 'undefined') {
      if (this.isIos) {
        return this.addedToHomeScreen
          ? 'This iPhone or iPad cannot show web notifications yet: update it to iOS 16.4 or later.'
          : 'On iPhone and iPad, add DecentAI to the Home Screen from Safari’s Share menu, open it from there, and turn notifications on there.';
      }
      return 'This browser does not offer web notifications. Chrome, Edge, Firefox and Brave do.';
    }
    return 'This window cannot receive push (a private window, or a development build). Open DecentAI in a normal window.';
  }

  /** Brave ships with its push service switched off, so the person is
   *  told before the click, not by the browser's error after it. */
  private readonly braveHint =
    'Brave turns its push service off by default: under Privacy and security, turn on “Use Google services for push messaging”, then restart Brave.';

  private get isIos(): boolean {
    return /iPhone|iPad|iPod/.test(navigator.userAgent)
      || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  }

  private get addedToHomeScreen(): boolean {
    return (window.matchMedia?.('(display-mode: standalone)').matches ?? false)
      || (navigator as { standalone?: boolean }).standalone === true;
  }

  private get isBrave(): boolean {
    return 'brave' in navigator;
  }

  /** Ask this browser for permission and keep its subscription. */
  async turnOnHere(): Promise<void> {
    if (!this.settings?.push_key || this.busy) return;
    this.busy = true;
    this.deviceError = '';
    try {
      const subscription = await this.swPush.requestSubscription({ serverPublicKey: this.settings.push_key });
      const result = await this.notifications.subscribe(subscription.toJSON());
      if (result.error) this.deviceError = result.error;
      else await this.recount();
    } catch (error: unknown) {
      const failure = error as { name?: string; message?: string };
      const message = String(failure?.message || error || '');
      if (this.pushDenied) {
        this.deviceError = 'Notifications are blocked for this site in the browser; allow them in the site settings and try again.';
      } else if (failure?.name === 'AbortError' || /push service/i.test(message)) {
        // The browser has no push service to register with: Brave's is
        // off until the person turns it on; elsewhere it is rare.
        this.deviceError = this.isBrave ? this.braveHint
          : 'This browser has no push service to register with.';
      } else {
        this.deviceError = `Could not turn this device on: ${message}`;
      }
    } finally {
      this.busy = false;
    }
  }

  async turnOffHere(): Promise<void> {
    if (!this.thisDevice || this.busy) return;
    this.busy = true;
    this.deviceError = '';
    try {
      const endpoint = this.thisDevice.endpoint;
      try {
        await this.swPush.unsubscribe();
      } catch {
        // The browser's side may already be gone.
      }
      const result = await this.notifications.unsubscribe(endpoint);
      if (result.error) this.deviceError = result.error;
      else await this.recount();
    } finally {
      this.busy = false;
    }
  }

  /** How many devices there are now, read again. */
  private async recount(): Promise<void> {
    this.settings = await this.notifications.get().catch(() => this.settings);
  }

  // ── Email, text, and the test ───────────────────────────────────────

  /** A wish not given is a yes. */
  get emailOn(): boolean {
    return this.settings?.wishes.email !== false;
  }

  get textOn(): boolean {
    return this.settings?.wishes.text !== false;
  }

  async setEmail(enabled: boolean): Promise<void> {
    this.emailError = await this.wish({ email: enabled });
    if (!this.emailError) this.saved((note) => (this.emailNote = note));
  }

  async setText(shown: boolean): Promise<void> {
    this.textError = await this.wish({ text: shown });
    if (!this.textError) this.saved((note) => (this.textNote = note));
  }

  /** One wish saved, and kept here; or why not. */
  private async wish(changes: { email?: boolean; text?: boolean }): Promise<string> {
    const result = await this.notifications.update(changes);
    if (result.error) return result.error;
    if (this.settings) this.settings = { ...this.settings, wishes: { ...this.settings.wishes, ...result.wishes } };
    return '';
  }

  private saved(show: (note: string) => void): void {
    show('Saved');
    setTimeout(() => show(''), NOTE_FOR_MS);
  }

  /** The help under the text switch. */
  get textHelp(): string {
    return this.textError || 'The chat and what is waiting or was said. Off, a notification says only that something '
      + 'happened: what reaches it passes through your browser’s push service or a mail server. Your organization may '
      + 'hide it for everyone.';
  }

  /** The help under the email switch, or why it is not offered. */
  get emailHelp(): string {
    if (this.emailError) return this.emailError;
    return this.settings?.email
      ? 'Sent to your address when none of your devices is turned on.'
      : 'Email is not set up on this deployment.';
  }

  async sendTest(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    this.testResult = '';
    try {
      const result = await this.notifications.test();
      const devices = this.settings?.devices ?? 0;
      this.testResult = result.error
        || (devices ? `Sent to ${devices} device${devices === 1 ? '' : 's'}.`
          : 'No device is turned on: a test goes to devices only.');
    } finally {
      this.busy = false;
    }
  }
}
