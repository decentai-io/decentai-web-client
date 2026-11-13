import { Injectable } from '@angular/core';

import { nextOf, pageAsk, ServerPage } from '../components/ui/paging';
import { Person } from './auth.service';
import { Failure, RequestService } from './request.service';

export interface Group {
  group_id: string;
  name: string;
  /** The policies it gives its people, by id; the built-in ones are
   *  `administrator` and `member`. */
  policies: string[];
  /** Everyone: every person is in it without being listed. */
  everyone: boolean;
  /** Administrators, made with the organization. Neither it nor Everyone
   *  is renamed or deleted. */
  administrators: boolean;
  /** How many people are in it; on a list. */
  members?: number;
}

/** A policy as a list of groups names it. */
export interface PolicyName {
  policy_id: string;
  name: string;
  built_in: boolean;
}

/** The organization's groups in numbers, whatever the search. */
export interface GroupCounts {
  groups: number;
  /** Made here: neither Everyone nor Administrators. */
  own: number;
}

/** A page of groups, with the policies they give, by name, and the
 *  organization's numbers. */
export interface GroupPage extends ServerPage<Group> {
  counts: GroupCounts;
  policies: PolicyName[];
}

/** A page of one group's people. */
export interface GroupPeople extends ServerPage<Person> {
  group: Group | null;
}

/**
 * Client for IAM:Group: groups of people, each giving them its policies.
 *
 * Membership is kept on the person (`groups`), so placing people in
 * groups happens on the Users page; this service manages the group
 * itself and the policies it gives. Everyone and Administrators stay.
 * The list is paged and searched on the server.
 */
@Injectable({ providedIn: 'root' })
export class GroupService {
  constructor(private request: RequestService) {}

  /** A page of the organization's groups; `q` in the name. */
  async page(after = '', limit = 20, q = ''): Promise<GroupPage> {
    const r = await this.request.gateway('IAM:Group:list', pageAsk(after, limit, { q }));
    return {
      rows: Array.isArray(r.groups) ? r.groups : [], next: nextOf(r), total: Number(r.total) || 0, error: r.error,
      counts: { groups: Number(r.counts?.groups) || 0, own: Number(r.counts?.own) || 0 },
      policies: Array.isArray(r.policies) ? r.policies : [],
    };
  }

  /** Just these groups, by id: a picker names the ones chosen. */
  async named(ids: string[]): Promise<Group[]> {
    if (!ids.length) return [];
    const r = await this.request.gateway('IAM:Group:list', { ids });
    return Array.isArray(r.groups) ? r.groups : [];
  }

  /** One group, with a page of its people. */
  async get(groupId: string, after = '', limit = 20): Promise<GroupPeople> {
    const r = await this.request.gateway('IAM:Group:get', pageAsk(after, limit, { group_id: groupId }));
    return {
      group: r.group ?? null, rows: Array.isArray(r.users) ? r.users : [], next: nextOf(r),
      total: Number(r.total) || 0, error: r.error,
    };
  }

  create(name: string) {
    return this.request.gateway<{ group: Group }>('IAM:Group:create', { name });
  }

  rename(groupId: string, name: string) {
    return this.request.gateway<{ group: Group }>('IAM:Group:rename', { group_id: groupId, name });
  }

  setPolicies(groupId: string, policyIds: string[]) {
    return this.request.gateway<{ group: Group }>('IAM:Group:set_policies', { group_id: groupId, policies: policyIds });
  }

  remove(groupId: string): Promise<Failure> {
    return this.request.gateway('IAM:Group:delete', { group_id: groupId });
  }
}
