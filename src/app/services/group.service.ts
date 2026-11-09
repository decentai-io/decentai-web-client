import { Injectable } from '@angular/core';

import { Person } from './auth.service';
import { Failure, Refused, RequestService } from './request.service';

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

/**
 * Client for IAM:Group: groups of people, each giving them its policies.
 *
 * Membership is kept on the person (`groups`), so placing people in
 * groups happens on the Users page; this service manages the group
 * itself and the policies it gives. Everyone and Administrators stay.
 */
@Injectable({ providedIn: 'root' })
export class GroupService {
  constructor(private request: RequestService) {}

  async list(): Promise<Group[]> {
    const r = await this.request.gateway('IAM:Group:list');
    if (r.error) throw new Refused(r.error);  // the page says why, a picker falls back
    return Array.isArray(r.groups) ? r.groups : [];
  }

  /** One group, with its people. */
  async get(groupId: string): Promise<{ group: Group; users: Person[] } | null> {
    const r = await this.request.gateway('IAM:Group:get', { group_id: groupId });
    return r.group ? { group: r.group, users: r.users ?? [] } : null;
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
