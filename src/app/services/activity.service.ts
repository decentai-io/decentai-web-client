import { Injectable } from '@angular/core';

import { Card } from '../models/chat-protocol';
import { nextOf, pageAsk, ServerPage } from '../components/ui/paging';
import { Failure, RequestService } from './request.service';

/** What a schedule runs: a prompt for the assistant, or a function an
 *  agent marked schedulable (`agent.function`) with its inputs. */
export type ScheduleWhat = { prompt: string } | { function: string; inputs: Record<string, unknown> };

/** When it runs: a cron line in the chat's time zone, every so many
 *  seconds (at least 60), or once, at a time (ISO). */
export type ScheduleWhen = { cron: string } | { every: number } | { at: string };

/** How one run ended. */
export interface ScheduleRun {
  at: string;
  failed: boolean;
  summary: string;
}

/** A schedule (`Schedules.public`). */
export interface Schedule {
  schedule_id: string;
  chat_id: string;
  what: ScheduleWhat;
  when: ScheduleWhen;
  /** When it runs next; null for a once that has run. */
  next_at: string | null;
  paused: boolean;
  /** Who made it: the person, or the assistant through its runtime. */
  by: 'person' | 'assistant';
  /** The trust its runs act at, nobody watching: a call above it waits for
   *  the person's approval. The chat's when made; its person may set
   *  another, above the chat's too. Null for one older than trusts. */
  trust: number | null;
  /** The last 20 runs' outcomes, oldest first. */
  runs: ScheduleRun[];
}

/** A function a chat can schedule. */
export interface SchedulableFunction {
  /** `agent.function`. */
  function: string;
  name: string;
  /** Its inputs, as JSON Schema. */
  inputs: Record<string, unknown>;
}

/** The open cards in numbers, by kind. */
export interface CardCounts {
  approval: number;
  network: number;
  question: number;
  form: number;
  skill: number;
  memory: number;
}

/** What waits for the person across their chats: a page of open cards,
 *  oldest first, and what is counted of them all. */
export interface Activity {
  cards: Card[];
  schedules: Schedule[];
  /** The titles of the chats the cards are in, by chat id. */
  chats?: Record<string, string>;
  /** The cursor of the next page of cards; null at their end. */
  next: string | null;
  /** How many cards are open, in all. */
  total: number;
  counts: CardCounts;
  /** How many chats have a card open. */
  chats_waiting: number;
  /** How many cards each chat of the page has open, in all. */
  waiting: Record<string, number>;
  error?: string;
}

/** How a schedule stands, for the filter: as `stateOf` says. */
export type ScheduleStateFilter = 'active' | 'paused' | 'done' | 'failing';

/** What the schedules are narrowed by, on the API server. */
export interface ScheduleFilters {
  /** In a prompt, a function's id, or the chat's title. */
  q?: string;
  state?: ScheduleStateFilter | '';
  chat_id?: string;
}

/** The person's schedules in numbers, whatever the filters. */
export interface ScheduleCounts {
  all: number;
  active: number;
  paused: number;
  done: number;
  failing: number;
}

/** A page of schedules, those that run soonest first, with the numbers
 *  of them all, by state and by chat, and the one that runs next. */
export interface SchedulePage extends ServerPage<Schedule> {
  counts: ScheduleCounts;
  chats: { chat_id: string; title: string; count: number }[];
  upcoming: Schedule | null;
}

/**
 * Client for AI:Activity and AI:Schedule: what waits for the person in
 * every chat (open cards, and schedules that are not paused), and their
 * hand on a chat's schedules.
 */
@Injectable({ providedIn: 'root' })
export class ActivityService {
  constructor(private request: RequestService) {}

  /** A page of the cards open across the person's chats, oldest first,
   *  after the cursor given; with them, what is counted of them all. */
  async list(after = '', limit = 50): Promise<Activity> {
    const r = await this.request.gateway('AI:Activity:list', pageAsk(after, limit));
    const cards: Card[] = r.cards ?? [];
    const counts = r.counts ?? {};
    const of = (kind: Card['kind']) => Number(counts[kind] ?? cards.filter((card) => card.kind === kind).length) || 0;
    const waiting: Record<string, number> = r.waiting ?? {};
    if (!r.waiting) for (const card of cards) waiting[card.chat_id] = (waiting[card.chat_id] || 0) + 1;
    return {
      cards, schedules: r.schedules ?? [], chats: r.chats ?? {}, next: nextOf(r),
      total: Number(r.total ?? cards.length) || 0,
      counts: { approval: of('approval'), network: of('network'), question: of('question'), form: of('form'),
                skill: of('skill'), memory: of('memory') },
      chats_waiting: Number(r.chats_waiting ?? new Set(cards.map((card) => card.chat_id)).size) || 0,
      waiting, error: r.error,
    };
  }

  /** One chat's schedules, paused ones too, soonest first: a chat keeps
   *  50 at most, so one page holds them all. Without a chat, the first
   *  page of all the person's. */
  async schedules(chatId = ''): Promise<{ schedules: Schedule[]; error?: string }> {
    const r = await this.request.gateway('AI:Schedule:list', chatId ? { chat_id: chatId } : {});
    return { schedules: r.schedules ?? [], error: r.error };
  }

  /** A page of the person's schedules, those that run soonest first,
   *  then the paused and the done, narrowed on the server. */
  async schedulePage(after = '', limit = 20, filters: ScheduleFilters = {}): Promise<SchedulePage> {
    const r = await this.request.gateway('AI:Schedule:list', pageAsk(after, limit, { ...filters }));
    const rows: Schedule[] = r.schedules ?? [];
    const counts = r.counts ?? {};
    return {
      rows, next: nextOf(r), total: Number(r.total ?? rows.length) || 0, error: r.error,
      counts: {
        all: Number(counts.all) || 0, active: Number(counts.active) || 0, paused: Number(counts.paused) || 0,
        done: Number(counts.done) || 0, failing: Number(counts.failing) || 0,
      },
      chats: Array.isArray(r.chats) ? r.chats : [],
      upcoming: r.upcoming ?? null,
    };
  }

  /** One schedule of the person's, by its id: one opened from its
   *  address that is on no page read. Null when there is none. */
  async schedule(scheduleId: string): Promise<Schedule | null> {
    const r = await this.request.gateway('AI:Schedule:get', { schedule_id: scheduleId });
    return r.schedule ?? null;
  }

  create(chatId: string, what: ScheduleWhat, when: ScheduleWhen) {
    return this.request.gateway<{ schedule: Schedule }>('AI:Schedule:create', { chat_id: chatId, what, when });
  }

  /** Pause, resume, run now, or change when it runs and the trust it runs at. */
  update(scheduleId: string, changes: { when?: ScheduleWhen; paused?: boolean; run_now?: boolean; trust?: number }) {
    return this.request.gateway<{ schedule: Schedule }>('AI:Schedule:update', { schedule_id: scheduleId, ...changes });
  }

  remove(scheduleId: string): Promise<Failure> {
    return this.request.gateway('AI:Schedule:delete', { schedule_id: scheduleId });
  }

  /** The functions a chat can schedule: of the agents it uses, those
   *  marked schedulable. */
  async functions(chatId: string): Promise<SchedulableFunction[]> {
    const r = await this.request.gateway('AI:Schedule:functions', { chat_id: chatId });
    return r.functions ?? [];
  }
}
