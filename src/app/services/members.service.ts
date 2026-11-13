import { Injectable } from '@angular/core';

import { nextOf, pageAsk, ServerPage } from '../components/ui/paging';
import { Person } from './auth.service';
import { Failure, RequestService } from './request.service';

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

/** A group as a list names it: enough to name it on a row, and to say
 *  whether it is Everyone or Administrators. */
export interface GroupName {
  group_id: string;
  name: string;
  everyone: boolean;
  administrators: boolean;
}

/** The organization's people in numbers, whatever the search. */
export interface MemberCounts {
  people: number;
  administrators: number;
  /** Disabled, or everything of theirs stopped. */
  held: number;
}

/** What the people are narrowed by, on the server. */
export interface MemberFilters {
  /** In a name, an email, or the name of a group they are in. */
  q?: string;
  /** That group's people; Everyone's is every person. */
  group_id?: string;
  status?: 'active' | 'disabled' | 'held';
}

/** A page of people, with the groups its people are in, so a row names
 *  them, and the organization's numbers. */
export interface MemberPage extends ServerPage<Member> {
  counts: MemberCounts;
  groups: GroupName[];
}

/** A page of invitations, and the groups they place people in. */
export interface InvitationPage extends ServerPage<Invitation> {
  groups: GroupName[];
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
 * temporary password. Both lists are paged and searched on the server.
 */
@Injectable({ providedIn: 'root' })
export class MembersService {
  constructor(private request: RequestService) {}

  // ── People ──────────────────────────────────────────────────────────
  /** A page of the organization's people, searched and narrowed on the
   *  server, in the order they joined. */
  async page(after = '', limit = 20, filters: MemberFilters = {}): Promise<MemberPage> {
    const r = await this.request.gateway('IAM:User:list', pageAsk(after, limit, { ...filters }));
    return {
      rows: Array.isArray(r.users) ? r.users : [], next: nextOf(r), total: Number(r.total) || 0, error: r.error,
      counts: {
        people: Number(r.counts?.people) || 0,
        administrators: Number(r.counts?.administrators) || 0,
        held: Number(r.counts?.held) || 0,
      },
      groups: Array.isArray(r.groups) ? r.groups : [],
    };
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
  /** A page of the invitations not yet accepted; `q` in the address. */
  async invitations(after = '', limit = 10, q = ''): Promise<InvitationPage> {
    const r = await this.request.gateway('IAM:Invitation:list', pageAsk(after, limit, { q }));
    return {
      rows: Array.isArray(r.invitations) ? r.invitations : [], next: nextOf(r), total: Number(r.total) || 0,
      error: r.error, groups: Array.isArray(r.groups) ? r.groups : [],
    };
  }

  invite(email: string, groupIds: string[]) {
    return this.request.gateway<{ email: string }>('IAM:Invitation:create', { email, groups: groupIds });
  }

  revoke(invitationId: string): Promise<Failure> {
    return this.request.gateway('IAM:Invitation:revoke', { invitation_id: invitationId });
  }
}
