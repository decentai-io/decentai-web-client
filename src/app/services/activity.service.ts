import { Injectable } from '@angular/core';

import { Card } from '../models/chat-protocol';
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

/** What waits for the person across their chats. */
export interface Activity {
  cards: Card[];
  schedules: Schedule[];
  error?: string;
}

/**
 * Client for AI:Activity and AI:Schedule: what waits for the person in
 * every chat (open cards, and schedules that are not paused), and their
 * hand on a chat's schedules.
 */
@Injectable({ providedIn: 'root' })
export class ActivityService {
  constructor(private request: RequestService) {}

  async list(): Promise<Activity> {
    const r = await this.request.gateway('AI:Activity:list');
    return { cards: r.cards ?? [], schedules: r.schedules ?? [], error: r.error };
  }

  /** Every schedule of the person's, paused ones too, soonest first; one
   *  chat's where it is named. */
  async schedules(chatId = ''): Promise<{ schedules: Schedule[]; error?: string }> {
    const r = await this.request.gateway('AI:Schedule:list', chatId ? { chat_id: chatId } : {});
    return { schedules: r.schedules ?? [], error: r.error };
  }

  create(chatId: string, what: ScheduleWhat, when: ScheduleWhen) {
    return this.request.gateway<{ schedule: Schedule }>('AI:Schedule:create', { chat_id: chatId, what, when });
  }

  /** Pause, resume, run now, or change when it runs. */
  update(scheduleId: string, changes: { when?: ScheduleWhen; paused?: boolean; run_now?: boolean }) {
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
