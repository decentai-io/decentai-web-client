import { Injectable, NgZone } from '@angular/core';
import { BehaviorSubject, Subject } from 'rxjs';

import { ChatEvent, parseFrame } from 'src/app/models/chat-protocol';
import { AiSessionService } from './ai-session.service';
import { ShellStatusService } from './shell-status.service';

export type ChatConnectionState =
  | 'disconnected' | 'connecting' | 'connected' | 'reconnecting' | 'offline'
  /** The API server closed the socket, and it is not dialled again: the
   *  session ended (4401), or there is no such chat of the person's (4403). */
  | 'signed-out' | 'missing';

/**
 * A chat's live socket (`/chats/<id>`): its events, from where the page
 * left off, and the person's hand on an agent's screen.
 *
 * Each frame is an event `{seq, event, data, at}`, or the answer to
 * something the page sent. On every open the socket is asked for the
 * events after the last one the page took, and the API server replays
 * those it keeps before it goes on live; a dropped socket is dialled
 * again, a little later each time. One the API server closed itself is
 * not: it would be refused the same way.
 */
@Injectable({ providedIn: 'root' })
export class ChatConnectionService {
  readonly state$ = new BehaviorSubject<ChatConnectionState>('disconnected');
  readonly events$ = new Subject<ChatEvent>();

  private socket: WebSocket | null = null;
  private chatId: string | null = null;
  private after: () => number = () => 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempts = 0;
  private stopped = true;

  constructor(private aiSession: AiSessionService, private zone: NgZone, private shell: ShellStatusService) {}

  /** Open the chat's socket, replaying the events after `after()`. */
  connect(chatId: string, after: () => number): void {
    this.disconnect(false);
    this.chatId = chatId;
    this.after = after;
    this.stopped = false;
    this.open(false);
  }

  reconnectNow(): void {
    if (!this.chatId) return;
    this.stopped = false;
    this.reconnectAttempts = 0;
    this.clearTimer();
    this.open(true);
  }

  /** Something for the chat, over the socket: `AI:Chat:screen`. */
  send(endpoint: string, data: unknown): boolean {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return false;
    this.socket.send(JSON.stringify({ endpoint, data }));
    return true;
  }

  disconnect(permanent = true): void {
    if (permanent) this.stopped = true;
    this.clearTimer();
    const socket = this.socket;
    this.socket = null;
    if (socket) {
      socket.onopen = null;
      socket.onmessage = null;
      socket.onerror = null;
      socket.onclose = null;
      try { socket.close(); } catch {}
    }
    if (permanent) {
      this.chatId = null;
      this.state$.next('disconnected');
    }
  }

  private open(reconnecting: boolean): void {
    if (this.stopped || !this.chatId) return;
    this.disconnect(false);
    this.state$.next(reconnecting ? 'reconnecting' : 'connecting');
    const socket = new WebSocket(
      this.aiSession.buildChatWsUrl(this.chatId, this.after()), this.aiSession.chatWsProtocols());
    this.socket = socket;

    this.zone.runOutsideAngular(() => {
      socket.onopen = () => this.zone.run(() => {
        if (this.socket !== socket) return;
        this.reconnectAttempts = 0;
        this.state$.next('connected');
      });
      socket.onmessage = (message) => this.zone.run(() => {
        if (this.socket !== socket) return;
        const event = parseFrame(String(message.data));
        if (event) this.events$.next(event);
      });
      socket.onerror = () => this.zone.run(() => {
        if (this.socket === socket) this.state$.next('offline');
      });
      socket.onclose = (event) => this.zone.run(() => {
        if (this.socket !== socket) return;
        this.socket = null;
        if (event.code === 4401 || event.code === 4403) {
          this.stopped = true;
          // A session that ended is said by the shell, on every page.
          if (event.code === 4401) this.shell.sessionEnded();
          this.state$.next(event.code === 4401 ? 'signed-out' : 'missing');
          return;
        }
        this.scheduleReconnect();
      });
    });
  }

  private scheduleReconnect(): void {
    if (this.stopped || this.reconnectTimer || !this.chatId) return;
    this.state$.next('reconnecting');
    const delay = Math.min(1000 * 2 ** this.reconnectAttempts++, 8000);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.open(true);
    }, delay);
  }

  private clearTimer(): void {
    if (!this.reconnectTimer) return;
    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
  }
}
