import { Injectable } from '@angular/core';

import { Person } from './auth.service';
import { Failure, Refused, RequestService } from './request.service';

/** One of the organization's people. */
export type Member = Person;

/** An invitation nobody has accepted yet. Its id is the start of the
 *  link's hash: the link itself was mailed, and is never shown again. */
export interface Invitation {
  invitation_id: string;
  email: string;
  groups: string[];
  expires_at: string;
}

/** What removing a person touches, kind by kind. */
export interface Leaving {
  chats: number;
  schedules: number;
  records_handed_on: number;
  secrets_deleted: number;
  skills: number;
  mcp_servers: number;
  webhooks: number;
}

/**
 * Client for the organization's people (IAM:User), who has been invited
 * (IAM:Invitation), and the administrator's stop of everything of a
 * person (AI:Switch:stop_person).
 *
 * A person's access is exactly their groups; Everyone holds them without
 * being listed. Where the deployment sends mail, people join by
 * invitation; where it sends none, an administrator adds them with a
 * temporary password.
 */
@Injectable({ providedIn: 'root' })
export class MembersService {
  constructor(private request: RequestService) {}

  // ── People ──────────────────────────────────────────────────────────
  async list(): Promise<Member[]> {
    const r = await this.request.gateway('IAM:User:list');
    if (r.error) throw new Refused(r.error);  // the page says why, a picker falls back
    return Array.isArray(r.users) ? r.users : [];
  }

  setGroups(userId: string, groupIds: string[]) {
    return this.request.gateway<{ user: Member }>('IAM:User:set_groups', { user_id: userId, groups: groupIds });
  }

  /** Add a person where no invitation can be sent. The answer carries a
   *  temporary password, shown once. */
  create(email: string, name: string, groupIds: string[]) {
    return this.request.gateway<{ user: Member; password: string }>('IAM:User:create', {
      email, name, groups: groupIds,
    });
  }

  /** A mailed reset link, or, where no mail is set up, a temporary
   *  password shown once. */
  resetPassword(userId: string) {
    return this.request.gateway<{ mailed?: boolean; password?: string }>('IAM:User:reset_password', { user_id: userId });
  }

  setStatus(userId: string, status: 'active' | 'disabled') {
    return this.request.gateway<{ user: Member }>('IAM:User:set_status', { user_id: userId, status });
  }

  /** What removing this person would delete and hand on. */
  async leaving(userId: string): Promise<{ counts?: Leaving } & Failure> {
    return this.request.gateway('IAM:User:leaving', { user_id: userId });
  }

  /** Remove a person; what they shared, their data and files pass to
   *  the successor, the caller when none is named. */
  remove(userId: string, successorId = ''): Promise<Failure> {
    return this.request.gateway('IAM:User:delete', {
      user_id: userId, ...(successorId ? { successor_id: successorId } : {}),
    });
  }

  /** Stop everything of a person, every chat and schedule, or let them
   *  resume. */
  setStopped(userId: string, stop: boolean): Promise<Failure> {
    return this.request.gateway('AI:Switch:stop_person', { user_id: userId, stop });
  }

  // ── Invitations ─────────────────────────────────────────────────────
  async invitations(): Promise<Invitation[]> {
    const r = await this.request.gateway('IAM:Invitation:list');
    if (r.error) throw new Refused(r.error);
    return Array.isArray(r.invitations) ? r.invitations : [];
  }

  invite(email: string, groupIds: string[]) {
    return this.request.gateway<{ email: string }>('IAM:Invitation:create', { email, groups: groupIds });
  }

  revoke(invitationId: string): Promise<Failure> {
    return this.request.gateway('IAM:Invitation:revoke', { invitation_id: invitationId });
  }
}
