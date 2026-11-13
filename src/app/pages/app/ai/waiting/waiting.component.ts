import { Component, OnInit } from '@angular/core';

import { relativeDate } from 'src/app/components/ui/dates';
import { ServerList, ServerPage } from 'src/app/components/ui/paging';
import { Card } from 'src/app/models/chat-protocol';
import { ActivityService, CardCounts } from 'src/app/services/activity.service';
import { AiSessionService } from 'src/app/services/ai-session.service';
import { AttentionService } from 'src/app/services/attention.service';
import { CardDecision } from '../chat/chat-approval-card/chat-approval-card.component';

/** The cards of one chat, oldest first. */
interface Waiting {
  chatId: string;
  title: string;
  cards: Card[];
}

/** One number at the head of the page. */
interface Tile {
  icon: string;
  value: number;
  label: string;
  warn?: boolean;
}

/** The cards a chat shows before "Show all": the oldest few. */
const CARDS_SHOWN = 3;

/** The cards read at a time, oldest first. */
const CARDS_PAGE = 50;

/** What a card asks, in a word and an icon: the line over the card. */
const KINDS: Record<Card['kind'], { word: string; icon: string }> = {
  approval: { word: 'Approval', icon: 'shield-alert' },
  network: { word: 'Network access', icon: 'globe' },
  question: { word: 'Question', icon: 'circle-help' },
  form: { word: 'Sign-in', icon: 'key-round' },
  skill: { word: 'Offer: a skill', icon: 'sparkles' },
  memory: { word: 'Offer: a memory', icon: 'brain-circuit' },
};

const NO_COUNTS: CardCounts = { approval: 0, network: 0, question: 0, form: 0, skill: 0, memory: 0 };

/**
 * Approvals: every card open across the person's chats, grouped by
 * chat, oldest first, answered here — mostly approvals, also the
 * questions and forms the assistant asked. A card waits however long its
 * person takes; work started by a schedule or a webhook waits on it too.
 * An approval holds the calls of one step, allowed all at once or each.
 * A form, or a question that wants a file, is answered in its chat, where
 * the upload and the sign-in flows live.
 *
 * The cards come from the API server a page at a time, oldest first,
 * "Load more" reading the next; the numbers at the head are the
 * server's, of every card open.
 *
 * Its address stays /ai/waiting: notifications and emails link there.
 */
@Component({
  selector: 'app-waiting',
  standalone: false,
  templateUrl: './waiting.component.html',
  styleUrl: './waiting.component.css',
})
export class WaitingComponent implements OnInit {
  loading = true;
  error = '';
  /** The cards read, a page at a time. */
  readonly cards = new ServerList<Card>(CARDS_PAGE, (after, limit) => this.read(after, limit));
  /** Every card open, by kind; the chats a card waits in; and how many
   *  wait in each chat read, the server's numbers. */
  counts: CardCounts = { ...NO_COUNTS };
  chatsWaiting = 0;
  private waiting: Record<string, number> = {};
  private titles: Record<string, string> = {};
  /** Cards whose answer is on its way. */
  answering = new Set<string>();
  private whole = new Set<string>();

  constructor(private activity: ActivityService, private aiSession: AiSessionService,
              private attention: AttentionService) {}

  ngOnInit(): void {
    void this.load();
  }

  async load(): Promise<void> {
    this.loading = true;
    await this.cards.first();
    this.error = this.cards.error;
    this.loading = false;
  }

  /** The next page of cards, under those read. */
  async more(): Promise<void> {
    await this.cards.more();
    this.error = this.cards.error;
  }

  private async read(after: string, limit: number): Promise<ServerPage<Card>> {
    const page = await this.activity.list(after, limit);
    if (!page.error) {
      this.counts = page.counts;
      this.chatsWaiting = page.chats_waiting;
      this.waiting = after ? { ...this.waiting, ...page.waiting } : page.waiting;
      this.titles = { ...this.titles, ...(page.chats ?? {}) };
    }
    return { rows: page.cards, next: page.next, total: page.total, error: page.error };
  }

  /** The cards read, under their chats, in the order their oldest came. */
  get groups(): Waiting[] {
    // Made again only when the cards read change: the rows keep their
    // place, and a card half answered keeps its state.
    if (this.grouped.rows === this.cards.rows) return this.grouped.groups;
    const groups = new Map<string, Waiting>();
    for (const card of this.cards.rows) {
      const group = groups.get(card.chat_id)
        ?? { chatId: card.chat_id, title: this.titles[card.chat_id] || 'A chat', cards: [] };
      group.cards.push(card);
      groups.set(card.chat_id, group);
    }
    this.grouped = { rows: this.cards.rows, groups: [...groups.values()] };
    return this.grouped.groups;
  }
  private grouped: { rows: Card[] | null; groups: Waiting[] } = { rows: null, groups: [] };

  trackGroup(_: number, group: Waiting): string {
    return group.chatId;
  }

  trackCard(_: number, card: Card): string {
    return card.card_id;
  }

  /** How many cards wait in a chat, every one, read or not. */
  waitingIn(group: Waiting): number {
    return Math.max(this.waiting[group.chatId] ?? 0, group.cards.length);
  }

  /** A chat's cards shown: its oldest few, or all those read once asked. */
  cardsOf(group: Waiting): Card[] {
    return this.whole.has(group.chatId) ? group.cards : group.cards.slice(0, CARDS_SHOWN);
  }

  showAll(group: Waiting): void {
    this.whole.add(group.chatId);
  }

  /** Answered in its chat: a form, or a question that wants a file. */
  inChat(card: Card): boolean {
    return card.kind === 'form' || (card.kind === 'question' && card.request.expects === 'file');
  }

  // ── The numbers at the head ─────────────────────────────────────────

  /** What waits, by kind: everything, then each kind there is one of. */
  get tiles(): Tile[] {
    const of = (...kinds: Card['kind'][]) => kinds.reduce((sum, kind) => sum + (this.counts[kind] || 0), 0);
    const all = this.cards.total;
    const tiles: Tile[] = [
      { icon: 'inbox', value: all, label: 'Waiting for your answer', warn: all > 0 },
      { icon: 'shield-alert', value: of('approval', 'network'), label: 'Approvals' },
      { icon: 'circle-help', value: of('question'), label: 'Questions' },
      { icon: 'key-round', value: of('form'), label: 'Sign-ins' },
      { icon: 'sparkles', value: of('skill', 'memory'), label: 'Offers' },
    ];
    // Approvals and questions always have their tile; the rarer kinds once
    // there is one.
    return tiles.filter((tile, index) => index < 3 || tile.value > 0);
  }

  // ── A card, in words ────────────────────────────────────────────────

  kindWord(card: Card): string {
    if (card.kind === 'question' && card.request.expects === 'file') return 'A file';
    return KINDS[card.kind]?.word ?? 'A card';
  }

  kindIcon(card: Card): string {
    if (card.kind === 'question' && card.request.expects === 'file') return 'paperclip';
    return KINDS[card.kind]?.icon ?? 'inbox';
  }

  /** Who asks: an agent, or the assistant itself. */
  who(card: Card): string { return card.agent || 'Your assistant'; }

  /** How long it has waited: "2 h ago". */
  since(card: Card): string { return card.at ? relativeDate(card.at) : ''; }

  async onDecision(decision: CardDecision): Promise<void> {
    if (!decision.answer || this.answering.has(decision.card_id)) return;
    this.answering.add(decision.card_id);
    const res = await this.aiSession.decide(decision.card_id, decision.answer);
    this.answering.delete(decision.card_id);
    if (res.error && res.code !== 'not_found' && res.code !== 'conflict') {
      this.error = res.error;
      return;
    }
    // Answered, or answered already elsewhere: either way it waits no more.
    this.forget(decision.card_id);
    void this.attention.refresh();
  }

  /** A card answered: out of the cards read, and of the numbers. */
  private forget(cardId: string): void {
    const card = this.cards.rows.find((one) => one.card_id === cardId);
    if (!card) return;
    this.cards.drop((one) => one.card_id === cardId);
    this.counts = { ...this.counts, [card.kind]: Math.max(0, (this.counts[card.kind] || 0) - 1) };
    const left = Math.max(0, (this.waiting[card.chat_id] ?? 1) - 1);
    this.waiting = { ...this.waiting, [card.chat_id]: left };
    if (!left) this.chatsWaiting = Math.max(0, this.chatsWaiting - 1);
  }
}
