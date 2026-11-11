import { Injectable } from '@angular/core';

import { Failure, Refused, RequestService } from './request.service';

/** The organization's settings: one table, changed by its administrators
 *  (Settings:Organization). */
export interface OrgSettings {
  /** Hosts no agent may reach, whatever its manifest declares. */
  blocked_hosts: string[];
  /** The organization's own rules, added to every chat's instructions. */
  guardrail: string;
  /** Where its chats may run. */
  runtimes: 'prefer_own' | 'own_only';
  /** Whether people may add MCP servers. */
  mcp: 'allowed' | 'blocked';
  /** Whether webhooks may wake chats, and notifications go outside. */
  webhooks: 'allowed' | 'blocked';
  /** `hidden`: every notification says only that something happened. */
  notification_text: 'shown' | 'hidden';
  /** What writes speech down and says replies aloud. */
  speech: 'none' | 'service' | 'model';
  /** For `model` speech: the connection, and its models and voice. */
  speech_connection: string;
  transcription_model: string;
  speech_model: string;
  speech_voice: string;
  /** The default model connection. */
  model: string;
}

@Injectable({ providedIn: 'root' })
export class SettingsOrgService {
  constructor(private request: RequestService) {}

  /** The settings; a refusal is thrown, as a `Refused`. */
  async get(): Promise<OrgSettings> {
    const r = await this.request.gateway('Settings:Organization:get');
    if (r.error) throw new Refused(r.error);
    return r.settings;
  }

  /** Change some settings; the answer is all of them as they now are. */
  update(changes: Partial<OrgSettings>): Promise<{ settings?: OrgSettings } & Failure> {
    return this.request.gateway('Settings:Organization:update', { settings: changes });
  }
}
