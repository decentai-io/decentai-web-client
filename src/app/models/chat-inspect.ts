// Everything about one chat, as AI:Chat:inspect answers it (the chat
// inspector's contract): what it cost, what ran it, where it reached, what
// it touched and asked, and its schedules. Names, refs and counts only:
// never a secret's or a record's value. Live work comes from the socket.
import type { Schedule } from '../services/activity.service';
import { Card, ChatSettings } from './chat-protocol';

/** Tokens and time, as one model call or a sum of them says them. */
export interface TokenCount {
  calls: number;
  input: number;
  output: number;
  cache_read: number;
  cache_write: number;
  reasoning: number;
  latency_ms: number;
}

/** One call to a model: for the assistant's own thought (`agent` ''), a
 *  summary that folds the conversation, or an agent's. Newest first. */
export interface ModelCall extends Omit<TokenCount, 'calls'> {
  at: string;
  agent: string;
  provider: string;
  model: string;
  purpose: 'thought' | 'fold' | 'agent' | string;
}

export interface ChatUsage {
  totals: TokenCount;
  by_model: (TokenCount & { provider: string; model: string })[];
  by_agent: (Pick<TokenCount, 'calls' | 'input' | 'output' | 'latency_ms'> & { agent: string })[];
  /** At most 200. */
  calls: ModelCall[];
}

/** One process an agent ran in a sandbox for the chat. */
export interface ChatProcess {
  process: string;
  agent: string;
  version: string;
  runtime: string;
  sandbox: string;
  machine: string;
  started_at: string;
  /** null: it still runs. */
  ended_at: string | null;
  reason: string;
  detail: string;
  memory_peak: number | null;
  cpu_seconds: number | null;
}

/** Where an agent reached, by host and port: busiest first. */
export interface NetworkUse {
  agent: string;
  host: string;
  port: number;
  connections: number;
  refused: number;
  bytes_out: number;
  bytes_in: number;
  first_at: string;
  last_at: string;
}

/** A card of the chat, open or answered, as it was asked and answered. */
export type InspectedCard = Pick<Card, 'card_id' | 'kind' | 'agent' | 'call' | 'status' | 'at'> & {
  request: any;
  answer: any;
  answered_at: string | null;
};

export interface SkillUse {
  skill_id: string;
  name: string;
  times: number;
  last_at: string;
}

export interface McpUse {
  server: string;
  tool: string;
  calls: number;
  last_at: string;
}

/** A file attached to its messages, or one its calls produced. */
export interface ChatFile {
  record_id: string;
  name: string;
  type: string;
  size: number;
  origin: 'attached' | 'produced';
  agent: string;
  at: string;
}

export type RecordOperation = 'read' | 'list' | 'create' | 'update' | 'delete';

/** A record or secret its agents read or wrote, with how often. */
export interface RecordUse {
  kind: 'secret' | 'data' | 'file';
  agent: string;
  resource: string;
  ref: string;
  label: string;
  operations: Partial<Record<RecordOperation, number>>;
  last_at: string;
}

/** A run due in another chat of the person's. */
export type UpcomingRun = Schedule & { chat_title: string };

export interface ChatInspection {
  chat: {
    chat_id: string;
    title: string;
    created_at: string;
    updated_at: string;
    settings: ChatSettings;
    working: boolean;
    /** The runtime holding it now, and since when. */
    runtime: { id: string; since: string } | null;
    /** The one that held it last, when none does now. */
    last_runtime: string | null;
  };
  usage: ChatUsage;
  processes: ChatProcess[];
  network: NetworkUse[];
  cards: InspectedCard[];
  skills: SkillUse[];
  mcp: McpUse[];
  files: ChatFile[];
  records: RecordUse[];
  schedules: { chat: Schedule[]; upcoming: UpcomingRun[] };
  /** How many of the person's memories its prompts carry. */
  memories: number;
}

export const NO_TOKENS: TokenCount = {
  calls: 0, input: 0, output: 0, cache_read: 0, cache_write: 0, reasoning: 0, latency_ms: 0,
};

/** An answer made whole: a list or a number it left out is empty, so a
 *  newer or older server's answer is read the same way. */
export function wholeInspection(answer: Partial<ChatInspection> | null | undefined): ChatInspection {
  const list = <T>(value: T[] | undefined): T[] => (Array.isArray(value) ? value : []);
  const usage: Partial<ChatUsage> = answer?.usage ?? {};
  const chat: Partial<ChatInspection['chat']> = answer?.chat ?? {};
  return {
    chat: {
      chat_id: chat.chat_id ?? '', title: chat.title ?? '', created_at: chat.created_at ?? '',
      updated_at: chat.updated_at ?? '', settings: chat.settings as ChatSettings, working: !!chat.working,
      runtime: chat.runtime ?? null, last_runtime: chat.last_runtime ?? null,
    },
    usage: {
      totals: { ...NO_TOKENS, ...usage.totals },
      by_model: list(usage.by_model), by_agent: list(usage.by_agent), calls: list(usage.calls),
    },
    processes: list(answer?.processes),
    network: list(answer?.network),
    cards: list(answer?.cards),
    skills: list(answer?.skills),
    mcp: list(answer?.mcp),
    files: list(answer?.files),
    records: list(answer?.records),
    schedules: { chat: list(answer?.schedules?.chat), upcoming: list(answer?.schedules?.upcoming) },
    memories: Number(answer?.memories) || 0,
  };
}
