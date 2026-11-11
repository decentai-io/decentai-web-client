import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';

import { Card, ChatEvent, ChatMessage, ChatSnapshot, WorkItem } from 'src/app/models/chat-protocol';

/** A message of the person, or a webhook's, and what the assistant said
 *  after it, until the next. None when the assistant spoke first: a
 *  schedule's run. */
export interface ChatTurn {
  /** The person's message's own id, or the id the page gave it while it
   *  was on its way; the first message's for a turn nobody here began. */
  key: string;
  userMessage: ChatMessage | null;
  assistantMessages: ChatMessage[];
}

/** One line of a turn's work: a call or task of the assistant with how
 *  it stands, an agent's latest word on its call, or a note of the
 *  page's own. */
export interface WorkStep {
  id: string;
  text: string;
  /** For the assistant's calls and tasks: how it stands, and its id, which
   *  stops it alone. */
  status?: WorkItem['status'];
  work?: string;
  /** Whose words: an agent's line. */
  agent?: string;
  /** Where it leads, when what it made has a page of its own. */
  link?: { text: string; to: string };
}

export interface InlineChatError {
  id: number;
  scope: 'connection' | 'composer' | 'assistant' | 'approval';
  code: string;
  message: string;
  retryable: boolean;
}

/** The page's view of one conversation. */
export interface ChatViewState {
  loading: boolean;
  messages: ChatMessage[];
  turns: ChatTurn[];
  /** The cards still open. */
  cards: Card[];
  /** The assistant is busy: from `working` to `idle`. */
  working: boolean;
  /** Each turn's work, by the turn's key. */
  steps: Record<string, WorkStep[]>;
  /** The words the assistant is writing, before its message lands. */
  saying: string;
  /** The number of the last event taken. */
  latestEventSeq: number;
  errors: InlineChatError[];
}

const initialState = (): ChatViewState => ({
  loading: true, messages: [], turns: [], cards: [], working: false, steps: {}, saying: '',
  latestEventSeq: 0, errors: [],
});

/** The id a message is shown under while it is on its way. */
const PENDING = 'pending:';

@Injectable({ providedIn: 'root' })
export class ChatStateService {
  readonly state$ = new BehaviorSubject<ChatViewState>(initialState());
  private errorId = 0;
  private noteId = 0;

  get value(): ChatViewState { return this.state$.value; }

  reset(): void {
    this.state$.next(initialState());
  }

  /** The chat as AI:Chat:open read it. What the page already holds of
   *  it stays — messages it has that the snapshot's page does not, and
   *  the work it watched — so reading it again loses nothing. */
  load(snapshot: ChatSnapshot): void {
    const known = new Set(snapshot.messages.flatMap((message) =>
      [message.message_id, ...(message.client_id ? [PENDING + message.client_id] : [])]));
    const kept = this.value.loading ? [] : this.value.messages.filter((message) => !known.has(message.message_id));
    const messages = this.sorted([...snapshot.messages, ...kept]);
    this.patch({
      loading: false, messages, turns: this.buildTurns(messages), cards: snapshot.cards,
      working: snapshot.chat.working, saying: snapshot.chat.working ? this.value.saying : '',
      latestEventSeq: Math.max(this.value.latestEventSeq, snapshot.events),
    });
  }

  /** How an event stands against what the page took. The events a chat
   *  keeps are numbered without gaps: the next one is taken, one taken
   *  already, replayed, is not taken twice, and one past the next says
   *  some were missed (`gap`). `saying` and `screen` are never kept, and
   *  carry the number of the last kept event before them: they come
   *  another way than kept events, so one older than a kept event the page
   *  took already arrived late, and is skipped. */
  sequence(event: ChatEvent): 'take' | 'skip' | 'gap' {
    const latest = this.value.latestEventSeq;
    if (event.event === 'saying' || event.event === 'screen') return event.seq < latest ? 'skip' : 'take';
    if (event.seq <= latest) return 'skip';
    if (event.seq > latest + 1) return 'gap';
    this.patch({ latestEventSeq: event.seq });
    return 'take';
  }

  /** The person's words go up at once, under the id the page gave them;
   *  the server's message takes their place when it lands. */
  startSubmission(clientId: string, text: string, files: string[]): void {
    const pending: ChatMessage = {
      message_id: `${PENDING}${clientId}`, seq: Number.MAX_SAFE_INTEGER, actor: 'person',
      parts: [{ type: 'text', text }], files, client_id: clientId, at: new Date().toISOString(),
    };
    const messages = [...this.value.messages, pending];
    this.patch({ messages, turns: this.buildTurns(messages), working: true });
    this.clearErrors('composer');
  }

  /** The send never got through: the words are taken back rather than
   *  left on screen as though they had been heard. */
  dropSubmission(clientId: string): void {
    const messages = this.value.messages.filter((message) => message.message_id !== `${PENDING}${clientId}`);
    if (messages.length !== this.value.messages.length) {
      this.patch({ messages, turns: this.buildTurns(messages), working: false });
    }
  }

  /** A message: new, or one the page showed while it was on its way. An
   *  assistant's message ends the words being written. */
  addMessage(message: ChatMessage): void {
    const messages = this.sorted([...this.value.messages.filter((held) => held.message_id !== message.message_id
      && !(message.client_id && held.message_id === `${PENDING}${message.client_id}`)), message]);
    this.patch({
      messages, turns: this.buildTurns(messages), ...(message.actor === 'assistant' ? { saying: '' } : {}),
    });
  }

  /** Older messages, read on the person's asking, before the rest. */
  addOlder(older: ChatMessage[]): void {
    const known = new Set(this.value.messages.map((message) => message.message_id));
    const messages = this.sorted([...older.filter((message) => !known.has(message.message_id)), ...this.value.messages]);
    this.patch({ messages, turns: this.buildTurns(messages) });
  }

  /** The assistant got busy, or quiet. Quiet, what it was writing is
   *  either in its message by now or was never to be. */
  setWorking(working: boolean): void {
    this.patch(working ? { working } : { working, saying: '' });
  }

  /** Words the assistant wrote since the last. */
  addSaying(text: string): void {
    if (text) this.patch({ saying: this.value.saying + text });
  }

  /** A call or task of the assistant, as it starts or ends. */
  work(item: WorkItem): void {
    this.step({ id: `work:${item.id}`, text: item.title, status: item.status, work: item.id });
  }

  /** An agent's line on its call: the call's latest word. */
  progress(agent: string, call: string, line: string): void {
    if (line) this.step({ id: `call:${call}`, text: line, agent });
  }

  /** A note of the page's own in the turn's work. */
  note(text: string, link?: WorkStep['link']): void {
    if (text) this.step({ id: `note:${++this.noteId}`, text, link });
  }

  addCard(card: Card): void {
    if (card.status !== 'open' || this.value.cards.some((held) => held.card_id === card.card_id)) return;
    this.patch({ cards: [...this.value.cards, card] });
  }

  closeCard(cardId: string): void {
    const cards = this.value.cards.filter((card) => card.card_id !== cardId);
    if (cards.length !== this.value.cards.length) this.patch({ cards });
  }

  /** The chat's work was stopped: nothing runs, and its cards expired. */
  stopped(): void {
    this.patch({ working: false, saying: '', cards: [] });
    this.note('Stopped.');
  }

  addError(scope: InlineChatError['scope'], code: string, message: string, retryable = false): void {
    const duplicate = this.value.errors.some((error) =>
      error.scope === scope && error.code === code && error.message === message);
    if (duplicate) return;
    this.patch({ errors: [...this.value.errors, { id: ++this.errorId, scope, code, message, retryable }] });
  }

  dismissError(id: number): void {
    this.patch({ errors: this.value.errors.filter((error) => error.id !== id) });
  }

  clearErrors(scope?: InlineChatError['scope']): void {
    this.patch({ errors: scope ? this.value.errors.filter((error) => error.scope !== scope) : [] });
  }

  private patch(changes: Partial<ChatViewState>): void {
    this.state$.next({ ...this.value, ...changes });
  }

  /** A step goes to the turn in hand; one already there by its id is
   *  told again in place. */
  private step(step: WorkStep): void {
    const key = this.value.turns[this.value.turns.length - 1]?.key ?? '';
    const steps = this.value.steps[key] || [];
    const at = steps.findIndex((held) => held.id === step.id);
    const next = at >= 0 ? steps.map((held, index) => (index === at ? { ...held, ...step } : held))
      : [...steps.slice(-199), step];
    this.patch({ steps: { ...this.value.steps, [key]: next } });
  }

  /** In the chat's one order; one on its way last. */
  private sorted(messages: ChatMessage[]): ChatMessage[] {
    return messages.sort((a, b) => a.seq - b.seq);
  }

  /** Turns are a reading aid, not a record: a person's or a webhook's
   *  message and what the assistant said after it. What it said before
   *  anyone spoke is a turn of its own with no such message. A message on its way is known
   *  by the id the page gave it, so its turn keeps its key, and its
   *  work, when the server's message takes its place. */
  private buildTurns(messages: ChatMessage[]): ChatTurn[] {
    const turns: ChatTurn[] = [];
    for (const message of messages) {
      if (message.actor !== 'assistant') {
        turns.push({ key: message.client_id || message.message_id, userMessage: message, assistantMessages: [] });
      } else {
        if (!turns.length) turns.push({ key: message.message_id, userMessage: null, assistantMessages: [] });
        turns[turns.length - 1].assistantMessages.push(message);
      }
    }
    return turns;
  }
}
