import { Injectable } from '@angular/core';

import { Failure, RequestService } from './request.service';

/** What a skill or an MCP server has of its own beside its content: whom
 *  it belongs to, who made it, and whether it is being handed on. */
export interface Shared {
  id: string;
  owner: { users: string[]; groups: string[] };
  created_by: string;
  /** Handed to another member, who has not yet accepted it. */
  handing: { to: string; by: string } | null;
  /** When it was made, and last changed. */
  at?: string;
  updated_at?: string;
}

/** A skill: knowledge the assistant reads when it needs it, written by
 *  the person or saved from a card. */
export interface Skill extends Shared {
  name: string;
  description: string;
  text: string;
}

/** The most a list of skills or MCP servers answers with at once. */
export const SHARED_PAGE = 100;

/**
 * Every one the person may see, a page at a time until the last: the
 * API server gives at most a hundred at once, after the last id given,
 * and those handed to the person with every page. A refusal ends the
 * reading with what was read.
 */
export async function readShared<T extends Shared>(
  request: RequestService, endpoint: string,
): Promise<{ items: T[]; handed: T[] } & Failure> {
  const items: T[] = [];
  let handed: T[] = [];
  let after = '';
  do {
    const r = await request.gateway<{ items: T[]; handed: T[] }>(endpoint, { limit: SHARED_PAGE, ...(after ? { after } : {}) });
    if (r.error) return { items, handed, error: r.error };
    const page = r.items ?? [];
    items.push(...page);
    handed = r.handed ?? [];
    after = page.length === SHARED_PAGE ? page[page.length - 1].id : '';
  } while (after);
  return { items, handed };
}

export interface SkillFields {
  name: string;
  description: string;
  text: string;
}

/**
 * Client for Skills:Skill: the person's skills and those shared with
 * them; shared with people and groups, and handed on only when accepted.
 */
@Injectable({ providedIn: 'root' })
export class SkillsService {
  constructor(private request: RequestService) {}

  /** The skills the person may read, and those handed to them. */
  async list(): Promise<{ items: Skill[]; handed: Skill[] } & Failure> {
    return readShared<Skill>(this.request, 'Skills:Skill:list');
  }

  async get(id: string): Promise<Skill | null> {
    const r = await this.request.gateway('Skills:Skill:get', { id });
    return r.item ?? null;
  }

  create(fields: SkillFields) {
    return this.request.gateway<{ item: Skill }>('Skills:Skill:create', fields);
  }

  update(id: string, fields: SkillFields) {
    return this.request.gateway<{ item: Skill }>('Skills:Skill:update', { id, ...fields });
  }

  share(id: string, owner: { users: string[]; groups: string[] }) {
    return this.request.gateway<{ item: Skill }>('Skills:Skill:share', { id, owner });
  }

  transfer(id: string, userId: string) {
    return this.request.gateway<object>('Skills:Skill:transfer', { id, user_id: userId });
  }

  /** Take back a hand-over not yet accepted. */
  withdraw(id: string) {
    return this.request.gateway<object>('Skills:Skill:withdraw', { id });
  }

  accept(id: string, accept: boolean) {
    return this.request.gateway<object>('Skills:Skill:accept', { id, accept });
  }

  remove(id: string) {
    return this.request.gateway<object>('Skills:Skill:delete', { id });
  }
}
