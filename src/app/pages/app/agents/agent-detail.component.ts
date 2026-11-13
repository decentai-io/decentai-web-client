import { Component, EventEmitter, Input, OnChanges, Optional, Output, SimpleChanges } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { Router } from '@angular/router';
import { MarkdownService } from 'ngx-markdown';
import { firstValueFrom } from 'rxjs';

import { fullDate, relativeDate } from 'src/app/components/ui/dates';
import { headingsDown } from 'src/app/components/ui/markdown-levels';
import {
  AccessFunction, AccessGroup, AccessRow, AgentFunction, AgentResource, AgentsService, InstalledAgent,
  RememberedApproval, SampleSummary,
} from 'src/app/services/agents.service';
import { AuthService } from 'src/app/services/auth.service';
import { RecordShape, RecordsService } from 'src/app/services/records.service';
import { ChatMarkdownService } from '../ai/chat/chat-message/chat-markdown.service';
import { SecretFormComponent, SecretFormData, SecretFormResult } from '../secrets/secret-form.component';
import { ACCESS_EFFECTS } from './agent-access';
import {
  AgentNetwork, KeptItem, LevelGroup, Standing, byLevel, credentialHost, hostOf, iconOf, keptItems, levelBar, levelTally,
  networkNote, networkOf, resourcesOf,
} from './agent-shared';

/** How long a README is shown whole; a longer one is folded. */
const README_FOLD_CHARS = 900;
/** How many hosts the side shows before "and n more". */
const HOSTS_SHOWN = 4;
/** How many functions a level shows on the Overview before "n more". */
const NAMES_SHOWN = 5;

export type DetailTab = 'overview' | 'functions' | 'access';

/** One of the page's tabs, with the count it carries. */
export interface DetailTabChoice {
  value: DetailTab;
  name: string;
  count?: number;
}

/** A secret the agent asks for, and whether the person has one. */
export interface SecretSlot {
  resource: AgentResource;
  label: string;
  /** Whether a secret of it is there; null where it can't be read. */
  set: boolean | null;
  /** What a new one is made of, when the person may add one. */
  shape: RecordShape | null;
}

/** One group's row, as the side says it. */
export interface AccessLine {
  group: string;
  members: string;
  effect: AccessRow['effect'];
  word: string;
  reach: string;
}

/**
 * One agent's page, the width of the window: a band with who it is and
 * what can be done (start a chat, check it again, and the rest in a
 * menu), then two columns. The main one holds the tabs: the Overview
 * (what to say to it, samples to try it on, what it can do by level, the
 * approvals the person remembered, and its publisher's account), its
 * Functions as a table (agent-functions), and who may use it (Access,
 * agent-access). Beside it, "At a glance": the facts a person checks
 * first, from where it came to who may use it, each with the way to
 * act on it. On a narrow screen the side comes under the tabs.
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

  tabs: DetailTabChoice[] = [];
  network: AgentNetwork = networkOf(null);
  readme = '';
  readmeLong = false;
  readmeOpen = false;
  icon = '';
  kept: KeptItem[] = [];
  /** The records and files it keeps: the secrets are said on their own. */
  keeps: KeptItem[] = [];
  /** The scopes who may use it can be narrowed by. */
  scopes: { name: string; description: string }[] = [];
  /** Its functions by level. */
  levels: LevelGroup<AgentFunction>[] = [];
  bar: Array<{ name: string; count: number; share: number; index: number }> = [];
  barWords = '';
  /** The host it was installed from, short; the whole address is under
   *  Details. */
  sourceHost = '';
  /** The level the Functions tab is narrowed to, when the side asked. */
  functionsLevel: number | null = null;
  hostsOpen = false;
  readonly hostsShown = HOSTS_SHOWN;
  readonly namesShown = NAMES_SHOWN;

  samples: SampleSummary | null = null;
  /** The person loaded the samples, and may remove them. */
  samplesLoaded = false;
  samplesBusy = false;
  /** The approvals the person remembered for this agent. */
  remembered: RememberedApproval[] = [];
  forgetting = '';

  secrets: SecretSlot[] = [];
  /** Who may use it, by group, for whoever may choose. */
  access: { state: 'loading' | 'ready' | 'refused' | 'failed'; lines: AccessLine[] } = { state: 'loading', lines: [] };

  readonly credentialHost = credentialHost;
  readonly relativeDate = relativeDate;
  readonly fullDate = fullDate;

  constructor(
    private router: Router,
    private agents: AgentsService,
    @Optional() private records?: RecordsService,
    @Optional() private auth?: AuthService,
    @Optional() private dialog?: MatDialog,
  ) {}

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['agent'] || changes['canInstall']) {
      this.tabs = [
        { value: 'overview', name: 'Overview' },
        { value: 'functions', name: 'Functions', count: this.agent.manifest.functions.length },
        // Who may use it is chosen by whoever may install agents.
        ...(this.canInstall ? [{ value: 'access' as DetailTab, name: 'Access' }] : []),
      ];
    }
    const change = changes['agent'];
    if (!change) return;
    const manifest = this.agent.manifest;
    this.network = networkOf(manifest);
    this.readme = headingsDown(this.agent.readme || '', 2);
    this.readmeLong = (this.agent.readme || '').length > README_FOLD_CHARS;
    this.icon = iconOf(manifest);
    this.kept = keptItems(manifest);
    this.keeps = this.kept.filter((item) => item.kind !== 'secrets');
    this.scopes = Object.entries(manifest.authorization?.scopes || {})
      .map(([name, scope]) => ({ name, description: scope.description || '' }));
    this.levels = byLevel(manifest.functions || []);
    this.bar = levelBar(manifest);
    this.barWords = this.bar.map((level) => `${level.count} ${level.name.toLowerCase()}`).join(', ');
    this.sourceHost = hostOf(this.agent.source_url);
    // The same agent read again, as its check ends, is not another agent.
    if (change.previousValue?.agent_id === this.agent.agent_id) return;
    this.functionsLevel = null;
    this.hostsOpen = false;
    void this.readSamples();
    void this.readRemembered();
    void this.readSecrets();
    void this.readAccess();
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

  /** Every host it reaches, as the side lists them. */
  get hosts(): string[] {
    return [...this.network.hosts, ...this.network.from_secrets.map((field) => credentialHost(field))];
  }

  /** A tab, asked for; the side's levels ask for Functions at a level. */
  openTab(tab: DetailTab, level: number | null = null): void {
    this.functionsLevel = tab === 'functions' ? level : null;
    this.tabChange.emit(tab);
  }

  /** A new chat: the shortest path from reading what an agent does to
   *  seeing it do it. */
  startChat(): void {
    void this.router.navigate(['/ai/chats']);
  }

  /** Open the chats page with this prompt written in the composer, for
   *  the person to send. */
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

  // ── The secrets it needs ────────────────────────────────────────────

  /** May the person read their secrets, and so be told which are set. */
  get canReadSecrets(): boolean {
    return !!this.records && !!this.auth?.can('secrets:secret:list');
  }

  /** Each secret it asks for, and whether the person has one of it. */
  private async readSecrets(): Promise<void> {
    const agent = this.agent;
    const declared = agent.manifest.resources?.secrets || [];
    this.secrets = declared.map((resource) => ({ resource, label: resource.label || resource.id, set: null, shape: null }));
    if (!declared.length || !this.canReadSecrets || !this.records) return;
    const records = this.records;
    const shapes = await records.shapes('secret').catch(() => [] as RecordShape[]);
    const slots = await Promise.all(declared.map(async (resource) => {
      const found = await records.list('secret', { of: { agent: agent.agent_id, resource: resource.id } })
        .then((list) => list.records.length > 0).catch(() => null);
      const shape = shapes.find((candidate) => candidate.agent === agent.agent_id && candidate.id === resource.id) || null;
      return { resource, label: resource.label || resource.id, set: found, shape };
    }));
    // Another agent opened while these were read is not this one's.
    if (this.agent === agent) this.secrets = slots;
  }

  /** The secrets it asks for that the person has not added. */
  get secretsMissing(): number {
    return this.secrets.filter((slot) => slot.set === false).length;
  }

  /** Add one, in the dialog the Secrets page uses, already of this kind. */
  async addSecret(slot: SecretSlot): Promise<void> {
    if (!this.dialog || !slot.shape) return;
    const ref = this.dialog.open<SecretFormComponent, SecretFormData, SecretFormResult | null>(
      SecretFormComponent, { width: '560px', maxWidth: '100vw', data: { shapes: [slot.shape], shape: slot.shape } });
    const done = await firstValueFrom(ref.afterClosed());
    if (!done) return;
    this.flashed.emit(done.notice);
    await this.readSecrets();
  }

  // ── Who may use it ──────────────────────────────────────────────────

  private async readAccess(): Promise<void> {
    this.access = { state: 'loading', lines: [] };
    if (!this.canInstall) {
      this.access = { state: 'refused', lines: [] };
      return;
    }
    const agentId = this.agent.agent_id;
    const answer = await this.agents.access(agentId).catch(() => ({ error: 'unreachable' } as { error: string; code?: string }));
    if (this.agent.agent_id !== agentId) return;
    if ('error' in answer && answer.error) {
      this.access = { state: answer.code === 'refused' ? 'refused' : 'failed', lines: [] };
      return;
    }
    const read = answer as { access?: AccessRow[]; groups?: AccessGroup[]; functions?: AccessFunction[] };
    this.accessSaved({ access: read.access ?? [], groups: read.groups ?? [], functions: read.functions ?? [] });
  }

  /** The rows as the Access tab saved them, said in the side. */
  accessSaved(saved: { access: AccessRow[]; groups: AccessGroup[]; functions: AccessFunction[] }): void {
    const words = new Map(ACCESS_EFFECTS.map((effect) => [effect.value, effect.name]));
    this.access = {
      state: 'ready',
      lines: saved.access.map((row) => {
        const group = saved.groups.find((candidate) => candidate.group_id === row.group_id);
        const every = row.functions.includes('*');
        const chosen = saved.functions.filter((fn) => row.functions.includes(fn.id)).length;
        return {
          group: group?.name || 'A group no longer there',
          members: typeof group?.members === 'number' ? `${group.members} ${group.members === 1 ? 'person' : 'people'}` : '',
          effect: row.effect,
          word: words.get(row.effect) || row.effect,
          reach: every ? 'All functions' : `${chosen} of ${saved.functions.length} functions`,
        };
      }),
    };
  }
}
