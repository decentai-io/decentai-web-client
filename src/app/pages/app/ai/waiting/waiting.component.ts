import { Component, OnInit } from '@angular/core';

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

/**
 * Waiting for you: every card open across the person's chats, grouped by
 * chat, oldest first, answered here. A card waits however long its person
 * takes; work started by a schedule or a webhook waits on it too. An
 * approval holds the calls of one step, allowed all at once or each.
 * A form, or a question that wants a file, is answered in its chat, where
 * the upload and the sign-in flows live.
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
    this.loading = false;
  }

  /** Answered in its chat: a form, or a question that wants a file. */
  inChat(card: Card): boolean {
    return card.kind === 'form' || (card.kind === 'question' && card.request.expects === 'file');
  }

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
