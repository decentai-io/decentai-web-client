import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';

import { Chat } from '../models/chat-protocol';
import { ActivityService } from './activity.service';
import { AuthService } from './auth.service';

/** How many chats wait on the person, for the sidebar: the chats with a
 *  card open, read from what waits across chats every so often while the
 *  app is open, and at once when a page that knows better says. */
@Injectable({ providedIn: 'root' })
export class AttentionService {
  readonly count$ = new BehaviorSubject<number>(0);
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(private activity: ActivityService, private auth: AuthService) {}

  /** Start the poll once, for as long as the person is signed in. */
  start(): void {
    if (this.timer || !this.auth.can('ai:activity:list')) return;
    void this.refresh();
    this.timer = setInterval(() => { void this.refresh(); }, 30000);
  }

  /** End the poll on sign-out, or when the session ended: a list asked
   *  for without a session is only refused. */
  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.count$.next(0);
  }

  async refresh(): Promise<void> {
    // One card asked for: the server counts the chats a card waits in.
    const waiting = await this.activity.list('', 1);
    // What cannot be read changes nothing shown.
    if (!waiting.error) this.count$.next(waiting.chats_waiting);
  }

  /** A page that already read the chats tells the count from them. */
  absorb(chats: Chat[]): void {
    this.count$.next((chats || []).filter((chat) => (chat.waiting || 0) > 0).length);
  }
}
