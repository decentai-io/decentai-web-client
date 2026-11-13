import { Injectable } from '@angular/core';

import { Failure, RequestService } from './request.service';

/** The JSON Schema a webhook's body is checked against. */
export interface WebhookSchema {
  type?: string;
  properties?: Record<string, { type?: string; format?: string; description?: string }>;
  required?: string[];
  additionalProperties?: boolean;
  [key: string]: unknown;
}

/** A webhook, never with its secret. Its owner sees its chat and its
 *  settings; someone it was shared with (`role: 'viewer'`) or is being
 *  handed to (`role: 'handed'`) sees what it is, whose it is, and what
 *  it received. */
export interface Webhook {
  webhook_id: string;
  name: string;
  /** '/hooks/<id>', on the API server's own address. */
  path: string;
  instruction: string;
  fields: WebhookSchema;
  enabled: boolean;
  /** The owner's only. */
  chat_id?: string;
  trust?: number;
  viewers?: { users: string[]; groups: string[] };
  require_signature?: boolean;
  /** The owner's only: whom it is being handed to, until they accept. */
  handing?: { to: string; by: string } | null;
  /** A row that is not the person's own says what it is to them. */
  role?: 'viewer' | 'handed';
  /** Whose it is, on a row that is not the person's own. */
  owner?: { user_id: string; name: string };
}

/** What making and changing a webhook sends. */
export interface WebhookDraft {
  name?: string;
  instruction?: string;
  fields?: WebhookSchema;
  trust?: number;
  require_signature?: boolean;
  enabled?: boolean;
}

/** One call that arrived, accepted or refused at the door, or a test the
 *  owner sent. Kept 30 days. */
export interface WebhookExecution {
  _id: string;
  at: string;
  outcome: 'accepted' | 'refused' | 'test';
  /** The HTTP status the caller was answered. */
  status: number;
  reason: string;
}

/**
 * Client for Settings:Webhook: a person's own webhooks, each waking a
 * chat of theirs, those shared with them, to watch, and those handed to
 * them, to accept. A secret is in the open only in the answer that made it.
 */
@Injectable({ providedIn: 'root' })
export class WebhooksService {
  constructor(private request: RequestService) {}

  async list(): Promise<{ webhooks: Webhook[]; shared: Webhook[]; handed: Webhook[]; limit: number } & Failure> {
    const r = await this.request.gateway('Settings:Webhook:list');
    return {
      webhooks: r.webhooks ?? [], shared: r.shared ?? [], handed: r.handed ?? [], limit: Number(r.limit) || 0,
      error: r.error,
    };
  }

  /** What arrived, newest first, a page at a time. */
  async executions(webhookId: string, before = '', limit = 25): Promise<{ executions: WebhookExecution[] } & Failure> {
    const r = await this.request.gateway('Settings:Webhook:executions', {
      webhook_id: webhookId, limit, ...(before ? { before } : {}),
    });
    return { executions: r.executions ?? [], error: r.error };
  }

  /** Make one; the answer carries its secret, this once. */
  create(draft: WebhookDraft) {
    return this.request.gateway<{ webhook: Webhook; secret: string }>('Settings:Webhook:create', draft);
  }

  update(webhookId: string, changes: WebhookDraft) {
    return this.request.gateway<{ webhook: Webhook }>('Settings:Webhook:update', { webhook_id: webhookId, ...changes });
  }

  /** A new secret, shown once; the old one stops working. */
  rotate(webhookId: string) {
    return this.request.gateway<{ secret: string }>('Settings:Webhook:rotate', { webhook_id: webhookId });
  }

  /** Who else sees it and what it received. */
  share(webhookId: string, viewers: { users: string[]; groups: string[] }) {
    return this.request.gateway<{ webhook: Webhook }>('Settings:Webhook:share', { webhook_id: webhookId, viewers });
  }

  /** Wake its chat with a body, as a caller would; `sent` says whether a
   *  runtime took it now. */
  test(webhookId: string, data: unknown) {
    return this.request.gateway<{ sent: boolean }>('Settings:Webhook:test', { webhook_id: webhookId, data });
  }

  /** Hand it, with its chat, to another member, who accepts it. */
  transfer(webhookId: string, userId: string): Promise<Failure> {
    return this.request.gateway('Settings:Webhook:transfer', { webhook_id: webhookId, user_id: userId });
  }

  /** Take back a hand-over not yet accepted. */
  withdraw(webhookId: string) {
    return this.request.gateway<{ webhook: Webhook }>('Settings:Webhook:withdraw', { webhook_id: webhookId });
  }

  /** Take one handed to the person, with its chat, or decline it. */
  accept(webhookId: string, accept: boolean): Promise<Failure> {
    return this.request.gateway('Settings:Webhook:accept', { webhook_id: webhookId, accept });
  }

  /** Delete it; its chat is archived, with everything it heard. */
  remove(webhookId: string): Promise<Failure> {
    return this.request.gateway('Settings:Webhook:delete', { webhook_id: webhookId });
  }
}
