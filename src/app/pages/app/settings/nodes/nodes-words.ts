import { relativeDate } from 'src/app/components/ui/dates';
import { EnrollmentToken, ExecutionNode, NodeSandbox, SHARED_SCOPE } from 'src/app/services/nodes.service';

/** What the Nodes page says of runtimes and tokens, apart from the page:
 *  the words, the filters, the groups and the counts, each a function of
 *  what the API server listed. */

export type NodeState = 'connected' | 'away' | 'refused';
export type NodeStateFilter = 'all' | NodeState;

export interface NodeFilters {
  query: string;
  state: NodeStateFilter;
  /** 'all', or a scope: shared, or the organization's id. */
  scope: string;
}

export const NO_FILTERS: NodeFilters = { query: '', state: 'all', scope: 'all' };

/** The name a person knows the runtime by: the one given it, else its id. */
export function nodeLabel(node: ExecutionNode): string {
  return node.name.trim() || node.node_id;
}

/** How it stands: refused first, whatever its reports. */
export function nodeState(node: ExecutionNode): NodeState {
  if (node.refused) return 'refused';
  return node.live ? 'connected' : 'away';
}

export const STATE_WORDS: Record<NodeState, string> = {
  connected: 'Connected',
  away: 'Not connected',
  refused: 'Refused',
};

/** Whom it serves, in words. */
export function scopeName(item: { scope: string }): string {
  return isShared(item) ? 'Shared' : 'This organization';
}

export function isShared(item: { scope: string }): boolean {
  return item.scope === SHARED_SCOPE;
}

export function filtersOn(filters: NodeFilters): boolean {
  return !!filters.query.trim() || filters.state !== 'all' || filters.scope !== 'all';
}

/** The runtimes the filters keep. The search matches the name, the id,
 *  the note and the labels. */
export function filterNodes(nodes: ExecutionNode[], filters: NodeFilters): ExecutionNode[] {
  const words = filters.query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  return nodes.filter((node) => {
    if (filters.state !== 'all' && nodeState(node) !== filters.state) return false;
    if (filters.scope !== 'all' && node.scope !== filters.scope) return false;
    if (!words.length) return true;
    const haystack = [node.name, node.node_id, node.note, ...node.labels].join(' ').toLowerCase();
    return words.every((word) => haystack.includes(word));
  });
}

export interface NodeGroup {
  scope: string;
  name: string;
  nodes: ExecutionNode[];
  connected: number;
}

/** Shared runtimes first, then the organization's own; within a group,
 *  connected first, then by name. */
export function groupNodes(nodes: ExecutionNode[]): NodeGroup[] {
  const groups = new Map<string, NodeGroup>();
  for (const node of nodes) {
    let group = groups.get(node.scope);
    if (!group) {
      group = { scope: node.scope, name: scopeName(node), nodes: [], connected: 0 };
      groups.set(node.scope, group);
    }
    group.nodes.push(node);
    if (node.live) group.connected += 1;
  }
  const rank = (state: NodeState) => (state === 'connected' ? 0 : state === 'away' ? 1 : 2);
  for (const group of groups.values()) {
    group.nodes.sort((a, b) => rank(nodeState(a)) - rank(nodeState(b))
      || nodeLabel(a).localeCompare(nodeLabel(b)));
  }
  return [...groups.values()].sort((a, b) => (isShared(a) === isShared(b) ? 0 : isShared(a) ? -1 : 1));
}

/** The counts at the head of the page. Sandboxes and chats are those of
 *  the runtimes connected now: one away holds neither. */
export interface NodesOverview {
  total: number;
  connected: number;
  refused: number;
  sandboxes: number;
  draining: number;
  chats: number;
  /** Tokens that may still enroll a node. */
  tokens: number;
}

export function overview(nodes: ExecutionNode[], tokens: EnrollmentToken[], now: Date = new Date()): NodesOverview {
  const live = nodes.filter((node) => node.live && !node.refused);
  const sandboxes = live.flatMap((node) => node.sandboxes);
  return {
    total: nodes.length,
    connected: live.length,
    refused: nodes.filter((node) => node.refused).length,
    sandboxes: sandboxes.length,
    draining: sandboxes.filter((sandbox) => sandbox.draining).length,
    chats: live.reduce((sum, node) => sum + node.held_chats, 0),
    tokens: tokens.filter((token) => tokenState(token, now) === 'live').length,
  };
}

export function plural(count: number, one: string, many = `${one}s`): string {
  return `${count} ${count === 1 ? one : many}`;
}

/** What a runtime's row says under its name. */
export function nodeFacts(node: ExecutionNode, now: Date = new Date()): string[] {
  const facts: string[] = [];
  if (node.live) facts.push(plural(node.held_chats, 'chat'));
  const draining = node.sandboxes.filter((sandbox) => sandbox.draining).length;
  if (node.sandboxes.length) {
    facts.push(plural(node.sandboxes.length, 'sandbox', 'sandboxes') + (draining ? `, ${draining} draining` : ''));
  }
  if (!node.live && node.seen_at) facts.push(`Last seen ${relativeDate(node.seen_at, now).toLowerCase()}`);
  return facts;
}

/** How a sandbox stands, in a word, and the chip's tone. */
export function sandboxState(sandbox: NodeSandbox): { word: string; tone: '' | 'live' | 'warn' } {
  return sandbox.draining ? { word: 'Draining', tone: 'warn' } : { word: 'Taking work', tone: 'live' };
}

export function bytes(value: number | null | undefined): string {
  if (value === null || value === undefined || !isFinite(value)) return '—';
  const amount = Math.max(0, value);
  if (amount >= 1024 ** 3) return `${(amount / 1024 ** 3).toFixed(1)} GB`;
  if (amount >= 1024 ** 2) return `${Math.round(amount / 1024 ** 2)} MB`;
  if (amount >= 1024) return `${Math.round(amount / 1024)} KB`;
  return `${amount} B`;
}

/** What share of what it was given it uses, 0–100, or null when either
 *  is unknown. */
export function share(used: number | null | undefined, limit: number | null | undefined): number | null {
  if (used === null || used === undefined || !limit) return null;
  return Math.max(0, Math.min(100, Math.round((used / limit) * 100)));
}

export type TokenState = 'live' | 'used' | 'expired' | 'withdrawn';

/** Whether a token may still enroll a node, and if not, why. */
export function tokenState(token: EnrollmentToken, now: Date = new Date()): TokenState {
  if (token.withdrawn) return 'withdrawn';
  if (token.expires !== null && token.expires * 1000 <= now.getTime()) return 'expired';
  if (token.uses !== null && token.uses <= 0) return 'used';
  return 'live';
}

export const TOKEN_WORDS: Record<TokenState, string> = {
  live: 'Can enroll',
  used: 'Used up',
  expired: 'Expired',
  withdrawn: 'Withdrawn',
};

/** What a token's row says under its kind. */
export function tokenFacts(token: EnrollmentToken, enrolled: number, now: Date = new Date()): string[] {
  const facts = [plural(enrolled, 'node') + ' enrolled'];
  if (tokenState(token, now) === 'live') {
    facts.push(token.uses === null ? 'any number more' : `${token.uses} more`);
    if (token.expires !== null) {
      facts.push(`until ${new Date(token.expires * 1000).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}`);
    }
  }
  facts.push(`made ${relativeDate(token.made * 1000, now).toLowerCase()}`);
  return facts;
}
