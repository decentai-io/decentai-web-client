import { Injectable } from '@angular/core';

import { TrailLine, TrailPage, trailPage } from './audit.service';
import { Failure, RequestService } from './request.service';

/** One running agent of the organization's, as its runtimes report it:
 *  how many processes it has, the memory they hold, in bytes, and the
 *  processor's cores they used over the last second. */
export interface AgentUsage {
  agent: string;
  processes: number;
  memory: number;
  cpu: number;
}

/** Tokens a model used, added up by day and whatever else the rows are
 *  by: for the organization, by person and agent too. `cost` is in US
 *  dollars, at the catalog's prices; null where none is known. */
export interface TokenRow {
  day: string;
  provider: string;
  model: string;
  user_id?: string;
  agent?: string;
  /** The person's and the agent's names, for the organization's rows. */
  person?: string;
  agent_name?: string;
  /** Shown to the model, apart from what the cache gave or kept. */
  input: number;
  output: number;
  /** Read from the provider's prompt cache, and written to it; missing on rows from before they were counted. */
  cache_read?: number;
  cache_write?: number;
  calls: number;
  cost: number | null;
}

/** The organization's trail, added up by what and how it ended. */
export interface SummaryRow {
  what: string;
  outcome: string;
  count: number;
}

/** Client for Agents:Monitor — what the organization's agents and models
 *  use, and what its runtimes wrote down — and AI:Usage, a person's own
 *  tokens. Read-only. */
@Injectable({ providedIn: 'root' })
export class MonitoringService {
  constructor(private request: RequestService) {}

  /** The organization's running agents, now. */
  async usage(): Promise<{ agents: AgentUsage[] } & Failure> {
    const r = await this.request.gateway('Agents:Monitor:usage');
    return { agents: r.agents ?? [], error: r.error };
  }

  /** The organization's tokens over the last days. */
  async tokens(days: number): Promise<{ usage: TokenRow[] } & Failure> {
    const r = await this.request.gateway('Agents:Monitor:tokens', { days });
    return { usage: r.usage ?? [], error: r.error };
  }

  /** The person's own tokens over the last days. */
  async mine(days: number): Promise<{ usage: TokenRow[] } & Failure> {
    const r = await this.request.gateway('AI:Usage:mine', { days });
    return { usage: r.usage ?? [], error: r.error };
  }

  /** What the organization's runtimes wrote down of its chats, a page at
   *  a time, newest first. */
  async events(before = ''): Promise<TrailPage & Failure> {
    const r = await this.request.gateway('Agents:Monitor:events', { before, limit: 100 });
    return trailPage((r.events ?? []) as TrailLine[], r.error);
  }

  /** The organization's trail over the last days, added up. */
  async summary(days: number): Promise<{ summary: SummaryRow[] } & Failure> {
    const r = await this.request.gateway('Agents:Monitor:summary', { days });
    return { summary: r.summary ?? [], error: r.error };
  }
}
