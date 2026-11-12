/**
 * The chat inspector in words and numbers: what each tab shows, worked
 * out once from what the server answered (AI:Chat:inspect) and the live
 * work the page holds. Pure, so each is tested alone.
 */
import { Choice } from 'src/app/components/ui/radio-keys';
import {
  ChatFile, ChatInspection, ChatUsage, McpUse, ModelCall, RecordOperation, RecordUse, UpcomingRun, wholeInspection,
} from 'src/app/models/chat-inspect';
import { ChatSettings, WorkItem } from 'src/app/models/chat-protocol';
import { Schedule } from 'src/app/services/activity.service';
import { WorkEntry } from 'src/app/services/chat-state.service';
import { compact } from 'src/app/pages/app/monitoring/activity-overview.component';
import { ChatWorkComponent } from '../chat-work/chat-work.component';

export type InspectorTab = 'overview' | 'activity' | 'data' | 'runs' | 'schedules' | 'setup';

export const INSPECTOR_TABS: Choice<InspectorTab>[] = [
  { value: 'overview', name: 'Overview' },
  { value: 'activity', name: 'Activity' },
  { value: 'data', name: 'Data' },
  { value: 'runs', name: 'Runs' },
  { value: 'schedules', name: 'Schedules' },
  { value: 'setup', name: 'Setup' },
];

export type ActivityFilter = 'all' | 'model' | 'agents' | 'failed';

export const ACTIVITY_FILTERS: Choice<ActivityFilter>[] = [
  { value: 'all', name: 'All' },
  { value: 'model', name: 'Model' },
  { value: 'agents', name: 'Agents' },
  { value: 'failed', name: 'Failed' },
];

const time = (at: string | null | undefined): number => Date.parse(at || '') || 0;

// ── Numbers ────────────────────────────────────────────────────────────

/** A length of time as a stopwatch says it: "820 ms", "4.2s", "12s",
 *  "1m 12s", "2h 5m"; '' when unknown. */
export function duration(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || !isFinite(ms) || ms < 0) return '';
  if (ms < 1000) return `${Math.round(ms)} ms`;
  const seconds = ms / 1000;
  if (seconds < 10) return `${(Math.floor(seconds * 10) / 10).toFixed(1)}s`;
  if (seconds < 60) return `${Math.floor(seconds)}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${Math.floor(seconds % 60)}s`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

/** How long something took, to now while it runs; null when it never began. */
export function took(started: string | null | undefined, ended: string | null | undefined, now = Date.now()):
    number | null {
  const from = time(started);
  if (!from) return null;
  return Math.max(0, (ended ? time(ended) : now) - from);
}

/** How long anything was at work, spans that overlap counted once. */
export function busyTime(spans: [number, number][]): number {
  const sorted = spans.filter(([from, to]) => to > from).sort((a, b) => a[0] - b[0]);
  let total = 0;
  let end = -Infinity;
  for (const [from, to] of sorted) {
    if (to <= end) continue;
    total += to - Math.max(from, end);
    end = to;
  }
  return total;
}

/** Tokens as tiles say them: 1,284 · 48.2K. */
export const tokens = compact;

// ── Activity: agent calls and model calls, as one list ─────────────────

/** A call of an agent's function or an MCP tool: what "agent calls" counts. */
export function isAgentCall(entry: WorkItem): boolean {
  return entry.kind ? entry.kind === 'call' || entry.kind === 'mcp' : !!(entry.means?.agent || entry.means?.server);
}

/** One row of the list: a piece of the chat's work, or a model call. */
export interface ActivityRow {
  key: string;
  at: number;
  icon: string;
  title: string;
  /** Who did it: an agent and its function, a server and its tool, a model. */
  by: string;
  status: WorkItem['status'];
  /** How long it took, or has run. */
  took: number | null;
  /** For a model call: "12.9K in · 340 out". */
  tokens: string;
  work?: WorkEntry;
  call?: ModelCall;
}

const PURPOSES: Record<string, string> = { thought: 'Thought', fold: 'Summarized the conversation' };

/** Who a piece of work is by, in words: "Mail · send", "github · create_issue". */
export function workBy(entry: WorkItem, names: Record<string, string>): string {
  const means = entry.means ?? {};
  if (means.server) return [means.server, means.tool].filter(Boolean).join(' · ');
  if (means.agent) return [names[means.agent] || means.agent, means.function].filter(Boolean).join(' · ');
  return '';
}

/** The assistant's own, or an agent's by name. */
export function agentName(agent: string, names: Record<string, string>): string {
  if (!agent) return 'Assistant';
  return agent.startsWith('mcp:') ? agent.slice(4) : names[agent] || agent;
}

/** Every call the chat made, newest first: its work as the socket told it,
 *  and its model calls as the server counted them. */
export function activityRows(work: WorkEntry[], calls: ModelCall[], names: Record<string, string>,
                             now = Date.now()): ActivityRow[] {
  const fromWork = work.map((entry): ActivityRow => ({
    key: `w:${entry.id}`, at: time(entry.started), icon: ChatWorkComponent.KIND_ICONS[entry.kind || ''] ?? 'circle-dot',
    title: entry.title, by: workBy(entry, names), status: entry.status,
    took: took(entry.started, entry.ended, now), tokens: '', work: entry,
  }));
  const fromModel = calls.map((call, index): ActivityRow => ({
    key: `m:${index}:${call.at}`, at: time(call.at), icon: 'brain-circuit',
    title: PURPOSES[call.purpose] ?? `${agentName(call.agent, names)} asked its model`,
    by: call.model, status: 'done', took: call.latency_ms,
    tokens: `${tokens(call.input)} in · ${tokens(call.output)} out`, call,
  }));
  return [...fromWork, ...fromModel].sort((a, b) => b.at - a.at);
}

/** The records a piece of work touched, in words: "read mailbox · create notes". */
export function touchedWords(entry: WorkItem): string {
  return (entry.records ?? []).map((record) => `${record.operation} ${record.resource}`.trim()).join(' · ');
}

export function filterActivity(rows: ActivityRow[], filter: ActivityFilter): ActivityRow[] {
  switch (filter) {
    case 'model': return rows.filter((row) => row.call);
    case 'agents': return rows.filter((row) => row.work && isAgentCall(row.work));
    case 'failed': return rows.filter((row) => row.status === 'failed');
    default: return rows;
  }
}

// ── Overview ───────────────────────────────────────────────────────────

/** A number that matters, and the tab that tells the rest of it. */
export interface Tile {
  icon: string;
  value: string;
  label: string;
  tab: InspectorTab;
  filter?: ActivityFilter;
  warn?: boolean;
}

export function tilesOf(inspection: ChatInspection, work: WorkEntry[], now = Date.now()): Tile[] {
  const totals = inspection.usage.totals;
  const calls = work.filter(isAgentCall);
  const failed = calls.filter((entry) => entry.status === 'failed').length;
  const hosts = new Set(inspection.network.map((row) => row.host)).size;
  const refused = inspection.network.reduce((sum, row) => sum + row.refused, 0);
  const spans: [number, number][] = [
    ...work.map((entry): [number, number] => [time(entry.started), time(entry.started) + (took(entry.started, entry.ended, now) ?? 0)]),
    ...inspection.usage.calls.map((call): [number, number] => [time(call.at), time(call.at) + call.latency_ms]),
  ];
  return [
    { icon: 'arrow-right-left', value: `${tokens(totals.input)} / ${tokens(totals.output)}`, label: 'Tokens in / out',
      tab: 'activity', filter: 'model' },
    { icon: 'brain-circuit', value: tokens(totals.calls), label: 'Model calls', tab: 'activity', filter: 'model' },
    { icon: 'bot', value: String(calls.length), label: failed ? `Agent calls · ${failed} failed` : 'Agent calls',
      tab: 'activity', filter: failed ? 'failed' : 'agents', warn: failed > 0 },
    { icon: 'timer', value: duration(busyTime(spans)) || '0s', label: 'Time working', tab: 'activity' },
    { icon: 'paperclip', value: String(inspection.files.length), label: 'Files', tab: 'data' },
    { icon: 'globe', value: String(hosts), label: refused ? `Hosts reached · ${refused} refused` : 'Hosts reached',
      tab: 'runs', warn: refused > 0 },
  ];
}

/** A row of the token breakdown: whose, how much, and its share of all
 *  the tokens in and out, 0 to 100. */
export interface TokenShare {
  key: string;
  name: string;
  calls: number;
  input: number;
  output: number;
  cache_read: number;
  cache_write: number;
  reasoning: number;
  /** The mean time a call took, in milliseconds. */
  latency: number;
  share: number;
}

/** Rows with their share of the tokens they add up to, the largest first. */
function shares(rows: Omit<TokenShare, 'share'>[]): TokenShare[] {
  const total = rows.reduce((sum, row) => sum + row.input + row.output, 0);
  return rows.map((row) => ({ ...row, share: total ? Math.round(((row.input + row.output) / total) * 100) : 0 }))
    .sort((a, b) => b.input + b.output - (a.input + a.output));
}

/** The tokens by model: "azure · gpt-5.6-sol". */
export function byModel(usage: ChatUsage): TokenShare[] {
  return shares(usage.by_model.map((row) => ({
    key: `${row.provider}|${row.model}`, name: [row.provider, row.model].filter(Boolean).join(' · '),
    calls: row.calls, input: row.input, output: row.output, cache_read: row.cache_read, cache_write: row.cache_write,
    reasoning: row.reasoning, latency: row.calls ? row.latency_ms / row.calls : 0,
  })));
}

/** The tokens by agent: the assistant's own, and each agent's by name. */
export function byAgent(usage: ChatUsage, names: Record<string, string>): TokenShare[] {
  return shares(usage.by_agent.map((row) => ({
    key: row.agent, name: agentName(row.agent, names), calls: row.calls, input: row.input, output: row.output,
    cache_read: 0, cache_write: 0, reasoning: 0, latency: row.calls ? row.latency_ms / row.calls : 0,
  })));
}

/** The chat's next run: the soonest of its schedules that is on. */
export function nextRun(schedules: Schedule[]): Schedule | null {
  return schedules.filter((schedule) => !schedule.paused && schedule.next_at)
    .sort((a, b) => time(a.next_at) - time(b.next_at))[0] ?? null;
}

// ── Data ───────────────────────────────────────────────────────────────

const OPERATIONS: RecordOperation[] = ['read', 'list', 'create', 'update', 'delete'];

/** How a record was used: "read 3 · update 1". */
export function operationsWords(operations: RecordUse['operations']): string {
  return OPERATIONS.filter((op) => operations[op]).map((op) => `${op} ${operations[op]}`).join(' · ');
}

/** Where a record or secret is opened. */
export function recordLink(record: RecordUse): string[] {
  if (record.kind === 'secret') return ['/secrets', record.ref];
  if (record.kind === 'file') return ['/data/files', record.ref];
  return ['/data/records', record.agent, record.resource, record.ref];
}

// ── Setup: the cards it asked ──────────────────────────────────────────

/** What a card asked, in one line. */
export function cardQuestion(card: { kind: string; request: any; agent: string }, names: Record<string, string>):
    string {
  const request = card.request ?? {};
  switch (card.kind) {
    case 'approval': {
      const items: any[] = request.items ?? [];
      const what = items.map((item) => item.name || [agentName(item.agent, names), item.function].join(' · '));
      return what.length > 2 ? `${what.slice(0, 2).join(', ')} and ${what.length - 2} more` : what.join(', ') || 'A call';
    }
    case 'network': return `Reach ${(request.hosts ?? []).join(', ') || 'the network'}`;
    case 'question': return request.text || 'A question';
    case 'form': return request.label || request.resource || 'A form';
    case 'skill': return `Keep the skill ${request.skill?.name ?? ''}`.trim();
    case 'memory': return `Remember: ${request.text ?? ''}`;
    default: return card.kind;
  }
}

/** How the person answered: "Allowed", "2 of 3 allowed", "“yes”". */
export function answerWords(answer: any): string {
  if (!answer || typeof answer !== 'object') return '';
  if (answer.items && typeof answer.items === 'object') {
    const said = Object.values(answer.items);
    const yes = said.filter(Boolean).length;
    return yes === said.length ? 'Allowed' : yes ? `${yes} of ${said.length} allowed` : 'Declined';
  }
  if ('allowed' in answer) return answer.allowed ? 'Allowed' : 'Declined';
  if ('save' in answer) return answer.save ? 'Kept' : 'Not kept';
  if ('text' in answer) return `“${answer.text}”`;
  if ('choice' in answer) return `“${answer.choice}”`;
  if ('file' in answer) return 'Sent a file';
  if ('values' in answer) return 'Filled in';
  return 'Declined';
}

// ── Without AI:Chat:inspect ────────────────────────────────────────────

/** A file the page knows of, by its id. */
export interface KnownFileInfo {
  name: string;
  type?: string;
  size?: number;
}

/** What the page can tell of a chat on its own, for a server that has no
 *  AI:Chat:inspect: its work's files, records and MCP tools, and its
 *  schedules. Usage, processes and network stay empty. */
export function fallbackInspection(chat: { chat_id: string; settings: ChatSettings; working: boolean },
                                   work: WorkEntry[], known: Record<string, KnownFileInfo>,
                                   schedules: Schedule[], upcoming: UpcomingRun[]): ChatInspection {
  const produced = new Map<string, WorkEntry>();
  for (const entry of work) for (const id of entry.files ?? []) produced.set(id, entry);
  const files: ChatFile[] = [...new Set([...Object.keys(known), ...produced.keys()])].map((id) => ({
    record_id: id, name: known[id]?.name || 'A file', type: known[id]?.type || '', size: known[id]?.size || 0,
    origin: produced.has(id) ? 'produced' : 'attached', agent: produced.get(id)?.means?.agent ?? '',
    at: produced.get(id)?.ended ?? '',
  }));

  const records = new Map<string, RecordUse>();
  const mcp = new Map<string, McpUse>();
  for (const entry of work) {
    const at = entry.ended || entry.started || '';
    for (const touched of entry.records ?? []) {
      const key = `${touched.resource}|${touched.ref}`;
      const record = records.get(key) ?? { kind: 'data', agent: entry.means?.agent ?? '', resource: touched.resource,
                                            ref: touched.ref, label: '', operations: {}, last_at: at };
      const op = touched.operation as RecordOperation;
      if (OPERATIONS.includes(op)) record.operations[op] = (record.operations[op] ?? 0) + 1;
      if (at > record.last_at) record.last_at = at;
      records.set(key, record);
    }
    if (entry.kind === 'mcp' && entry.means?.server) {
      const key = `${entry.means.server}|${entry.means.tool ?? ''}`;
      const use = mcp.get(key) ?? { server: entry.means.server, tool: entry.means.tool ?? '', calls: 0, last_at: at };
      use.calls += 1;
      if (at > use.last_at) use.last_at = at;
      mcp.set(key, use);
    }
  }

  return wholeInspection({
    chat: { chat_id: chat.chat_id, title: '', created_at: '', updated_at: '', settings: chat.settings,
            working: chat.working, runtime: null, last_runtime: null },
    files, records: [...records.values()], mcp: [...mcp.values()], schedules: { chat: schedules, upcoming },
  });
}

/** The person's next runs in their other chats, soonest first, at most 20. */
export function upcomingElsewhere(all: Schedule[], chatId: string, titles: Record<string, string>): UpcomingRun[] {
  return all.filter((schedule) => schedule.chat_id !== chatId && !schedule.paused && schedule.next_at)
    .sort((a, b) => time(a.next_at) - time(b.next_at)).slice(0, 20)
    .map((schedule) => ({ ...schedule, chat_title: titles[schedule.chat_id] ?? '' }));
}
