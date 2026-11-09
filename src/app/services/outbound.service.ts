import { Injectable } from '@angular/core';

import { Failure, RequestService } from './request.service';

/** What a notification out is sent as. */
export type OutboundFormat = 'json' | 'slack' | 'teams';

/** One outside address the person's notifications go to. */
export interface OutboundAddress {
  id: string;
  name: string;
  url: string;
  format: OutboundFormat;
  events: string[];
  /** Whether the reply's own words go with a `reply.ready`. */
  include_reply: boolean;
  /** Nothing is sent: paused by the person, or by the platform after
   *  twenty failures in a row. */
  paused: boolean;
}

export interface OutboundDraft {
  name?: string;
  url?: string;
  format?: OutboundFormat;
  events?: string[];
  include_reply?: boolean;
  paused?: boolean;
}

/** One notification sent to an address, and how it ended. */
export interface OutboundDelivery {
  at: string;
  /** `sent`; `refused`, never tried again; or `failed`, tried again for a day. */
  outcome: 'sent' | 'refused' | 'failed';
  /** What the address answered; 0 when it was not reached. */
  status: number;
}

/** The events a notification is sent for, in plain words. */
export const EVENT_WORDS: Record<string, { name: string; hint: string }> = {
  'approval.waiting': { name: 'An approval is waiting for you', hint: 'A chat stopped to ask you something.' },
  'reply.ready': { name: 'A chat answered while you were away', hint: 'Sent when you were not looking at the chat.' },
  'run.finished': { name: 'A schedule’s run finished', hint: '' },
  'run.failed': { name: 'A schedule’s run failed', hint: '' },
};

export const FORMAT_WORDS: Record<OutboundFormat, { name: string; hint: string }> = {
  json: { name: 'JSON', hint: 'For your own service: the notification as a JSON body.' },
  slack: { name: 'Slack', hint: 'A Slack incoming webhook address: the message is posted to its channel.' },
  teams: { name: 'Microsoft Teams', hint: 'A Teams incoming webhook or workflow address.' },
};

export function eventName(event: string): string {
  return EVENT_WORDS[event]?.name ?? event;
}

export function formatName(format: string): string {
  return FORMAT_WORDS[format as OutboundFormat]?.name ?? format;
}

/**
 * Client for Settings:Outbound: outside addresses a person's
 * notifications go to, as JSON or a Slack or Teams message. At most ten
 * a person.
 */
@Injectable({ providedIn: 'root' })
export class OutboundService {
  /** How many addresses a person keeps. */
  static readonly MOST = 10;

  constructor(private request: RequestService) {}

  async list(): Promise<{ addresses: OutboundAddress[]; events: string[]; formats: OutboundFormat[] } & Failure> {
    const r = await this.request.gateway('Settings:Outbound:list');
    return { addresses: r.addresses ?? [], events: r.events ?? [], formats: r.formats ?? [], error: r.error };
  }

  create(draft: OutboundDraft): Promise<{ address?: OutboundAddress } & Failure> {
    return this.request.gateway('Settings:Outbound:create', draft);
  }

  /** Unpausing also forgets the failures that paused it. */
  update(id: string, changes: OutboundDraft): Promise<{ address?: OutboundAddress } & Failure> {
    return this.request.gateway('Settings:Outbound:update', { id, ...changes });
  }

  remove(id: string): Promise<Failure> {
    return this.request.gateway('Settings:Outbound:delete', { id });
  }

  /** A test, queued: how it went is among its deliveries. */
  test(id: string): Promise<Failure> {
    return this.request.gateway('Settings:Outbound:test', { id });
  }

  /** The last twenty sends, oldest first. */
  async deliveries(id: string): Promise<{ deliveries: OutboundDelivery[] } & Failure> {
    const r = await this.request.gateway('Settings:Outbound:deliveries', { id });
    return { deliveries: r.deliveries ?? [], error: r.error };
  }
}
