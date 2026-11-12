import { Injectable } from '@angular/core';

import {
  CardAnswer, Chat, ChatEvent, ChatMessage, ChatSettings, ChatSnapshot,
} from 'src/app/models/chat-protocol';
import { ChatInspection, wholeInspection } from 'src/app/models/chat-inspect';
import { chatDefaults } from 'src/app/pages/app/ai/chat/chat-defaults';
import { EngineService } from './engine.service';
import { ProfileService } from './profile.service';
import { RequestService } from './request.service';
import { SessionTokenService } from './session-token.service';

/**
 * The chat pages' client for a person's chats (api-server.md §7): the
 * chats, their messages and cards over HTTP, and the live socket's
 * address. What happens in a chat as it happens comes over the socket
 * (ChatConnectionService).
 */
@Injectable({ providedIn: 'root' })
export class AiSessionService {
  private chatsCache: Chat[] | null = null;
  private readonly chatsCacheKey = 'decentai.chat-list-cache';

  /** The most a list answers with at once. */
  static readonly PAGE = 100;

  constructor(
    private request: RequestService,
    private engine: EngineService,
    private session: SessionTokenService,
    private profile: ProfileService,
  ) {}

  /** One call, its answer as `data` or its refusal as `error` and `code`. */
  private async ai(endpoint: string, data: any = {}): Promise<{ data?: any; error?: string; code?: string }> {
    const answer = await this.request.gateway(endpoint, data);
    return answer.error ? { error: answer.error, code: answer.code } : { data: answer };
  }

  // ── Chats ─────────────────────────────────────────────────────

  /** The person's chats, archived or not, the last active first: every page, to
   *  a thousand. Those not archived are kept for this browser session,
   *  so a page can show them at once while they are read again. */
  async listChats(archived = false): Promise<Chat[]> {
    const chats: Chat[] = [];
    let before = '';
    for (let page = 0; page < 10; page++) {
      const res = await this.ai('AI:Chat:list', { archived, limit: AiSessionService.PAGE, ...(before ? { before } : {}) });
      if (res.error) throw new Error(res.error);
      const found: Chat[] = res.data?.chats || [];
      chats.push(...found);
      if (found.length < AiSessionService.PAGE) break;
      before = found[found.length - 1].updated_at;
    }
    if (!archived) {
      this.chatsCache = chats;
      try {
        sessionStorage.setItem(this.chatsCacheKey, JSON.stringify(chats));
      } catch {}
    }
    return chats;
  }

  /** The person is leaving: the list kept for them, in memory and in
   *  the browser's session store, is nobody else's to be shown. */
  forgetChats(): void {
    this.chatsCache = null;
    try {
      sessionStorage.removeItem(this.chatsCacheKey);
    } catch {}
  }

  /** The last list of chats not archived, from this browser session. */
  peekChats(): Chat[] | null {
    if (this.chatsCache) return [...this.chatsCache];
    try {
      const saved = JSON.parse(sessionStorage.getItem(this.chatsCacheKey) || 'null');
      if (Array.isArray(saved)) {
        this.chatsCache = saved;
        return [...saved];
      }
    } catch {}
    return null;
  }

  /** The browser's IANA zone: what "tomorrow at nine" means to the
   *  person. A new chat keeps its schedules' time in it. */
  static browserTimezone(): string {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone || '';
    } catch {
      return '';
    }
  }

  /** Start a chat: from the person's chat defaults, its schedules in the
   *  browser's time zone, and whatever `settings` says over both. */
  async createChat(title = '', settings: Partial<ChatSettings> = {}): Promise<{ data?: { chat: Chat }; error?: string }> {
    const time_zone = AiSessionService.browserTimezone();
    const kept = chatDefaults((await this.profile.get().catch(() => null))?.preferences.chat);
    return this.ai('AI:Chat:create', {
      title, settings: { ...(time_zone ? { time_zone } : {}), ...kept, ...settings },
    });
  }

  /** Rename a chat, or change some of its settings. */
  async updateChat(chatId: string, changes: { title?: string; settings?: Partial<ChatSettings> }):
      Promise<{ data?: { chat: Chat }; error?: string }> {
    return this.ai('AI:Chat:update', { chat_id: chatId, ...changes });
  }

  archiveChat(chatId: string) {
    return this.ai('AI:Chat:archive', { chat_id: chatId });
  }

  restoreChat(chatId: string) {
    return this.ai('AI:Chat:restore', { chat_id: chatId });
  }

  deleteChat(chatId: string) {
    return this.ai('AI:Chat:delete', { chat_id: chatId });
  }

  /** The conversation taken away: its messages, events and cards. */
  clearChat(chatId: string) {
    return this.ai('AI:Chat:clear', { chat_id: chatId });
  }

  /** Stop the chat's work; its cards expire. */
  stop(chatId: string, work = '') {
    return this.ai('AI:Chat:stop', { chat_id: chatId, ...(work ? { work } : {}) });
  }

  // ── A chat's conversation ─────────────────────────────────────

  /** The chat, its last messages, its open cards, and the number of its
   *  last event, which the socket replays from. */
  async openChat(chatId: string): Promise<{ data?: ChatSnapshot; error?: string }> {
    return this.ai('AI:Chat:open', { chat_id: chatId });
  }

  /** Everything about a chat besides its live work: what it cost, what
   *  ran it, where it reached, what it touched and asked, its schedules.
   *  `code` says why not, `not_found` for a server that has no such call. */
  async inspect(chatId: string): Promise<{ data?: ChatInspection; error?: string; code?: string }> {
    const res = await this.ai('AI:Chat:inspect', { chat_id: chatId });
    return res.error ? res : { data: wholeInspection(res.data) };
  }

  /** The events a chat kept after one, oldest first: up to the last 500. */
  async events(chatId: string, after: number): Promise<ChatEvent[]> {
    const res = await this.ai('AI:Event:list', { chat_id: chatId, after });
    return Array.isArray(res.data?.events) ? res.data.events : [];
  }

  /** A page of the whole output of a chat's work. */
  async output(chatId: string, ref: string, offset = 0): Promise<{ data?: { text: string; size: number };
      error?: string }> {
    return this.ai('AI:Output:see', { chat_id: chatId, ref, offset, limit: 50000 });
  }

  /** Messages before one, oldest first. */
  async listMessages(chatId: string, before = '', limit = 50): Promise<{ data?: { messages: ChatMessage[] }; error?: string }> {
    return this.ai('AI:Message:list', { chat_id: chatId, limit, ...(before ? { before } : {}) });
  }

  /** The person's words, and files of theirs by record id. The message
   *  keeps `clientId`, so the page knows its own when it comes back. */
  async input(chatId: string, text: string, files: string[], clientId: string):
      Promise<{ data?: { message: ChatMessage }; error?: string; code?: string }> {
    return this.ai('AI:Chat:input', { chat_id: chatId, text, files, client_id: clientId });
  }

  /** Answer a card of one of the person's chats. */
  decide(cardId: string, answer: CardAnswer) {
    return this.ai('AI:Approval:decide', { card_id: cardId, answer });
  }

  // ── The socket ────────────────────────────────────────────────

  /** A chat's live socket, under the API server: `wss:` for an `https:`
   *  one, replaying the events after `after`. */
  buildChatWsUrl(chatId: string, after: number): string {
    return this.engine.ws(`chats/${encodeURIComponent(chatId)}?after=${after}`);
  }

  /** What the socket offers in its handshake: `bearer`, then the token. */
  chatWsProtocols(): string[] {
    return this.session.wsProtocols();
  }
}
