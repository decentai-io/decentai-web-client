import { Component, OnInit } from '@angular/core';

import { relativeDate } from 'src/app/components/ui/dates';
import { Shown } from 'src/app/components/ui/paging';
import { Card } from 'src/app/models/chat-protocol';
import { ActivityService } from 'src/app/services/activity.service';
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
/** The most open cards the API server gives at once, oldest first. */
const SERVER_MOST = 200;

/** What a card asks, in a word and an icon: the line over the card. */
const KINDS: Record<Card['kind'], { word: string; icon: string }> = {
  approval: { word: 'Approval', icon: 'shield-alert' },
  network: { word: 'Network access', icon: 'globe' },
  question: { word: 'Question', icon: 'circle-help' },
  form: { word: 'Sign-in', icon: 'key-round' },
  skill: { word: 'Offer: a skill', icon: 'sparkles' },
  memory: { word: 'Offer: a memory', icon: 'brain-circuit' },
};

/**
 * Approvals: every card open across the person's chats, grouped by
 * chat, oldest first, answered here — mostly approvals, also the
 * questions and forms the assistant asked. A card waits however long its
 * person takes; work started by a schedule or a webhook waits on it too.
 * An approval holds the calls of one step, allowed all at once or each.
 * A form, or a question that wants a file, is answered in its chat, where
 * the upload and the sign-in flows live.
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
  groups: Waiting[] = [];
  /** Cards whose answer is on its way. */
  answering = new Set<string>();
  /** Ten chats at a time; in each, its oldest cards, the rest on asking. */
  readonly chats = new Shown(10);
  private whole = new Set<string>();
  /** The server gave its most: there may be more behind them. */
  capped = false;

  constructor(private activity: ActivityService, private aiSession: AiSessionService,
              private attention: AttentionService) {}

  ngOnInit(): void {
    void this.load();
  }

  async load(): Promise<void> {
    this.loading = true;
    const waiting = await this.activity.list();
    this.error = waiting.error || '';
    const groups = new Map<string, Waiting>();
    for (const card of waiting.cards) {
      const group = groups.get(card.chat_id)
        ?? { chatId: card.chat_id, title: waiting.chats?.[card.chat_id] || 'A chat', cards: [] };
      group.cards.push(card);
      groups.set(card.chat_id, group);
    }
    this.groups = [...groups.values()];
    this.capped = waiting.cards.length >= SERVER_MOST;
    this.loading = false;
  }

  /** A chat's cards shown: its oldest few, or all once asked. */
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
    const cards = this.groups.flatMap((group) => group.cards);
    const of = (...kinds: Card['kind'][]) => cards.filter((card) => kinds.includes(card.kind)).length;
    const tiles: Tile[] = [
      { icon: 'inbox', value: cards.length, label: 'Waiting for your answer', warn: cards.length > 0 },
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
    for (const group of this.groups) group.cards = group.cards.filter((card) => card.card_id !== decision.card_id);
    this.groups = this.groups.filter((group) => group.cards.length);
    void this.attention.refresh();
  }
}
