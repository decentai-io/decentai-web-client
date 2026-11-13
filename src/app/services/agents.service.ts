import { Injectable } from '@angular/core';

import { Failure, RequestService } from './request.service';

/** One function of a manifest (agents.md §5). */
export interface AgentFunction {
  id: string;
  name: string;
  description?: string;
  /** 0 reads, 1 changes, 2 wider changes, 3 acts outside the platform. */
  level: number;
  timeout_seconds?: number;
  inputs?: any;
  outputs?: any;
  /** What it may call on the runtime: `model`, `chat`, `record.read:logins`… */
  calls?: string[];
  authorization?: Record<string, { from_input: string; required?: boolean }>;
  /** A schedule may run it with nobody present. */
  schedulable?: boolean;
}

/** One resource a manifest declares (agents.md §7). */
export interface AgentResource {
  id: string;
  label?: string;
  description?: string;
  binding?: { cardinality?: 'one' | 'many'; required?: boolean };
  user_access?: string[];
  fields?: { name: string; label?: string; type: string; storage?: string; required?: boolean; options?: string[] }[];
  oauth?: { provider: string; [key: string]: unknown };
  constraints?: { mime_types?: string[]; max_size_mb?: number };
}

/** An agent's manifest, schema 3 (agents.md §5). */
export interface Manifest {
  schema: number;
  agent: {
    id: string; name: string; version: string; description?: string; instructions?: string;
    examples?: { title: string; prompt: string }[]; tags?: string[];
  };
  functions: AgentFunction[];
  authorization?: { scopes?: Record<string, { description?: string; normalization?: string }> };
  resources?: { secrets?: AgentResource[]; data?: AgentResource[]; files?: AgentResource[] };
  network?: { hosts?: (string | { from_secret: string })[] };
}

/** An installed agent (`Agents.public`). Until a runtime has started it
 *  once and it said `ready`, its `state` is `checking`; `failed` says why
 *  in `error`. */
export interface InstalledAgent {
  agent_id: string;
  version: string;
  name: string;
  manifest: Manifest;
  base: string;
  readme: string;
  source_id: string;
  state: 'checking' | 'ready' | 'failed';
  error: string;
  machines: string[];
  /** Whether it ships samples, and whether the person loaded them. */
  samples: boolean;
  samples_loaded: boolean;
  /** The address of the source it was installed from. */
  source_url: string;
  installed_at: string;
}

/** A saved catalog address (`Sources.public`). Its credential is never
 *  shown again: `credential` says only whether one is kept. */
export interface AgentSource {
  source_id: string;
  url: string;
  credential: boolean;
  /** The catalog's name, as last read. */
  name: string;
  /** The catalog as last read, by its digest: what a review is of. */
  digest: string;
  read_at: string | null;
  /** Why the last read failed. */
  error: string;
  /** How many agents its catalog offers. */
  agents: number;
}

/** What a source is read with: a token, or a header and its value. */
export type SourceCredential = { token: string } | { header: string; value: string };

/** One agent a source's catalog offers, against what is installed. */
export interface CatalogOffer {
  source_id: string;
  /** The source's catalog as read: what installing it is pinned to. */
  digest: string;
  status: 'not_installed' | 'installed' | 'update_available' | 'other_source';
  manifest: Manifest;
  machines: string[];
  base: string;
  readme: string;
  /** What is wrong with the entry: one with errors can't be installed. */
  errors: string[];
}

/** What loading an agent's samples would make. */
export interface SampleSummary {
  story: string;
  records: number;
  files: number;
}

/** An approval the person chose to remember, for an agent's function and
 *  a record ('' for any). */
export interface RememberedApproval {
  id: string;
  agent: string;
  function: string;
  record: string;
  allowed: boolean;
  at: string;
}

/** What a row says of its group: may use the functions, asked first
 *  each time, or may not. A deny wins, then an ask, then an allow. */
export type AccessEffect = 'allow' | 'ask' | 'deny';

/** One row of who may use an installed agent (api-server.md §5): one of
 *  the organization's groups, an effect, every function (`["*"]`) or
 *  some, and values for the scopes the agent declares. A row covers what
 *  its functions call, too. */
export interface AccessRow {
  group_id: string;
  effect: AccessEffect;
  functions: string[];
  /** A scope's values narrow the functions it scopes to those values;
   *  a scope left out is not narrowed. */
  scopes?: Record<string, string[]>;
}

/** One of the organization's groups, with how many people it holds. */
export interface AccessGroup {
  group_id: string;
  name: string;
  members: number;
}

/** One of the agent's functions, and the scopes that narrow it. */
export interface AccessFunction {
  id: string;
  name: string;
  level: number;
  scoped_by: string[];
}

/** A policy that also names the agent's actions: changed on Policies. */
export interface AccessPolicy {
  policy_id: string;
  name: string;
  actions: string[];
}

/** Everything `Agents:Agent:access` answers with. */
export interface AgentAccess {
  access: AccessRow[];
  groups: AccessGroup[];
  functions: AccessFunction[];
  scopes: { name: string; description: string }[];
  policies: AccessPolicy[];
}

/**
 * Client for Agents:Agent: the agents a person may use, the sources an
 * administrator saved, and installing what a source offers. An agent is
 * installed from a source's catalog as it was reviewed: the API server
 * keeps its files, and a runtime checks it before anyone uses it.
 */
@Injectable({ providedIn: 'root' })
export class AgentsService {
  constructor(private request: RequestService) {}

  /** The agents the person may use; for an administrator, every
   *  installed agent, whatever its state. */
  async installed(): Promise<InstalledAgent[]> {
    const r = await this.request.gateway('Agents:Agent:list');
    return Array.isArray(r.agents) ? r.agents : [];
  }

  async get(agentId: string): Promise<InstalledAgent | null> {
    const r = await this.request.gateway('Agents:Agent:get', { agent_id: agentId });
    return r.agent ?? null;
  }

  /** The saved sources, and the catalog address this deployment
   *  suggests (empty where none is set). */
  async sources(): Promise<{ sources: AgentSource[]; reference: string } & Failure> {
    const r = await this.request.gateway('Agents:Agent:sources');
    return { sources: Array.isArray(r.sources) ? r.sources : [], reference: String(r.reference || ''), error: r.error };
  }

  /** What every source offers, against what is installed. */
  async available(): Promise<CatalogOffer[]> {
    const r = await this.request.gateway('Agents:Agent:available');
    return Array.isArray(r.agents) ? r.agents : [];
  }

  createSource(url: string, credential?: SourceCredential | null) {
    return this.request.gateway<{ source: AgentSource }>('Agents:Agent:sourcecreate', {
      url, ...(credential ? { credential } : {}),
    });
  }

  /** `credential`: left out keeps the one kept, null removes it, a value
   *  replaces it. A new address needs it again. */
  updateSource(sourceId: string, url: string, credential?: SourceCredential | null) {
    return this.request.gateway<{ source: AgentSource }>('Agents:Agent:sourceupdate', {
      source_id: sourceId, url, ...(credential !== undefined ? { credential } : {}),
    });
  }

  refreshSource(sourceId: string) {
    return this.request.gateway<{ source: AgentSource }>('Agents:Agent:sourcerefresh', { source_id: sourceId });
  }

  /** Delete a source, uninstalling its agents. */
  deleteSource(sourceId: string) {
    return this.request.gateway<object>('Agents:Agent:sourcedelete', { source_id: sourceId });
  }

  /** Install, or update to, the version reviewed: pinned to the catalog
   *  as it was read, so a source read again since is reviewed again. */
  install(offer: CatalogOffer) {
    return this.request.gateway<{ agent: InstalledAgent }>('Agents:Agent:install', {
      source_id: offer.source_id, agent_id: offer.manifest.agent.id,
      version: offer.manifest.agent.version, digest: offer.digest,
    });
  }

  /** Ask a runtime to check an installed agent again. */
  check(agentId: string) {
    return this.request.gateway<{ agent: InstalledAgent }>('Agents:Agent:check', { agent_id: agentId });
  }

  /** Uninstall an agent; its records stay their people's. */
  uninstall(agentId: string) {
    return this.request.gateway<object>('Agents:Agent:delete', { agent_id: agentId });
  }

  // ── Who may use it ───────────────────────────────────────────────

  /** Who may use an agent, by group, with the groups, its functions and
   *  scopes, and the policies that also name it. Refused (`refused`) for
   *  whoever may not install agents. */
  async access(agentId: string): Promise<Partial<AgentAccess> & Failure> {
    const r = await this.request.gateway<AgentAccess>('Agents:Agent:access', { agent_id: agentId });
    if (r.error) return { error: r.error, code: r.code };
    return {
      access: Array.isArray(r.access) ? r.access : [],
      groups: Array.isArray(r.groups) ? r.groups : [],
      functions: Array.isArray(r.functions) ? r.functions : [],
      scopes: Array.isArray(r.scopes) ? r.scopes : [],
      policies: Array.isArray(r.policies) ? r.policies : [],
    };
  }

  /** Choose who may use an agent: the rows, whole, at most 50. A refusal
   *  names the row it is about. */
  setAccess(agentId: string, access: AccessRow[]) {
    return this.request.gateway<{ access: AccessRow[] }>('Agents:Agent:setaccess', { agent_id: agentId, access });
  }

  // ── Samples ──────────────────────────────────────────────────────

  async samples(agentId: string): Promise<SampleSummary | null> {
    const r = await this.request.gateway('Agents:Agent:samples', { agent_id: agentId });
    return r.samples ?? null;
  }

  /** Load the samples as records of the person's own. */
  loadSamples(agentId: string) {
    return this.request.gateway<{ loaded: number }>('Agents:Agent:loadsamples', { agent_id: agentId });
  }

  /** Remove exactly what loading made. */
  removeSamples(agentId: string) {
    return this.request.gateway<{ removed: number }>('Agents:Agent:removesamples', { agent_id: agentId });
  }

  // ── Remembered approvals ─────────────────────────────────────────

  /** The approvals the person chose to remember, for every agent. */
  async remembered(): Promise<RememberedApproval[]> {
    const r = await this.request.gateway('AI:Approval:remembered');
    return Array.isArray(r.remembered) ? r.remembered : [];
  }

  /** Take a remembered approval back: the next call asks again. */
  forget(id: string) {
    return this.request.gateway<object>('AI:Approval:forget', { id });
  }
}
