import { Component, EventEmitter, Input, OnChanges, Output, SimpleChanges } from '@angular/core';
import { Router } from '@angular/router';
import { MarkdownService } from 'ngx-markdown';

import { relativeDate } from 'src/app/components/ui/dates';
import { headingsDown } from 'src/app/components/ui/markdown-levels';
import { Choice } from 'src/app/components/ui/radio-keys';
import {
  AgentsService, InstalledAgent, RememberedApproval, SampleSummary,
} from 'src/app/services/agents.service';
import { ChatMarkdownService } from '../ai/chat/chat-message/chat-markdown.service';
import {
  AgentCount, AgentNetwork, KeptItem, Standing, agentCounts, credentialHost, iconOf, keptItems, levelBar, levelMeaning,
  levelTally, networkNote, networkOf, resourcesOf,
} from './agent-shared';

/** How long a README is shown whole; a longer one is folded. */
const README_FOLD_CHARS = 900;

export type DetailTab = 'overview' | 'functions' | 'access';

/**
 * One agent's page: the title row, its few numbers, the row of sections,
 * and the Overview, one column read top to bottom: what to say to it
 * and its samples to try it on, what it may do, where it connects, what
 * it keeps, the approvals the person remembered for it, who may use it,
 * and then the details. Its functions are a section of their own
 * (agent-functions).
 *
 * Who may use an agent is kept with it, by group: whoever may install
 * agents chooses on its Access tab (agent-access), and the Overview
 * points there.
 */
@Component({
  selector: 'app-agent-detail',
  standalone: false,
  templateUrl: './agent-detail.component.html',
  styleUrls: ['./agent-shared.css', './agent-detail.component.css'],
  // A README is somebody else's markdown: what it would load from
  // elsewhere is taken out, as in a chat.
  providers: [{ provide: MarkdownService, useClass: ChatMarkdownService }],
})
export class AgentDetailComponent implements OnChanges {
  @Input({ required: true }) agent!: InstalledAgent;
  /** Where it stands, in the one word the list uses too. */
  @Input({ required: true }) standing!: Standing;
  @Input() canInstall = false;
  @Input() canUninstall = false;
  /** Something is under way for this agent. */
  @Input() busy = false;

  @Output() update = new EventEmitter<void>();
  @Output() check = new EventEmitter<void>();
  @Output() uninstall = new EventEmitter<void>();
  @Output() failed = new EventEmitter<string>();
  @Output() flashed = new EventEmitter<string>();

  /** Which tab is shown: the address's to say (the Installed page reads
   *  it), and asked for here with `tabChange`. */
  @Input() tab: DetailTab = 'overview';
  @Output() tabChange = new EventEmitter<DetailTab>();

  tabs: Choice<DetailTab>[] = [];
  network: AgentNetwork = networkOf(null);
  readme = '';
  readmeLong = false;
  readmeOpen = false;
  icon = '';
  counts: AgentCount[] = [];
  kept: KeptItem[] = [];
  /** The scopes who may use it can be narrowed by. */
  scopes: { name: string; description: string }[] = [];
  bar: Array<{ name: string; count: number; share: number; index: number }> = [];
  barWords = '';
  /** The host it was installed from, short; the whole address is under
   *  Details. */
  sourceHost = '';
  readonly meaningOf = levelMeaning;

  samples: SampleSummary | null = null;
  /** The person loaded the samples, and may remove them. */
  samplesLoaded = false;
  samplesBusy = false;
  /** The approvals the person remembered for this agent. */
  remembered: RememberedApproval[] = [];
  forgetting = '';

  readonly credentialHost = credentialHost;
  readonly relativeDate = relativeDate;

  constructor(
    private router: Router,
    private agents: AgentsService,
  ) {}

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['agent'] || changes['canInstall']) {
      const count = this.agent.manifest.functions.length;
      this.tabs = [
        { value: 'overview', name: 'Overview' },
        { value: 'functions', name: `Functions ${count}` },
        // Who may use it is chosen by whoever may install agents.
        ...(this.canInstall ? [{ value: 'access' as DetailTab, name: 'Access' }] : []),
      ];
    }
    const change = changes['agent'];
    if (!change) return;
    this.network = networkOf(this.agent.manifest);
    this.readme = headingsDown(this.agent.readme || '', 2);
    this.readmeLong = (this.agent.readme || '').length > README_FOLD_CHARS;
    this.icon = iconOf(this.agent.manifest);
    this.counts = agentCounts(this.agent.manifest);
    this.kept = keptItems(this.agent.manifest);
    this.scopes = Object.entries(this.agent.manifest.authorization?.scopes || {})
      .map(([name, scope]) => ({ name, description: scope.description || '' }));
    this.bar = levelBar(this.agent.manifest);
    this.barWords = this.bar.map((level) => `${level.count} ${level.name.toLowerCase()}`).join(', ');
    try {
      this.sourceHost = this.agent.source_url ? new URL(this.agent.source_url).host : '';
    } catch {
      this.sourceHost = this.agent.source_url || '';
    }
    // The same agent read again, as its check ends, is not another agent.
    if (change.previousValue?.agent_id === this.agent.agent_id) return;
    void this.readSamples();
    void this.readRemembered();
  }

  /** The tab shown: Access only for whoever may choose who uses it. */
  get shownTab(): DetailTab {
    return this.tab === 'access' && !this.canInstall ? 'overview' : this.tab;
  }

  get tally(): Array<{ name: string; count: number }> {
    return levelTally(this.agent.manifest);
  }

  get resources() {
    return resourcesOf(this.agent.manifest);
  }

  get networkNote(): string {
    return networkNote(this.network);
  }

  /** Open the chats page with this prompt written in the composer, for
   *  the person to send: the shortest path from reading what an agent
   *  does to seeing it do it. */
  tryPrompt(prompt: string): void {
    void this.router.navigate(['/ai/chats'], { queryParams: { prompt } });
  }

  // ── Sample data ─────────────────────────────────────────────────────

  private async readSamples(): Promise<void> {
    this.samples = null;
    this.samplesLoaded = this.agent.samples_loaded === true;
    if (!this.agent.samples) return;
    this.samples = await this.agents.samples(this.agent.agent_id).catch(() => null);
  }

  /** What the agent ships to try it on, as one sentence. */
  get samplesStory(): string {
    const story = String(this.samples?.story || '').trim().replace(/\.+$/, '');
    return story ? `${story}.` : '';
  }

  async loadSamples(): Promise<void> {
    if (this.samplesBusy) return;
    this.samplesBusy = true;
    try {
      const result = await this.agents.loadSamples(this.agent.agent_id);
      if (result.error) return this.failed.emit(result.error);
      this.samplesLoaded = true;
      this.flashed.emit(`Sample data loaded: ${result.loaded} ${result.loaded === 1 ? 'item' : 'items'}, `
        + 'yours now, under Records and Files.');
    } finally {
      this.samplesBusy = false;
    }
  }

  async removeSamples(): Promise<void> {
    if (this.samplesBusy) return;
    this.samplesBusy = true;
    try {
      const result = await this.agents.removeSamples(this.agent.agent_id);
      if (result.error) return this.failed.emit(result.error);
      this.samplesLoaded = false;
      this.flashed.emit('The sample data you loaded is removed.');
    } finally {
      this.samplesBusy = false;
    }
  }

  // ── Remembered approvals ────────────────────────────────────────────

  private async readRemembered(): Promise<void> {
    const all = await this.agents.remembered().catch(() => []);
    this.remembered = all.filter((approval) => approval.agent === this.agent.agent_id);
  }

  /** Take one back: the next call asks again. */
  async forget(approval: RememberedApproval): Promise<void> {
    if (this.forgetting) return;
    this.forgetting = approval.id;
    try {
      const result = await this.agents.forget(approval.id);
      if (result.error) return this.failed.emit(result.error);
      this.remembered = this.remembered.filter((candidate) => candidate.id !== approval.id);
      this.flashed.emit(`${approval.function} asks you again next time.`);
    } finally {
      this.forgetting = '';
    }
  }
}
