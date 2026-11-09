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
  trust: 1, agents: null, model: '', effort: '', time_zone: 'UTC', turn_budget: 0, skills: null, mcp_servers: null,
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
}

/** What each kind of card asks. */
export interface ApprovalRequest { function: string; level?: number; call?: string; record?: string; }
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
  | { allowed: boolean; remember?: boolean }
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
  status: 'running' | 'done' | 'failed' | 'stopped';
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
  | { event: 'progress'; data: { agent: string; call: string; line: string } }
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
