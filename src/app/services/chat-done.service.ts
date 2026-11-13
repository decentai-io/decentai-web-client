import { Injectable, NgZone } from '@angular/core';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Title } from '@angular/platform-browser';
import { Router } from '@angular/router';

import { Chat } from '../models/chat-protocol';
import { AiSessionService } from './ai-session.service';

/** A chat the person set working, as the watch holds it: its title, whether
 *  it was seen working since (a message sent is not yet work begun), and
 *  how many reads found it quiet before it was. */
export interface Watched {
  title: string;
  seen: boolean;
  quiet: number;
}

/** How many reads a chat left may stay quiet without having begun before
 *  it is let go: its work never started (no runtime took it). */
export const QUIET_READS = 12;

/** What a list of chats says of one watched: still at it, done (quiet
 *  after it was seen working), not begun yet, or to be let go without a
 *  word (deleted, archived, or never begun). */
export function readWatched(held: Watched, chat: Chat | undefined): 'working' | 'done' | 'waiting' | 'gone' {
  if (!chat) return 'gone';
  if (chat.working) return 'working';
  if (held.seen) return 'done';
  return held.quiet + 1 >= QUIET_READS ? 'gone' : 'waiting';
}

/** What the app says of a chat that is done. */
export function doneLine(title: string): string {
  return title ? `“${title}” is done` : 'Your chat is done';
}

/** The tab's title, with how many chats finished while the person was away
 *  before it: "(2) Settings · DecentAI". None, the title alone. */
export function markedTitle(title: string, count: number): string {
  const bare = title.replace(/^\(\d+\) /, '');
  return count > 0 ? `(${count}) ${bare}` : bare;
}

/**
 * Tells the person when a chat they set working is done, while they are
 * not looking at it: on another page of the app, or in another tab.
 *
 * On the chat's page its socket says when it goes quiet (`idle`); once
 * the person leaves a chat still working, AI:Chat:list is read every few
 * seconds, and only while one they left is still at it. Done, it is said
 * in the app (a note with "Open") while the tab is in view; with the tab
 * hidden, by a system notification where the browser allows it, and by
 * the tab's title until the person comes back.
 *
 * Beside the server's own web push (`reply.ready`, Settings ›
 * Notifications): that one is sent for each reply while no browser has
 * the chat open, to every device turned on, even with the app closed.
 * This one is this tab's, once per piece of work, and only while the app
 * is open. Where this device has push on, the server's push already
 * reaches it for a chat that is not on screen, so no second system
 * notification is shown for that chat.
 */
@Injectable({ providedIn: 'root' })
export class ChatDoneService {
  /** How often the chats left working are read. */
  static readonly POLL_MS = 5000;
  /** Whether this device tells: a yes unless the person said no. */
  private static readonly KEY = 'decentai.chat_done';

  /** The chats the person set working in this tab, by id. */
  private started = new Map<string, Watched>();
  /** Those of them left while still working: read until they are done. */
  private left = new Set<string>();
  /** The chat whose page is open; '' for none. */
  private viewing = '';
  /** Done while the tab was hidden, and not seen yet. */
  private unseen: { chatId: string; title: string }[] = [];
  private running = false;
  private polling = false;
  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly onVisibility = () => this.zone.run(() => this.visibilityChanged());

  constructor(
    private aiSession: AiSessionService,
    private router: Router,
    private snackBar: MatSnackBar,
    private title: Title,
    private zone: NgZone,
  ) {}

  /** This device tells when a chat is done. */
  get enabled(): boolean {
    try {
      return localStorage.getItem(ChatDoneService.KEY) !== '0';
    } catch {
      return true;
    }
  }

  set enabled(on: boolean) {
    try {
      if (on) localStorage.removeItem(ChatDoneService.KEY);
      else localStorage.setItem(ChatDoneService.KEY, '0');
    } catch {
      // A browser that keeps nothing: the choice lasts as long as the page.
    }
  }

  /** From the app's shell, once the person is signed in. */
  start(): void {
    if (this.running) return;
    this.running = true;
    document.addEventListener('visibilitychange', this.onVisibility);
  }

  /** Signed out, or the session ended: nothing more is watched or asked. */
  stop(): void {
    this.running = false;
    document.removeEventListener('visibilitychange', this.onVisibility);
    this.started.clear();
    this.left.clear();
    this.unseen = [];
    this.viewing = '';
    this.endPoll();
    this.title.setTitle(markedTitle(this.title.getTitle(), 0));
  }

  // ── What the chat page says ────────────────────────────────────────

  /** The person set a chat working, or kept it working (`working`: it is
   *  at it already): they hear when it is done. */
  began(chatId: string, title: string, working: boolean): void {
    if (!this.running || !chatId) return;
    const held = this.started.get(chatId);
    this.started.set(chatId, { title, seen: working || !!held?.seen, quiet: 0 });
  }

  /** The chat's socket said it is at work. */
  working(chatId: string): void {
    const held = this.started.get(chatId);
    if (held) held.seen = true;
  }

  /** A chat's page opened: its socket tells from here. */
  opened(chatId: string): void {
    this.viewing = chatId;
    this.left.delete(chatId);
    if (!this.left.size) this.endPoll();
  }

  /** A chat's page let the chat go. Still working, it is read until done. */
  closed(chatId: string, title: string, working: boolean): void {
    if (this.viewing === chatId) this.viewing = '';
    if (!this.started.has(chatId)) return;
    if (!working) {
      this.started.delete(chatId);
      return;
    }
    if (title) this.started.get(chatId)!.title = title;
    this.left.add(chatId);
    if (!this.timer) this.timer = setInterval(() => void this.poll(), ChatDoneService.POLL_MS);
  }

  /** The chat's socket said it went quiet: done, if it had begun. */
  idle(chatId: string, title: string): void {
    const held = this.started.get(chatId);
    if (held?.seen) this.finished(chatId, title || held.title);
  }

  /** What a finished chat looks like here, on the person's asking. */
  test(): void {
    this.toast('', doneLine(''));
    void this.notifySystem('', '');
  }

  // ── Watching ───────────────────────────────────────────────────────

  /** The chats left working, read once; those done are told. */
  async poll(): Promise<void> {
    if (this.polling || !this.left.size) return;
    this.polling = true;
    try {
      const chats = await this.aiSession.listChats();
      for (const chatId of [...this.left]) {
        const held = this.started.get(chatId);
        const chat = chats.find((one) => one.chat_id === chatId);
        const read = held ? readWatched(held, chat) : 'gone';
        if (read === 'working') held!.seen = true;
        else if (read === 'waiting') held!.quiet++;
        else if (read === 'done') this.finished(chatId, chat?.title || held!.title);
        else this.forget(chatId);
      }
    } catch {
      // Not read this time: the next tick asks again.
    } finally {
      this.polling = false;
    }
  }

  private forget(chatId: string): void {
    this.started.delete(chatId);
    this.left.delete(chatId);
    if (!this.left.size) this.endPoll();
  }

  private endPoll(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** A chat is done: told once, where the person is not looking at it. */
  private finished(chatId: string, title: string): void {
    this.forget(chatId);
    if (!this.enabled) return;
    if (document.visibilityState === 'visible') {
      if (this.viewing !== chatId) this.toast(chatId, doneLine(title));
      return;
    }
    this.unseen.push({ chatId, title });
    this.title.setTitle(markedTitle(this.title.getTitle(), this.unseen.length));
    void this.notifySystem(chatId, title);
  }

  /** Back in the tab: the title loses its count, and what finished
   *  meanwhile is said in the app, but for the chat on screen. */
  private visibilityChanged(): void {
    if (document.visibilityState !== 'visible' || !this.unseen.length) return;
    this.title.setTitle(markedTitle(this.title.getTitle(), 0));
    const missed = this.unseen.filter((one) => one.chatId !== this.viewing);
    this.unseen = [];
    if (missed.length === 1) this.toast(missed[0].chatId, doneLine(missed[0].title));
    else if (missed.length > 1) this.toast('', `${missed.length} chats are done`);
  }

  /** A note in the app, with the way to the chat ('' for the chats page). */
  private toast(chatId: string, line: string): void {
    const ref = this.snackBar.open(line, 'Open', { duration: 8000 });
    ref.onAction().subscribe(() => void this.router.navigate(chatId ? ['/ai/chats', chatId] : ['/ai/chats']));
  }

  /** A system notification, where the browser allows one. The chat's
   *  title shows in it: it goes from this tab to this computer, through
   *  no push service. */
  private async notifySystem(chatId: string, title: string): Promise<void> {
    if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
    if (chatId && chatId !== this.viewing && (await this.pushedHere())) return;
    const shown = new Notification(title || 'Your chat', {
      body: 'Done. Open it to read the answer.', tag: `chat-done:${chatId}`, icon: '/favicon.ico',
    });
    shown.onclick = () => this.zone.run(() => {
      window.focus();
      if (chatId) void this.router.navigate(['/ai/chats', chatId]);
      shown.close();
    });
  }

  /** This device has the server's web push turned on. */
  private async pushedHere(): Promise<boolean> {
    try {
      const registration = await navigator.serviceWorker?.getRegistration();
      return !!(await registration?.pushManager.getSubscription());
    } catch {
      return false;
    }
  }
}
