import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';

import { Failure, RequestService } from './request.service';

/**
 * Client for AI:Switch: the person's own stop for everything of theirs.
 * Stopping stops every chat and schedule of theirs, at once, and holds
 * them stopped; resuming is theirs too, and never happens by itself.
 */
@Injectable({ providedIn: 'root' })
export class WorkSwitchService {
  /** Whether this person has stopped everything. */
  readonly stopped$ = new BehaviorSubject<boolean>(false);

  constructor(private request: RequestService) {}

  async refresh(): Promise<void> {
    const r = await this.request.gateway('AI:Switch:status');
    if (!r.error) this.stopped$.next(r.stopped === true);
  }

  async stop(): Promise<Failure> {
    return this.set('AI:Switch:stop', true);
  }

  async resume(): Promise<Failure> {
    return this.set('AI:Switch:resume', false);
  }

  private async set(endpoint: string, stopped: boolean): Promise<Failure> {
    const r = await this.request.gateway(endpoint);
    if (!r.error) this.stopped$.next(stopped);
    return r.error ? { error: r.error } : {};
  }
}
