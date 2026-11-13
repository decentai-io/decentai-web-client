import { Injectable } from '@angular/core';

import { nextOf, pageAsk } from '../components/ui/paging';
import { Failure, RequestService } from './request.service';

/** The scope of a shared token or runtime: its runtimes may serve every
 *  organization that does not keep to its own. Any other scope is one
 *  organization's id. */
export const SHARED_SCOPE = '';

/** An enrollment token, as the issuer keeps it: what the nodes it enrolls
 *  will be, never which. Its secret is shown once, when it is made. */
export interface EnrollmentToken {
  _id: string;
  kind: 'runtime' | 'sandbox';
  /** `scope` (absent for a shared token) and `labels`. */
  metadata: { scope?: string; labels?: string[] };
  /** Each certificate's lifetime, in seconds. */
  lifetime: number;
  /** How many more nodes it may enroll; null for any number. */
  uses: number | null;
  /** When it stops enrolling, in Unix seconds; null for never. */
  expires: number | null;
  withdrawn: boolean;
  /** When it was made, in Unix seconds. */
  made: number;
}

/** A node a token enrolled, as the issuer keeps it. */
export interface EnrolledNode {
  _id: string;
  token: string | null;
}

/** What the token form sends. */
export interface TokenDraft {
  kind: 'runtime' | 'sandbox';
  /** How many nodes it may enroll. */
  uses: number;
  /** How long it enrolls, in days. */
  days: number;
  labels: string[];
  shared: boolean;
}

/** How full a sandbox is, as it says. */
export interface SandboxRoom {
  processes: number;
  processes_max: number;
  memory_used: number;
  memory_max: number;
}

/** One sandbox of a runtime, as the runtime last reported it. */
export interface NodeSandbox {
  sandbox_id: string;
  machine: string;
  base: string;
  room: SandboxRoom | null;
  /** No new process is started there; those running finish. */
  draining: boolean;
  /** How many of this organization's processes run there: the API
   *  server gives no other organization's. */
  processes: number;
  /** The agents they are of, by id. */
  agents: string[];
}

/** A runtime that reported itself (`Runtimes.public`). Nobody registers
 *  one: it is on the list once it reports. */
export interface ExecutionNode {
  node_id: string;
  /** The name a person gave it; '' for none. */
  name: string;
  note: string;
  /** `SHARED_SCOPE`, or the organization's id. */
  scope: string;
  labels: string[];
  /** When it first reported, and when last. */
  since: string | null;
  seen_at: string | null;
  /** Reporting now. */
  live: boolean;
  /** Refused by its id, whatever its certificate says. */
  refused: boolean;
  /** No new chat is placed on it; those it holds go on. */
  draining: boolean;
  /** This organization's chats it holds now. */
  held_chats: number;
  /** How many other organizations' chats it holds: counted, never named. */
  held_elsewhere: number;
  sandboxes: NodeSandbox[];
}

/** Bounds the API server keeps, so the forms say so before asking it. */
export const NODE_NAME_MAX = 200;
export const NOTE_MAX = 200;
export const REASON_MAX = 300;

/** A runtime as the page reads it: its sandboxes' processes counted, and
 *  the agents they are of named. */
export function normalizeNode(raw: any): ExecutionNode {
  const drained: string[] = Array.isArray(raw?.drained) ? raw.drained : [];
  const sandboxes: any[] = Array.isArray(raw?.sandboxes) ? raw.sandboxes : [];
  return {
    node_id: String(raw?.node_id ?? ''),
    name: raw?.name ?? '',
    note: raw?.note ?? '',
    scope: raw?.scope ?? SHARED_SCOPE,
    labels: Array.isArray(raw?.labels) ? raw.labels : [],
    since: raw?.since ?? null,
    seen_at: raw?.seen_at ?? null,
    live: raw?.live === true,
    refused: raw?.refused === true,
    draining: raw?.draining === true,
    held_chats: Number(raw?.held_chats) || 0,
    held_elsewhere: Number(raw?.held_elsewhere) || 0,
    sandboxes: sandboxes.map((one) => {
      const processes: any[] = Array.isArray(one?.processes) ? one.processes : [];
      return {
        sandbox_id: String(one?.sandbox ?? ''),
        machine: one?.machine ?? '',
        base: one?.base ?? '',
        room: one?.room ?? null,
        draining: drained.includes(String(one?.sandbox ?? '')),
        processes: processes.length,
        agents: [...new Set(processes.map((process) => String(process?.agent)))],
      };
    }),
  };
}

/** What the runtimes are narrowed by, on the API server: every word of
 *  `q` in a name, an id, a note or a label; how they stand; whom they
 *  serve. */
export interface NodeQuery {
  q?: string;
  state?: 'connected' | 'away' | 'refused';
  scope?: 'shared' | 'own';
}

/** The runtimes in numbers, whatever the search: the sandboxes, those
 *  draining and the chats held counted over the connected ones. */
export interface NodeCounts {
  total: number;
  connected: number;
  refused: number;
  sandboxes: number;
  draining: number;
  chats: number;
  shared: number;
  own: number;
  /** The organization's own that are connected, where the server says. */
  own_connected?: number;
}

/** A page of runtimes. */
export interface NodePage extends Failure {
  nodes: ExecutionNode[];
  next: string | null;
  total: number;
  counts: NodeCounts | null;
}

/** What the tokens are narrowed by: `q` in an id, a kind or a label;
 *  those that can enroll, or those spent. */
export interface TokenFilters {
  q?: string;
  state?: 'live' | 'spent';
}

/** A page of tokens, newest first, and the nodes they enrolled. */
export interface TokenPage extends Failure {
  tokens: EnrollmentToken[];
  enrolled: EnrolledNode[];
  next: string | null;
  total: number;
  counts: { live: number; spent: number } | null;
}

/**
 * Client for the runtimes that serve the organization (Nodes:Node), and
 * the enrollment tokens that let one join (Nodes:Authority).
 */
@Injectable({ providedIn: 'root' })
export class NodesService {
  constructor(private request: RequestService) {}

  // ── Enrollment tokens ───────────────────────────────────────────────

  /** The organization's tokens (and the shared ones, for the operator),
   *  and the nodes they enrolled. */
  async tokens(filters: TokenFilters = {}, after = '', limit = 100): Promise<TokenPage> {
    const r = await this.request.gateway('Nodes:Authority:list', pageAsk(after, limit, { ...filters }));
    const tokens: EnrollmentToken[] = r.tokens ?? [];
    return {
      tokens, enrolled: r.nodes ?? [], next: nextOf(r), total: Number(r.total ?? tokens.length) || 0,
      counts: r.counts ? { live: Number(r.counts.live) || 0, spent: Number(r.counts.spent) || 0 } : null,
      error: r.error,
    };
  }

  /** A new token: its secret is in this answer and never again. */
  createToken(draft: TokenDraft): Promise<{ id?: string; token?: string } & Failure> {
    return this.request.gateway('Nodes:Authority:create', {
      kind: draft.kind,
      expires: Math.round(draft.days * 86400),
      uses: draft.uses,
      labels: draft.labels,
      shared: draft.shared,
    });
  }

  /** Withdrawn: it enrolls nobody, and its nodes are not renewed. */
  revokeToken(id: string): Promise<Failure> {
    return this.request.gateway('Nodes:Authority:revoke', { token_id: id });
  }

  // ── Runtimes ────────────────────────────────────────────────────────

  async nodes(filters: NodeQuery = {}, after = '', limit = 100): Promise<NodePage> {
    const r = await this.request.gateway('Nodes:Node:list', pageAsk(after, limit, { ...filters }));
    const nodes: ExecutionNode[] = (r.nodes ?? []).map((raw: any) => normalizeNode(raw));
    const counts = r.counts && typeof r.counts === 'object' ? {
      total: Number(r.counts.total) || 0, connected: Number(r.counts.connected) || 0,
      refused: Number(r.counts.refused) || 0, sandboxes: Number(r.counts.sandboxes) || 0,
      draining: Number(r.counts.draining) || 0, chats: Number(r.counts.chats) || 0,
      shared: Number(r.counts.shared) || 0, own: Number(r.counts.own) || 0,
      ...(r.counts.own_connected !== undefined ? { own_connected: Number(r.counts.own_connected) || 0 } : {}),
    } : null;
    return { nodes, next: nextOf(r), total: Number(r.total ?? nodes.length) || 0, counts, error: r.error };
  }

  /** A name and a note for people. */
  updateNode(nodeId: string, changes: { name: string; note: string }): Promise<Failure> {
    return this.request.gateway('Nodes:Node:update', { node_id: nodeId, ...changes });
  }

  /** Every call from it refused, and its chats placed elsewhere. */
  refuse(nodeId: string, reason = ''): Promise<Failure> {
    return this.request.gateway('Nodes:Node:refuse', { node_id: nodeId, reason });
  }

  allow(nodeId: string): Promise<Failure> {
    return this.request.gateway('Nodes:Node:allow', { node_id: nodeId });
  }

  /** A runtime that is gone, off the list. A refusal stays. */
  forget(nodeId: string): Promise<Failure> {
    return this.request.gateway('Nodes:Node:forget', { node_id: nodeId });
  }

  /** The runtime drained, or one of its sandboxes; with `on: false`,
   *  undone. */
  drain(nodeId: string, on: boolean, sandboxId = ''): Promise<Failure> {
    return this.request.gateway('Nodes:Node:drain', {
      node_id: nodeId, drain: on, ...(sandboxId ? { sandbox_id: sandboxId } : {}),
    });
  }
}
