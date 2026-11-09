import { Injectable } from '@angular/core';

import { Failure, Refused, RequestService } from './request.service';

/** One statement of a policy. `ask` and `scopes` are for agents'
 *  actions alone (`agent:<agent>:<function>`, and `…:<call>` for what it
 *  calls on the runtime): an ask puts the question to the chat's person,
 *  and scopes narrow a function to the values its manifest's
 *  authorization scopes allow. */
export interface PolicyStatement {
  effect: 'allow' | 'deny' | 'ask';
  actions: string[];
  scopes?: Record<string, string[]>;
}

export interface Policy {
  policy_id: string;
  name: string;
  statements: PolicyStatement[];
  /** Administrator and Member: the platform's own, read-only. */
  built_in: boolean;
}

/**
 * Client for IAM:Policy, where permissions are written.
 *
 * A group gives its people its policies; a policy is a list of
 * statements. A deny wins, then an ask, then an allow; nothing matching
 * is a deny. The API server refuses a statement allowing what its author
 * does not hold.
 */
@Injectable({ providedIn: 'root' })
export class PolicyService {
  constructor(private request: RequestService) {}

  async list(): Promise<Policy[]> {
    const r = await this.request.gateway('IAM:Policy:list');
    if (r.error) throw new Refused(r.error);  // the page says why, a picker falls back
    return Array.isArray(r.policies) ? r.policies : [];
  }

  create(name: string, statements: PolicyStatement[]) {
    return this.request.gateway<{ policy: Policy }>('IAM:Policy:create', { name, statements });
  }

  update(policyId: string, statements: PolicyStatement[]) {
    return this.request.gateway<{ policy: Policy }>('IAM:Policy:update', { policy_id: policyId, statements });
  }

  /** A new name; refused where another policy has it, and for the
   *  built-in ones. */
  rename(policyId: string, name: string) {
    return this.request.gateway<{ policy: Policy }>('IAM:Policy:rename', { policy_id: policyId, name });
  }

  remove(policyId: string): Promise<Failure> {
    return this.request.gateway('IAM:Policy:delete', { policy_id: policyId });
  }
}
