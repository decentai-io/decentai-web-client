import { Component, EventEmitter, Input, OnInit, Output } from '@angular/core';

import { ChatSettings } from 'src/app/models/chat-protocol';
import { ActivityService, Schedule } from 'src/app/services/activity.service';
import { AgentsService, InstalledAgent, RememberedApproval } from 'src/app/services/agents.service';
import { WorkEntry } from 'src/app/services/chat-state.service';
import { TRUST_CHOICES } from '../chat-defaults';

/**
 * Everything about one chat in one place, beside the conversation: what
 * runs now (its own work, its tasks, its schedules' and webhooks' runs),
 * each stoppable; its schedules and when each runs next; the decisions
 * its person remembered for the agents it uses, each to forget; and its
 * setup. It reads the schedules and the remembered decisions itself, each
 * time it opens.
 */
@Component({
  selector: 'app-chat-panel',
  standalone: false,
  templateUrl: './chat-panel.component.html',
  styleUrl: './chat-panel.component.css',
})
export class ChatPanelComponent implements OnInit {
  @Input() chatId = '';
  @Input({ required: true }) settings!: ChatSettings;
  /** The chat's work, every piece of it. */
  @Input() work: WorkEntry[] = [];
  /** How many cards wait for the person. */
  @Input() waiting = 0;
  /** The agents this chat uses, and every installed agent's name by id. */
  @Input() agents: InstalledAgent[] = [];
  @Input() names: Record<string, string> = {};
  /** The model, as the chat's picker names it. */
  @Input() model = '';
  @Input() stopping: string[] = [];
  @Output() closed = new EventEmitter<void>();
  @Output() stopWork = new EventEmitter<string>();
  @Output() changeAgents = new EventEmitter<void>();
  @Output() changeSkills = new EventEmitter<void>();

  schedules: Schedule[] = [];
  private allRemembered: RememberedApproval[] = [];
  readonly forgetting = new Set<string>();
  error = '';

  constructor(private activity: ActivityService, private agentsService: AgentsService) {}

  async ngOnInit(): Promise<void> {
    const [schedules, remembered] = await Promise.all([
      this.activity.schedules(this.chatId).catch(() => ({ schedules: [] as Schedule[] })),
      this.agentsService.remembered().catch(() => [] as RememberedApproval[]),
    ]);
    this.schedules = schedules.schedules;
    this.allRemembered = remembered;
  }

  /** What runs or waits now, anywhere in the chat. */
  get active(): WorkEntry[] {
    return this.work.filter((entry) => entry.status === 'running' || entry.status === 'waiting');
  }

  /** Whose a piece of work is: the chat's own, a task, or a run. */
  where(entry: WorkEntry): string {
    if (entry.run) return `${entry.run.origin === 'webhook' ? 'Webhook' : 'Scheduled'} · ${entry.run.title}`;
    return entry.kind === 'task' ? 'A task' : entry.status === 'waiting' ? 'Waiting for you' : 'This chat';
  }

  /** The remembered decisions for the agents and servers this chat uses. */
  get remembered(): RememberedApproval[] {
    const agents = new Set(this.agents.map((agent) => agent.agent_id));
    const servers = this.settings.mcp_servers;
    return this.allRemembered.filter((one) => one.agent.startsWith('mcp:')
      ? !servers || servers.includes(one.agent.slice(4)) : agents.has(one.agent));
  }

  agentName(agent: string): string {
    return agent.startsWith('mcp:') ? 'A server of yours' : this.names[agent] || agent;
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

  get trust(): string {
    return TRUST_CHOICES.find((choice) => choice.value === this.settings.trust)?.name ?? String(this.settings.trust);
  }

  /** The agents it uses, in words: "Mail, Calendar and 2 more". */
  get agentWords(): string {
    if (!this.agents.length) return 'None';
    const names = this.agents.slice(0, 2).map((agent) => agent.name).join(', ');
    return this.agents.length > 2 ? `${names} and ${this.agents.length - 2} more` : names;
  }

  /** A list setting in words: every one the person may use, none, or how many. */
  chosen(value: string[] | null): string {
    if (!value) return 'All yours';
    return value.length ? `${value.length} chosen` : 'None';
  }

  /** What a schedule runs: a prompt, or an agent's function. */
  what(schedule: Schedule): string {
    return 'prompt' in schedule.what ? schedule.what.prompt : schedule.what.function;
  }

  /** When a schedule runs next, or why it doesn't. */
  next(schedule: Schedule): string {
    if (schedule.paused) return 'Paused';
    if (!schedule.next_at) return 'Ran';
    return new Date(schedule.next_at).toLocaleString(undefined, { weekday: 'short', hour: '2-digit', minute: '2-digit' });
  }
}
