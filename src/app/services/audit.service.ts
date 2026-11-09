import { Injectable } from '@angular/core';

import { Failure, RequestService } from './request.service';

/** One line of the audit trail (`Trail.public`): when, who, in which
 *  chat, what — an endpoint's action, or an event such as `chat.call` —
 *  the ids it touched, how it ended and why. Never a secret's value or a
 *  body. */
export interface TrailLine {
  line_id: string;
  at: string;
  /** A person's email, `runtime <id>`, or an address nobody knows. */
  who: string;
  kind: 'person' | 'runtime' | 'webhook' | 'anyone' | string;
  chat_id: string;
  what: string;
  outcome: 'success' | 'refused' | 'failed' | string;
  ids: string[];
  reason: string;
  details: Record<string, unknown>;
}

/** A page of lines, newest first: `before` is the last line's id, to ask
 *  for the page after it. */
export interface TrailPage {
  lines: TrailLine[];
  before: string;
}

/** What the API server narrows the trail to: one chat's lines, what was
 *  done (an action, or its start such as `ai:chat`), and how it ended. */
export interface TrailFilters {
  chat_id?: string;
  what?: string;
  outcome?: '' | 'success' | 'refused' | 'failed';
}

/** Client for AI:Audit: the person's own lines of the trail, and, a grant
 *  of its own, the organization's. */
@Injectable({ providedIn: 'root' })
export class AuditService {
  /** The most a page holds. */
  static readonly PAGE = 100;

  constructor(private request: RequestService) {}

  /** The person's own lines. */
  mine(before = '', filters: TrailFilters = {}): Promise<TrailPage & Failure> {
    return this.page('AI:Audit:list', { before, ...filters });
  }

  /** The organization's lines, or one person's of them. */
  all(before = '', filters: TrailFilters & { user_id?: string } = {}): Promise<TrailPage & Failure> {
    return this.page('AI:Audit:list_all', { before, ...filters });
  }

  private async page(endpoint: string, data: Record<string, string | undefined>): Promise<TrailPage & Failure> {
    // A filter left empty is no filter: only those given are sent.
    const given = Object.fromEntries(Object.entries(data).filter(([, value]) => value));
    const r = await this.request.gateway(endpoint, { ...given, limit: AuditService.PAGE });
    return trailPage(r.lines ?? [], r.error);
  }
}

/** A page as read: where the next one starts, when this one was full. */
export function trailPage(lines: TrailLine[], error?: string): TrailPage & Failure {
  const full = lines.length >= AuditService.PAGE;
  return { lines, before: full ? lines[lines.length - 1].line_id : '', ...(error ? { error } : {}) };
}
