import { Component, EventEmitter, Input, OnInit, Output } from '@angular/core';

import { relativeDate } from 'src/app/components/ui/dates';
import { Choice } from 'src/app/components/ui/radio-keys';
import { Shown } from 'src/app/components/ui/paging';
import { InspectedCard } from 'src/app/models/chat-inspect';
import { ChatSettings } from 'src/app/models/chat-protocol';
import { AgentsService, InstalledAgent, RememberedApproval } from 'src/app/services/agents.service';
import { AiSessionService } from 'src/app/services/ai-session.service';
import { TRUST_CHOICES, TURN_BUDGET_CHOICES } from '../chat-defaults';
import { agentName, answerWords, cardQuestion } from './inspector-words';

/**
 * How the chat is set up, changed where it stands: its trust and turn
 * budget in place, its agents, servers and skills through their dialogs,
 * its time zone to the browser's. Then the decisions its person
 * remembered for the agents it uses, each to forget, and every card it
 * asked, with how it was answered. It reads the remembered decisions each
 * time it opens.
 */
@Component({
  selector: 'app-inspector-setup',
  standalone: false,
  templateUrl: './inspector-setup.component.html',
  styleUrls: ['./inspector-shared.css', './inspector-setup.component.css'],
})
export class InspectorSetupComponent implements OnInit {
  @Input({ required: true }) settings!: ChatSettings;
  /** The model, as the chat's picker names it. */
  @Input() model = '';
  /** The agents this chat uses, and every installed agent's name by id. */
  @Input() agents: InstalledAgent[] = [];
  @Input() names: Record<string, string> = {};
  /** Every card it asked, newest first. */
  @Input() cards: InspectedCard[] = [];
  /** Eight at a time, more on asking. */
  readonly rememberedShown = new Shown(8);
  readonly cardsShown = new Shown(8);
  @Output() changeSettings = new EventEmitter<Partial<ChatSettings>>();
  @Output() changeAgents = new EventEmitter<void>();
  @Output() changeSkills = new EventEmitter<void>();

  static readonly CARD_ICONS: Record<string, string> = {
    approval: 'shield-check', network: 'globe', question: 'circle-question-mark', form: 'pencil-line',
    skill: 'sparkles', memory: 'lightbulb',
  };

  readonly trustChoices: Choice<number>[] = TRUST_CHOICES.map((choice) => ({ value: choice.value, name: choice.short }));
  readonly budgetChoices: Choice<number>[] = TURN_BUDGET_CHOICES;
  readonly browserZone = AiSessionService.browserTimezone();

  private allRemembered: RememberedApproval[] = [];
  readonly forgetting = new Set<string>();
  error = '';

  constructor(private agentsService: AgentsService) {}

  async ngOnInit(): Promise<void> {
    this.allRemembered = await this.agentsService.remembered().catch(() => []);
  }

  /** What the chosen trust level and turn budget mean. */
  get trustHint(): string {
    return TRUST_CHOICES.find((choice) => choice.value === this.settings.trust)?.hint ?? '';
  }

  get budgetHint(): string {
    return TURN_BUDGET_CHOICES.find((choice) => choice.value === this.settings.turn_budget)?.hint ?? '';
  }

  /** The agents it uses, in words: "Mail, Calendar and 2 more". */
  get agentWords(): string {
    if (!this.settings.agents) return 'All yours';
    if (!this.agents.length) return 'None';
    const names = this.agents.slice(0, 2).map((agent) => agent.name).join(', ');
    return this.agents.length > 2 ? `${names} and ${this.agents.length - 2} more` : names;
  }

  /** A list setting in words: every one the person may use, none, or how many. */
  chosen(value: string[] | null): string {
    if (!value) return 'All yours';
    return value.length ? `${value.length} chosen` : 'None';
  }

  // ── Remembered decisions ─────────────────────────────────────────────

  /** The remembered decisions for the agents and servers this chat uses. */
  get remembered(): RememberedApproval[] {
    const agents = new Set(this.agents.map((agent) => agent.agent_id));
    const servers = this.settings.mcp_servers;
    return this.allRemembered.filter((one) => one.agent.startsWith('mcp:')
      ? !servers || servers.includes(one.agent.slice(4)) : agents.has(one.agent));
  }

  rememberedBy(one: RememberedApproval): string {
    return one.agent.startsWith('mcp:') ? 'A server of yours' : agentName(one.agent, this.names);
  }

  async forget(one: RememberedApproval): Promise<void> {
    if (this.forgetting.has(one.id)) return;
    this.forgetting.add(one.id);
    const res = await this.agentsService.forget(one.id);
    this.forgetting.delete(one.id);
    if (res.error) {
      this.error = res.error;
      return;
    }
    this.allRemembered = this.allRemembered.filter((held) => held.id !== one.id);
  }

  // ── What it asked ────────────────────────────────────────────────────

  cardIcon(card: InspectedCard): string {
    return InspectorSetupComponent.CARD_ICONS[card.kind] ?? 'circle-question-mark';
  }

  question(card: InspectedCard): string {
    return cardQuestion(card, this.names);
  }

  cardMeta(card: InspectedCard): string {
    return [agentName(card.agent, this.names), relativeDate(card.at)].filter(Boolean).join(' · ');
  }

  /** How it stands: waiting, expired, or how it was answered. */
  outcome(card: InspectedCard): string {
    if (card.status === 'open') return 'Waiting';
    if (card.status === 'expired') return 'Expired';
    return answerWords(card.answer) || 'Answered';
  }
}
