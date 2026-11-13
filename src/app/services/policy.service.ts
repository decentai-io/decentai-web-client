import { Injectable } from '@angular/core';

import { nextOf, pageAsk, ServerPage } from '../components/ui/paging';
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

/** One action of the catalog, in the API server's words. */
export interface PolicyCatalogAction {
  action: string;
  words: string;
}

/** A page of policies, and the catalog of actions they may name. */
export interface PolicyPage extends ServerPage<Policy> {
  catalog: PolicyCatalogAction[];
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

  /** A page of the policies, the built-in ones first; `q` in a name or
   *  an action a statement names. The catalog of actions comes with it. */
  async page(after = '', limit = 10, q = ''): Promise<PolicyPage> {
    const r = await this.request.gateway('IAM:Policy:list', pageAsk(after, limit, { q }));
    return {
      rows: Array.isArray(r.policies) ? r.policies : [], next: nextOf(r), total: Number(r.total) || 0,
      error: r.error, catalog: Array.isArray(r.catalog) ? r.catalog : [],
    };
  }

  /** Just these policies, by id, the built-in ones too: a picker names
   *  the ones chosen. */
  async named(ids: string[]): Promise<Policy[]> {
    if (!ids.length) return [];
    const r = await this.request.gateway('IAM:Policy:list', { ids });
    if (r.error) throw new Refused(r.error);
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
