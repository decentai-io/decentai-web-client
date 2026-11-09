import { Component, OnInit } from '@angular/core';
import { Refused } from 'src/app/services/request.service';

import { Draft } from 'src/app/components/ui/draft';
import { Choice } from 'src/app/components/ui/radio-keys';
import { HasUnsavedChanges } from 'src/app/guards/unsaved-changes.guard';
import { AuthService } from 'src/app/services/auth.service';
import { OrgSettings, SettingsOrgService } from 'src/app/services/settings-org.service';

/** The organization's settings this page edits. */
type Safety = Pick<OrgSettings, 'blocked_hosts' | 'guardrail' | 'mcp' | 'webhooks' | 'webhook_trust' | 'notification_text'>;

/** The platform's own start, before anything is read. */
const STANDARD: Safety = {
  blocked_hosts: [], guardrail: '', mcp: 'allowed', webhooks: 'allowed', webhook_trust: 1, notification_text: 'shown',
};

/**
 * Settings › Safety: the sites no agent may reach, the organization's own
 * rules for the assistant, and what may reach in or out of the
 * organization: MCP servers, webhooks and what a notification says.
 *
 * All of it is the organization's settings (Settings:Organization), read
 * and changed by an administrator: one form, saved with the save bar.
 */
@Component({
  selector: 'app-safety',
  standalone: false,
  templateUrl: './safety.component.html',
  styleUrl: './safety.component.css',
})
export class SafetyComponent implements OnInit, HasUnsavedChanges {
  loading = true;
  loadError = '';
  saving = false;
  saveError = '';

  readonly draft = new Draft<Safety>(STANDARD);
  /** How long the rules may be. */
  readonly rulesLimit = 4000;

  readonly mcp: Choice<Safety['mcp']>[] = [
    { value: 'allowed', name: 'People may add' },
    { value: 'blocked', name: 'Nobody may' },
  ];

  readonly webhooks: Choice<Safety['webhooks']>[] = [
    { value: 'allowed', name: 'Allowed' },
    { value: 'blocked', name: 'Nobody may' },
  ];

  readonly trust: Choice<Safety['webhook_trust']>[] = [
    { value: 0, name: '0', hint: 'Only reads.' },
    { value: 1, name: '1', hint: 'Changes the person’s own records.' },
    { value: 2, name: '2', hint: 'Wider changes.' },
    { value: 3, name: '3', hint: 'Acts outside the platform.' },
  ];

  readonly notificationText: Choice<Safety['notification_text']>[] = [
    { value: 'shown', name: 'Say what happened' },
    { value: 'hidden', name: 'Only that something did' },
  ];

  constructor(
    private service: SettingsOrgService,
    public auth: AuthService,
  ) {}

  get canEdit(): boolean { return this.auth.can('settings:organization:update'); }

  get dirty(): boolean {
    return this.canEdit && this.draft.dirty;
  }

  /** The counter under the rules turns to a warning in the last tenth. */
  get rulesNearLimit(): boolean {
    return this.draft.value.guardrail.length > this.rulesLimit * 0.9;
  }

  /** What the MCP choice means, in one line. */
  get mcpMeaning(): string {
    return this.draft.value.mcp === 'allowed'
      ? 'Each person adds remote servers for their own chats, and decides which tools are on.'
      : 'Nobody can add one. Those already added are kept.';
  }

  /** What the webhooks choice means, in one line. */
  get webhooksMeaning(): string {
    return this.draft.value.webhooks === 'allowed'
      ? 'People make addresses other services post events to, each heard in a chat of their own; and their notifications may go to addresses outside.'
      : 'No webhook takes an event: each answers as if it did not exist, and no notification goes to an address outside. Those already made are kept.';
  }

  /** What the notification choice means, in one line. */
  get notificationTextMeaning(): string {
    return this.draft.value.notification_text === 'shown'
      ? 'A notification names the chat and what is waiting or was said; each person may still hide it for their own.'
      : 'Every notification says only that something is waiting, with a link to the chat.';
  }

  ngOnInit(): Promise<void> {
    return this.load();
  }

  async load(): Promise<void> {
    this.loading = true;
    this.loadError = '';
    try {
      this.take(await this.service.get());
    } catch (failed) {
      this.loadError = Refused.words(failed);
    } finally {
      this.loading = false;
    }
  }

  /** A site as a person types it: a whole address is read for its name,
   *  since that is what they will have copied. `*.example.com` stays: it
   *  blocks every name under example.com. */
  readonly siteName = (typed: string): string => {
    let name = typed.toLowerCase();
    name = name.replace(/^[a-z]+:\/\//, '').split(/[/?#]/)[0].split('@').pop() || '';
    return name.replace(/:\d+$/, '').replace(/\.$/, '');
  };

  private take(settings: OrgSettings): void {
    const { blocked_hosts, guardrail, mcp, webhooks, webhook_trust, notification_text } = settings;
    this.draft.take({ blocked_hosts, guardrail, mcp, webhooks, webhook_trust, notification_text });
  }

  async save(): Promise<void> {
    if (this.saving || !this.dirty) return;
    this.saving = true;
    this.saveError = '';
    try {
      const result = await this.service.update(this.draft.value);
      if (result.error || !result.settings) {
        this.saveError = result.error || 'The settings could not be saved.';
        return;
      }
      this.take(result.settings);
    } finally {
      this.saving = false;
    }
  }

  discard(): void {
    this.draft.discard();
    this.saveError = '';
  }

  unsavedChangesTo(): string {
    return this.dirty ? 'Safety' : '';
  }
}
