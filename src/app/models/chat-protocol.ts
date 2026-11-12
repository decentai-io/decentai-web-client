// A chat as the API server keeps it and tells it (api-server.md §7, mind.md §8, runtime.md §8): the
// chat and its settings, its messages, its cards, and its live events over the socket `/chats/<id>`.

/** A chat's settings: one table. Its agents, skills and MCP servers are
 *  `null` for all of those the person may use, now and later, or a list
 *  of those alone: `[]` is none. */
export interface ChatSettings {
  /** 0 to 3: the level up to which agents act without asking. */
  trust: 0 | 1 | 2 | 3;
  /** The agents it uses, by id. */
  agents: string[] | null;
  /** The model connection its assistant uses; '' for the organization's
   *  default. */
  model: string;
  /** Which of the connection's models; '' for its first. */
  model_id: string;
  effort: '' | 'low' | 'medium' | 'high';
  /** For its schedules. */
  time_zone: string;
  /** The assistant's turn budget; 0 for none. */
  turn_budget: number;
  /** The skills and MCP servers its assistant uses, by id. */
  skills: string[] | null;
  mcp_servers: string[] | null;
}

export const DEFAULT_CHAT_SETTINGS: ChatSettings = {
  trust: 1, agents: null, model: '', model_id: '', effort: '', time_zone: 'UTC', turn_budget: 0, skills: null,
  mcp_servers: null,
};

/** A chat (`Chats.public`). */
export interface Chat {
  chat_id: string;
  title: string;
  /** The start of its last words. */
  preview: string;
  settings: ChatSettings;
  archived: boolean;
  /** Its assistant is busy. */
  working: boolean;
  /** A runtime holds it. */
  held: boolean;
  /** The webhook it is the chat of, or ''. */
  webhook: string;
  created_at: string;
  updated_at: string;
  /** In a list: how many cards wait in it. */
  waiting?: number;
}

/** A table an agent shows: at most 24 columns and 500 rows. */
export interface AgentTable {
  title?: string;
  columns: string[];
  rows: unknown[][];
}

/** A chart an agent shows. */
export interface AgentChart {
  title?: string;
  type: 'bar' | 'line' | 'pie';
  labels: string[];
  series: { name: string; values: number[] }[];
}

/** One part of a message. */
export type MessagePart =
  | { type: 'text'; text: string }
  /** An agent's own words or visuals, shown through `chat`. */
  | { type: 'agent'; agent: string; text?: string; table?: AgentTable; chart?: AgentChart; choices?: string[] }
  /** What a webhook brought: its instruction and its data. */
  | { type: 'webhook'; text: string; data: unknown; test?: boolean };

/** The schedule's or webhook's run a message or a piece of work belongs to:
 *  its thread, `schedule:<id>` or `webhook`, its name, and the webhook's
 *  message that began it (0 for none). */
export interface RunInfo {
  thread: string;
  origin: string;
  title: string;
  message: number;
}

/** One message (`Messages.public`). */
export interface ChatMessage {
  message_id: string;
  /** Its place in the chat. */
  seq: number;
  actor: 'person' | 'assistant' | 'webhook';
  parts: MessagePart[];
  /** Record ids of files, downloadable at `/download/<id>`. */
  files: string[];
  /** The id the page gave what it sent, kept on the message. */
  client_id: string;
  at: string;
  /** The model that wrote it, for the assistant's. */
  model?: string;
  /** The run that posted it, for a schedule's or webhook's. */
  run?: RunInfo;
}

/** What each kind of card asks. An approval asks for the calls of one step
 *  of the assistant at once, each an item the person allows or not; `why`
 *  is what the assistant said as it made them. */
export interface ApprovalItem {
  id: string;
  agent: string;
  function: string;
  /** The agent's and the function's names, as a person reads them. */
  name?: string;
  level?: number;
  /** What a program's call reaches through the runtime, as `record.read:logins`. */
  call?: string;
  record?: string;
  /** The inputs, written out. */
  inputs?: string;
}
export interface ApprovalRequest { items: ApprovalItem[]; why?: string; }
export interface NetworkRequest { hosts: string[]; purpose: string; code?: { language: string; text: string }; }
export interface QuestionRequest {
  text?: string; table?: AgentTable; chart?: AgentChart; choices?: string[];
  expects: 'text' | 'choice' | 'file';
}
/** A form a secret's resource declares: its empty fields, a `form`
 *  field's questions, or an account to connect. */
export interface FormRequest {
  record: string;
  resource: string;
  label: string;
  fields: { name: string; label?: string; type: string; required?: boolean; options?: string[] }[];
  /** For a `form` field: its questions, each text or secret, remembered
   *  or not, and a value where the agent gave one. */
  questions: Record<string, Record<string, { type: 'text' | 'secret'; remember?: boolean; value?: string }>>;
  /** The resource connects an account through its provider. */
  connect: boolean;
}
export interface SkillRequest { skill: { name: string; description: string; text: string }; }
export interface MemoryRequest { text: string; }

/** A card (`Cards.public`): what a chat asks its person, and only them. */
export type Card = {
  card_id: string;
  chat_id: string;
  /** The agent's call it waits in, and the agent; '' for the assistant's own. */
  call: string;
  agent: string;
  status: 'open' | 'answered' | 'expired';
  at: string;
  /** What its person answered, once they have. */
  answer?: unknown;
} & (
  | { kind: 'approval'; request: ApprovalRequest }
  | { kind: 'network'; request: NetworkRequest }
  | { kind: 'question'; request: QuestionRequest }
  | { kind: 'form'; request: FormRequest }
  | { kind: 'skill'; request: SkillRequest }
  | { kind: 'memory'; request: MemoryRequest }
);

/** How each kind of card is answered (AI:Approval:decide). */
export type CardAnswer =
  /** An approval: each item allowed or not, by its id; remembered where the
   *  person says, for that agent, function and record. */
  | { items: Record<string, boolean>; remember?: boolean }
  | { allowed: boolean }
  | { text: string }
  | { choice: string }
  | { file: string }
  | { values: Record<string, unknown> }
  | { save: boolean }
  /** A question declined: the agent hears `null`. */
  | Record<string, never>;

/** One call or task of the assistant, as it starts and as it ends. */
export interface WorkItem {
  id: string;
  title: string;
  /** `waiting`: for the person's answer; `unknown`: a restart cut it, and it
   *  may have been done. */
  status: 'running' | 'waiting' | 'done' | 'failed' | 'stopped' | 'unknown';
  /** `call` (an agent's function), `mcp`, `task`, `question`, `sleep`,
   *  `schedule`, `memory` or `skill`. */
  kind?: string;
  /** `person`, `schedule:<id>` or `webhook`. */
  origin?: string;
  /** The thread it began in: '' the chat's own, a task's id, or a run's. */
  thread?: string;
  run?: RunInfo | null;
  means?: { agent?: string; function?: string; server?: string; tool?: string };
  /** The assistant's words as it began it. */
  why?: string;
  /** Its inputs, cut. */
  inputs?: string | null;
  /** The card it waited on. */
  card?: string;
  started?: string;
  ended?: string;
  /** Its output's size and first line; `ref` reads it whole. */
  output?: { size: number; line: string; ref?: string } | null;
  /** The files it returned. */
  files?: string[];
  /** The records its program touched. */
  records?: { operation: string; resource: string; ref: string }[];
}

/** What one thread of the assistant is doing now: `thinking`, `folding`, or
 *  '' (its work says the rest), and the turn's step and budget. */
export interface Doing {
  thread: string;
  kind: 'chat' | 'task' | 'run';
  run: RunInfo | null;
  what: '' | 'thinking' | 'folding';
  step: number;
  budget: number;
  at: string;
}

/** An agent's screen: a picture of what it drives, and its tabs. */
export interface Screen {
  image: string;
  width: number;
  height: number;
  tabs: { index: number; title?: string; address?: string; active?: boolean }[];
}

/** What a chat's open answers with (AI:Chat:open). */
export interface ChatSnapshot {
  chat: Chat;
  /** Its last 50 messages, oldest first. */
  messages: ChatMessage[];
  /** The cards still open. */
  cards: Card[];
  /** The number of its last event: the socket replays from there. */
  events: number;
  /** The live socket's path. */
  socket: string;
}

/** One live event, as the socket sends it (`Events.public`). */
export type ChatEvent = { seq: number; at: string } & (
  | { event: 'message'; data: ChatMessage }
  | { event: 'working'; data: Record<string, never> }
  | { event: 'idle'; data: Record<string, never> }
  | { event: 'work'; data: WorkItem }
  /** Words the assistant wrote since the last; never replayed. */
  | { event: 'saying'; data: { text: string } }
  | { event: 'progress'; data: { agent: string; call: string; line: string; work?: string } }
  | { event: 'doing'; data: Doing }
  | { event: 'settings_changed'; data: { changes: Partial<ChatSettings> } }
  /** Never replayed; `screen: null` closes it. */
  | { event: 'screen'; data: { agent: string; call: string; screen: Screen | null } }
  | { event: 'card_opened'; data: Card }
  | { event: 'card_closed'; data: { card_id: string } }
  | { event: 'stopped'; data: Record<string, never> }
  | { event: 'runtime_unavailable'; data: Record<string, never> }
  | { event: 'schedule_added'; data: { schedule_id: string; what: { prompt?: string; function?: string } } }
  | { event: 'schedule_ran'; data: { schedule_id: string; at: string; failed: boolean; summary: string } }
);

/** An event, from a frame of the socket; null for anything else (the
 *  answer to something the page sent over it, or a refusal of it). */
export function parseFrame(raw: string): ChatEvent | null {
  try {
    const frame = JSON.parse(raw);
    return frame && typeof frame.event === 'string' && typeof frame.seq === 'number'
      ? { ...frame, data: frame.data ?? {} } as ChatEvent : null;
  } catch {
    return null;
  }
}
