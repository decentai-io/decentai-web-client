import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';

import {
  Card, CardClosed, ChatEvent, ChatMessage, ChatSettings, ChatSnapshot, Doing, RunInfo, WorkItem,
} from 'src/app/models/chat-protocol';
import { AnsweredCard, answeredCard } from 'src/app/pages/app/ai/chat/chat-answers';
import { TRUST_CHOICES } from 'src/app/pages/app/ai/chat/chat-defaults';

/** A piece of the assistant's work as last told, with its agent's latest
 *  word on it. */
export interface WorkEntry extends WorkItem {
  line?: string;
}

/** A message of the person's or a webhook's, or a card they answered, the
 *  work it led to and what the assistant said after it; or a schedule's or
 *  webhook's run, with its work and its report (`run`). None began a turn
 *  the assistant spoke first in. */
export interface ChatTurn {
  key: string;
  /** When it began. */
  at: string;
  userMessage: ChatMessage | null;
  /** The card whose answer began it. */
  answer: AnsweredCard | null;
  run: RunInfo | null;
  assistantMessages: ChatMessage[];
  work: WorkEntry[];
}

/** Something that happened in the chat besides its messages and work. */
export interface ChatNote {
  id: string;
  at: string;
  icon: string;
  text: string;
  link?: { text: string; to: string };
}

/** The conversation as it is read: turns and notes, by time. */
export type TimelineItem = { kind: 'turn'; turn: ChatTurn } | { kind: 'note'; note: ChatNote };

export interface InlineChatError {
  id: number;
  scope: 'connection' | 'composer' | 'assistant' | 'approval';
  code: string;
  message: string;
  retryable: boolean;
}

/** A card as its events told it: opened with its request, closed with its answer. */
export interface AskedCard {
  card?: Card;
  closed?: CardClosed & { at: string };
}

/** The page's view of one conversation. */
export interface ChatViewState {
  loading: boolean;
  messages: ChatMessage[];
  turns: ChatTurn[];
  timeline: TimelineItem[];
  /** The cards still open. */
  cards: Card[];
  /** The assistant is busy: from `working` to `idle`. */
  working: boolean;
  /** The assistant's work, by id, as last told. */
  work: Record<string, WorkEntry>;
  /** What each of its threads is doing, by thread: '' the chat's own. */
  doing: Record<string, Doing>;
  notes: ChatNote[];
  /** Every card the page has heard of, by id: what it asked, and how it
   *  closed once it has. */
  asked: Record<string, AskedCard>;
  /** The words the assistant is writing, before its message lands. */
  saying: string;
  /** The number of the last event taken. */
  latestEventSeq: number;
  errors: InlineChatError[];
}

const initialState = (): ChatViewState => ({
  loading: true, messages: [], turns: [], timeline: [], cards: [], working: false, work: {}, doing: {}, notes: [],
  asked: {}, saying: '', latestEventSeq: 0, errors: [],
});

/** The id a message is shown under while it is on its way. */
const PENDING = 'pending:';
/** How far ahead of a message work may seem to begin and still be its: the
 *  runtime's clock and the API server's are not one. */
const SKEW_MS = 2000;

const time = (at: string | undefined): number => Date.parse(at || '') || 0;

@Injectable({ providedIn: 'root' })
export class ChatStateService {
  readonly state$ = new BehaviorSubject<ChatViewState>(initialState());
  private errorId = 0;

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
    this.patch({
      loading: false, messages: this.sorted([...snapshot.messages, ...kept]), cards: snapshot.cards,
      asked: snapshot.cards.reduce((asked, card) => this.ask(asked, card.card_id, { card }), this.value.asked),
      working: snapshot.chat.working, saying: snapshot.chat.working ? this.value.saying : '',
      latestEventSeq: Math.max(this.value.latestEventSeq, snapshot.events),
    });
  }

  /** How an event stands against what the page took. The events a chat
   *  keeps are numbered without gaps: the next one is taken, one taken
   *  already, replayed, is not taken twice, and one past the next says
   *  some were missed (`gap`). What only passes (`saying`, `doing`,
   *  `screen`) is never kept, and carries the number of the last kept
   *  event before it: one older than a kept event the page took already
   *  arrived late, and is skipped. */
  sequence(event: ChatEvent): 'take' | 'skip' | 'gap' {
    const latest = this.value.latestEventSeq;
    if (['saying', 'doing', 'screen'].includes(event.event)) return event.seq < latest ? 'skip' : 'take';
    if (event.seq <= latest) return 'skip';
    if (event.seq > latest + 1) return 'gap';
    this.patch({ latestEventSeq: event.seq });
    return 'take';
  }

  /** The kept events read back as the chat opens: its work, and what
   *  happened besides, as they were before the page was. */
  replay(events: ChatEvent[]): void {
    for (const event of events) this.remember(event);
  }

  /** What an event leaves in the conversation: a piece of work, an agent's
   *  line on its call, a card asked or closed, or a note. Taken twice, it
   *  is there once. */
  remember(event: ChatEvent): void {
    if (event.event === 'work') return this.work(event.data);
    if (event.event === 'progress') return this.progress(event.data.work, event.data.line);
    if (event.event === 'card_opened') {
      return this.patch({ asked: this.ask(this.value.asked, event.data.card_id, { card: event.data }) });
    }
    if (event.event === 'card_closed') {
      const closed = { ...event.data, at: event.data.at || event.at };
      return this.patch({ asked: this.ask(this.value.asked, event.data.card_id, { closed }) });
    }
    const note = this.noteOf(event);
    if (note && !this.value.notes.some((held) => held.id === note.id)) {
      this.patch({ notes: [...this.value.notes, note].sort((a, b) => time(a.at) - time(b.at)) });
    }
  }

  /** The person's words go up at once, under the id the page gave them;
   *  the server's message takes their place when it lands. */
  startSubmission(clientId: string, text: string, files: string[]): void {
    const pending: ChatMessage = {
      message_id: `${PENDING}${clientId}`, seq: Number.MAX_SAFE_INTEGER, actor: 'person',
      parts: [{ type: 'text', text }], files, client_id: clientId, at: new Date().toISOString(),
    };
    this.patch({ messages: [...this.value.messages, pending], working: true });
    this.clearErrors('composer');
  }

  /** The send never got through: the words are taken back rather than
   *  left on screen as though they had been heard. */
  dropSubmission(clientId: string): void {
    const messages = this.value.messages.filter((message) => message.message_id !== `${PENDING}${clientId}`);
    if (messages.length !== this.value.messages.length) this.patch({ messages, working: false });
  }

  /** A message: new, or one the page showed while it was on its way. An
   *  assistant's message ends the words being written. */
  addMessage(message: ChatMessage): void {
    const messages = this.sorted([...this.value.messages.filter((held) => held.message_id !== message.message_id
      && !(message.client_id && held.message_id === `${PENDING}${message.client_id}`)), message]);
    this.patch({ messages, ...(message.actor === 'assistant' && !message.run ? { saying: '' } : {}) });
  }

  /** Older messages, read on the person's asking, before the rest. */
  addOlder(older: ChatMessage[]): void {
    const known = new Set(this.value.messages.map((message) => message.message_id));
    this.patch({ messages: this.sorted([...older.filter((message) => !known.has(message.message_id)),
      ...this.value.messages]) });
  }

  /** The assistant got busy, or quiet. Quiet, what it was writing is
   *  either in its message by now or was never to be, and none of its
   *  threads is doing anything. */
  setWorking(working: boolean): void {
    this.patch(working ? { working } : { working, saying: '', doing: {} });
  }

  /** Words the assistant wrote since the last. */
  addSaying(text: string): void {
    if (text) this.patch({ saying: this.value.saying + text });
  }

  /** What one of the assistant's threads is doing now. */
  setDoing(doing: Doing): void {
    this.patch({ doing: { ...this.value.doing, [doing.thread]: doing } });
  }

  /** A piece of the assistant's work, as it begins, waits, ends, and has
   *  its output kept: told again in place. */
  work(item: WorkItem): void {
    const held = this.value.work[item.id];
    this.patch({ work: { ...this.value.work, [item.id]: { ...held, ...item } } });
  }

  /** An agent's latest word on its call, under the work it is. */
  progress(work: string | undefined, line: string): void {
    const held = work ? this.value.work[work] : undefined;
    if (held && line) this.patch({ work: { ...this.value.work, [held.id]: { ...held, line } } });
  }

  addCard(card: Card): void {
    if (card.status !== 'open' || this.value.cards.some((held) => held.card_id === card.card_id)) return;
    this.patch({ cards: [...this.value.cards, card], asked: this.ask(this.value.asked, card.card_id, { card }) });
  }

  closeCard(cardId: string): void {
    const cards = this.value.cards.filter((card) => card.card_id !== cardId);
    if (cards.length !== this.value.cards.length) this.patch({ cards });
  }

  /** The chat's work was stopped: nothing runs, and its cards expired. */
  stopped(): void {
    this.patch({ working: false, saying: '', doing: {}, cards: [] });
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

  /** The changes, and the turns and the timeline again where the messages,
   *  the work, the notes or the cards changed. */
  private patch(changes: Partial<ChatViewState>): void {
    const next = { ...this.value, ...changes };
    if ('messages' in changes || 'work' in changes || 'notes' in changes || 'asked' in changes) {
      const answered = Object.values(next.asked).flatMap(({ card, closed }) => (closed ? [answeredCard(closed, card)] : []));
      next.turns = this.buildTurns(next.messages, Object.values(next.work), answered);
      next.timeline = this.buildTimeline(next.turns, next.notes);
    }
    this.state$.next(next);
  }

  /** What is held of a card, with more told of it. */
  private ask(asked: Record<string, AskedCard>, cardId: string, told: AskedCard): Record<string, AskedCard> {
    return { ...asked, [cardId]: { ...asked[cardId], ...told } };
  }

  /** In the chat's one order; one on its way last. */
  private sorted(messages: ChatMessage[]): ChatMessage[] {
    return messages.sort((a, b) => a.seq - b.seq);
  }

  /** Turns are a reading aid, not a record. A person's or a webhook's
   *  message begins one, and the assistant's words after it are its, a
   *  webhook's run's on the webhook's own. So does a card the person
   *  answered, where it closed: what the assistant said before it and
   *  after it are two answers, the person's decision the border between
   *  them. A schedule's run is a turn of its own, by its thread. Work goes
   *  to its run, or else to the turn it began in, by time. A message on
   *  its way keeps the key the page gave it, and its work with it, when
   *  the server's message takes its place. */
  private buildTurns(messages: ChatMessage[], work: WorkEntry[], answered: AnsweredCard[]): ChatTurn[] {
    const turns: ChatTurn[] = [];
    const runs = new Map<string, ChatTurn>();
    const bySeq = new Map<number, ChatTurn>();
    const added = (key: string, at: string, userMessage: ChatMessage | null): ChatTurn => {
      const made: ChatTurn = { key, at, userMessage, answer: null, run: null, assistantMessages: [], work: [] };
      turns.push(made);
      return made;
    };
    const ofRun = (run: RunInfo, at: string): ChatTurn => {
      const webhook = run.message ? bySeq.get(run.message) : undefined;
      if (webhook) return webhook;
      let held = runs.get(run.thread);
      if (!held) {
        held = { key: `run:${run.thread}`, at, userMessage: null, answer: null, run, assistantMessages: [], work: [] };
        runs.set(run.thread, held);
      } else if (at && time(at) < time(held.at)) {
        held.at = at;
      }
      return held;
    };
    /** The chat's own turns: not a webhook's, whose run speaks for it. */
    const chatTurns = (): ChatTurn[] => turns.filter((one) => one.userMessage?.actor !== 'webhook');
    // Cards closed before the first message shown come with the older messages, once those are read.
    const first = messages.length ? time(messages[0].at) : Infinity;
    const answers = answered.filter((one) => time(one.at) >= first).sort((a, b) => time(a.at) - time(b.at));
    /** The cards answered by a time, each a turn of its own, in order. */
    const answeredBy = (at: number): void => {
      while (answers.length && time(answers[0].at) <= at) {
        const answer = answers.shift()!;
        added(`card:${answer.card_id}`, answer.at, null).answer = answer;
      }
    };
    for (const message of messages) {
      answeredBy(time(message.at));
      if (message.actor !== 'assistant') {
        bySeq.set(message.seq, added(message.client_id || message.message_id, message.at, message));
      } else if (message.run) {
        ofRun(message.run, message.at).assistantMessages.push(message);
      } else {
        const own = chatTurns();
        (own[own.length - 1] ?? added(message.message_id, message.at, null)).assistantMessages.push(message);
      }
    }
    answeredBy(Infinity);
    for (const entry of [...work].sort((a, b) => time(a.started) - time(b.started))) {
      if (entry.run) {
        ofRun(entry.run, entry.started || '').work.push(entry);
        continue;
      }
      const own = chatTurns();
      const begun = time(entry.started) + SKEW_MS;
      // begun before every turn shown: older messages are not read yet, and the first is the nearest
      const home = [...own].reverse().find((one) => time(one.at) <= begun) ?? own[0]
        ?? added('', entry.started || '', null);
      home.work.push(entry);
    }
    return [...turns, ...runs.values()].sort((a, b) => time(a.at) - time(b.at));
  }

  private buildTimeline(turns: ChatTurn[], notes: ChatNote[]): TimelineItem[] {
    const items: TimelineItem[] = turns.map((turn) => ({ kind: 'turn', turn }));
    for (const note of notes) {
      const at = items.findIndex((item) => item.kind === 'turn' && time(item.turn.at) > time(note.at));
      items.splice(at < 0 ? items.length : at, 0, { kind: 'note', note });
    }
    return items;
  }

  /** What an event says in the conversation's own lines, if anything. */
  private noteOf(event: ChatEvent): ChatNote | null {
    const id = `event:${event.seq}`;
    switch (event.event) {
      case 'schedule_added': {
        const what = event.data.what?.prompt || event.data.what?.function || '';
        return { id, at: event.at, icon: 'calendar-clock', text: what ? `Scheduled: ${what}` : 'A schedule was added',
                 link: { text: 'Open', to: `/ai/schedules/${event.data.schedule_id}` } };
      }
      case 'schedule_ran':
        return { id, at: event.at, icon: event.data.failed ? 'circle-alert' : 'calendar-check',
                 text: event.data.failed ? `A scheduled run failed: ${event.data.summary || 'no reason was given'}`
                   : `A scheduled run ended${event.data.summary ? `: ${event.data.summary}` : ''}`,
                 link: { text: 'Open', to: `/ai/schedules/${event.data.schedule_id}` } };
      case 'stopped':
        return { id, at: event.at, icon: 'circle-stop', text: 'Work stopped' };
      case 'settings_changed': {
        const text = ChatStateService.changed(event.data.changes || {});
        return text ? { id, at: event.at, icon: 'settings', text } : null;
      }
      default:
        return null;
    }
  }

  /** A chat's settings changed, in words: "Model: claude-opus-5-5 · Trust level: Trusted". */
  static changed(changes: Partial<ChatSettings>): string {
    const said: string[] = [];
    if ('model' in changes || 'model_id' in changes) {
      said.push(`Model: ${changes.model_id || (changes.model ? 'another connection' : 'the organization’s default')}`);
    }
    if ('effort' in changes) said.push(`Effort: ${changes.effort || 'the model’s default'}`);
    if ('trust' in changes) {
      said.push(`Trust level: ${TRUST_CHOICES.find((choice) => choice.value === changes.trust)?.name ?? changes.trust}`);
    }
    if ('turn_budget' in changes) said.push(`Turn budget: ${changes.turn_budget || 'unlimited'}`);
    if ('agents' in changes) said.push('Agents changed');
    if ('mcp_servers' in changes) said.push('Servers changed');
    if ('skills' in changes) said.push('Skills changed');
    if ('time_zone' in changes) said.push(`Time zone: ${changes.time_zone}`);
    return said.join(' · ');
  }
}
