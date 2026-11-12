import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';

import { Failure, RequestService } from './request.service';

/** One model connection (`Models.public`): a provider, its address, the
 *  models it offers, and the groups it is shared with. Its key is never
 *  shown again; `key` says only whether one is kept. */
export interface LlmConnection {
  connection_id: string;
  name: string;
  provider: string;
  address: string;
  models: string[];
  groups: string[];
  key: boolean;
  /** The organization's default: what a chat that chose none uses. */
  default: boolean;
}

/** One provider a connection may name, from the platform's catalog. */
export interface LlmProvider {
  id: string;
  name: string;
  protocol: string;
  /** Where the provider answers. A `<blank>` in it is the customer's own
   *  part (an account, a region); the custom entry's is empty. */
  endpoint: string;
  /** Set on the few most people look for: its place among them, from 1. */
  popular?: number;
}

/** A model the catalog knows a provider to offer. */
export interface LlmModel {
  id: string;
  name: string;
}

/** What a connection is made or changed with. A key left out keeps the
 *  one kept; a new address needs the key again. */
export interface LlmConnectionDraft {
  name?: string;
  provider?: string;
  address?: string;
  models?: string[];
  groups?: string[];
  key?: string;
}

/** What a runtime said when asked to check a connection. */
export interface LlmCheck {
  ok: boolean;
  models: string[];
  error: string;
}

/** Client for Settings:Llm: the organization's model connections, shared
 *  with groups, one of them the default. */
@Injectable({ providedIn: 'root' })
export class SettingsLlmService {
  /** How many connections this person may use, as last listed; null
   *  until the first listing. The Settings nav shows it. */
  readonly count$ = new BehaviorSubject<number | null>(null);

  constructor(private request: RequestService) {}

  /** The connections this person may use; with `all`, for an
   *  administrator, every connection of the organization. */
  async list(all = false): Promise<LlmConnection[]> {
    const r = await this.request.gateway('Settings:Llm:list', all ? { all: true } : {});
    const connections: LlmConnection[] = Array.isArray(r.connections) ? r.connections : [];
    if (!all) this.count$.next(connections.length);
    return connections;
  }

  async providers(): Promise<LlmProvider[]> {
    const r = await this.request.gateway('Settings:Llm:providers');
    return Array.isArray(r.providers) ? r.providers : [];
  }

  /** The chat models the catalog knows a provider to offer, newest first;
   *  none for a provider it says nothing of. */
  async models(provider: string): Promise<LlmModel[]> {
    const r = await this.request.gateway('Settings:Llm:providers', { provider });
    return Array.isArray(r.models) ? r.models : [];
  }

  /** Ask a runtime to reach a connection and list its models: one saved,
   *  as it is or with the changes given, or one not saved yet, from its
   *  fields alone. A changed address needs the key. */
  async check(draft: LlmConnectionDraft, connectionId = ''): Promise<LlmCheck & Failure> {
    return this.request.gateway('Settings:Llm:models', { ...(connectionId ? { connection_id: connectionId } : {}), ...draft });
  }

  create(draft: LlmConnectionDraft): Promise<{ connection?: LlmConnection } & Failure> {
    return this.request.gateway('Settings:Llm:create', draft);
  }

  update(connectionId: string, draft: LlmConnectionDraft): Promise<{ connection?: LlmConnection } & Failure> {
    return this.request.gateway('Settings:Llm:update', { connection_id: connectionId, ...draft });
  }

  setDefault(connectionId: string): Promise<{ connection?: LlmConnection } & Failure> {
    return this.request.gateway('Settings:Llm:setdefault', { connection_id: connectionId });
  }

  remove(connectionId: string): Promise<Failure> {
    return this.request.gateway('Settings:Llm:delete', { connection_id: connectionId });
  }
}
