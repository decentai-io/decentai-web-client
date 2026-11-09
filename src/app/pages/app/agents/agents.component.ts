import { Component, OnDestroy, OnInit } from '@angular/core';
import { ActivatedRoute, NavigationEnd, Router } from '@angular/router';
import { Subscription } from 'rxjs';
import { filter } from 'rxjs/operators';

import { Choice } from 'src/app/components/ui/radio-keys';
import { AgentsService, InstalledAgent } from 'src/app/services/agents.service';
import { AuthService } from 'src/app/services/auth.service';
import { ConfirmService } from 'src/app/services/confirm.service';
import { ProfileService } from 'src/app/services/profile.service';
import { DataPageBase } from '../data-page-base';
import { DetailTab } from './agent-detail.component';
import { Standing, agentFacts, standingOf } from './agent-shared';

/** The tabs an address may name. */
const TABS: DetailTab[] = ['overview', 'functions'];

/**
 * Installed agents: the ones this person may use, and for an
 * administrator every one installed, whatever its state.
 *
 * This page is the list and the one decision that belongs to the SET
 * rather than to any single agent: which agents new chats start with.
 * Everything about one agent is on its own view (agent-detail.component).
 * Finding new agents is the marketplace's job, not this page's.
 *
 * The list is /agents; an agent's page is /agents/<id>, and its
 * functions /agents/<id>/functions. They are views of this one page
 * (routes/app/agents.routes.ts), which reads which one from the address
 * after each navigation, so Back and a pasted link both work.
 */
@Component({
  selector: 'app-agents',
  standalone: false,
  templateUrl: './agents.component.html',
  styleUrl: './agent-shared.css',
})
export class AgentsComponent extends DataPageBase implements OnInit, OnDestroy {
  loading = true;
  agents: InstalledAgent[] = [];
  /** The agents whose source offers a newer version. */
  updates = new Set<string>();
  busyId = '';
  query = '';
  filter: 'all' | 'attention' | 'updates' = 'all';
  page = 1;
  readonly pageSize = 12;

  openAgent: InstalledAgent | null = null;
  /** The open agent's tab, as the address names it. */
  openTab: DetailTab = 'overview';
  private address = new Subscription();

  /** What a new chat starts with (preferences.chat), whole: it is saved
   *  whole. Its `agents` null, or not there, is every agent the person
   *  may use; a list is those alone. */
  private chatDefaults: Record<string, unknown> = {};
  /** The agent whose switch is mid-write, so only that one is frozen. */
  savingDefaultFor = '';
  /** Ticked for a bulk uninstall, by id — pruned on every reload, so a
   *  row that has gone cannot stay selected. */
  selected = new Set<string>();
  /** A run is in flight; busyId names the one being withdrawn now. */
  bulkBusy = false;

  constructor(
    private service: AgentsService,
    public auth: AuthService,
    private profile: ProfileService,
    private confirm: ConfirmService,
    private router?: Router,
    private route?: ActivatedRoute,
  ) {
    super();
  }

  async ngOnInit(): Promise<void> {
    await this.reload();
    this.loading = false;
    await this.readAddress();
    if (this.router) {
      this.address.add(this.router.events
        .pipe(filter((event) => event instanceof NavigationEnd))
        .subscribe(() => void this.readAddress()));
    }
    const profile = await this.profile.get().catch(() => null);
    this.chatDefaults = { ...(profile?.preferences?.chat || {}) };
  }

  /** Show what the address names: the list, or an agent and its tab. */
  private async readAddress(): Promise<void> {
    const params = this.route?.snapshot.firstChild?.paramMap;
    const id = params?.get('ref') || '';
    if (!id) {
      if (this.openAgent) this.showList();
      return;
    }
    const agent = this.agents.find((candidate) => candidate.agent_id === id);
    if (!agent) {
      this.showList();
      this.fail('That agent is not installed here, or is not one you may use.');
      void this.router?.navigate(['/agents'], { replaceUrl: true });
      return;
    }
    if (this.openAgent?.agent_id !== id) this.showAgent(agent);
    const tab = params?.get('tab') as DetailTab | null;
    this.openTab = tab && TABS.includes(tab) ? tab : 'overview';
  }

  private async reload(): Promise<void> {
    this.agents = await this.service.installed();
    // Only an administrator reads what the sources offer.
    const offers = this.canInstall ? await this.service.available().catch(() => []) : [];
    this.updates = new Set(offers.filter((offer) => offer.status === 'update_available')
      .map((offer) => offer.manifest.agent.id));
    // A tick on a row that no longer exists would count toward a bulk
    // action nobody can see.
    this.selected = new Set([...this.selected].filter(
      (id) => this.agents.some((agent) => agent.agent_id === id)));
    this.followOpenAgent();
    this.watchChecking();
  }

  /** The open agent is one of the rows just read: it is shown from the
   *  fresh row, or closed when it is gone. */
  private followOpenAgent(): void {
    const open = this.openAgent;
    if (!open) return;
    const fresh = this.agents.find((agent) => agent.agent_id === open.agent_id);
    if (!fresh) this.closeDetail();
    else if (JSON.stringify(fresh) !== JSON.stringify(open)) this.openAgent = fresh;
  }

  get canInstall(): boolean { return this.auth.can('agents:agent:install'); }
  get canUninstall(): boolean { return this.auth.can('agents:agent:delete'); }

  // ── A runtime's check ───────────────────────────────────────────────

  /** While a runtime checks an agent, the page asks again every few
   *  seconds, and stops the moment none is being checked. */
  private checkingTimer: ReturnType<typeof setInterval> | null = null;
  /** A read still under way when the page closes must not start the
   *  timer again. */
  private destroyed = false;

  private watchChecking(): void {
    const checking = this.agents.some((agent) => agent.state === 'checking');
    if (!checking || this.destroyed) {
      this.stopWatching();
      return;
    }
    if (!this.checkingTimer) this.checkingTimer = setInterval(() => { void this.reload(); }, 4000);
  }

  private stopWatching(): void {
    if (this.checkingTimer) {
      clearInterval(this.checkingTimer);
      this.checkingTimer = null;
    }
  }

  ngOnDestroy(): void {
    this.destroyed = true;
    this.address.unsubscribe();
    this.stopWatching();
  }

  /** Ask a runtime to check an installed agent again: after a failure,
   *  or when the runtimes changed. */
  async check(agent: InstalledAgent): Promise<void> {
    if (this.busyId) return;
    this.busyId = agent.agent_id;
    try {
      const result = await this.service.check(agent.agent_id);
      if (result.error) return this.fail(result.error);
      await this.reload();
      const checked = this.agents.find((candidate) => candidate.agent_id === agent.agent_id);
      if (checked?.state === 'failed') this.fail(`${agent.name} failed its check: ${checked.error}`);
      else this.flash(`${agent.name} ${checked?.state === 'ready' ? 'passed its check' : 'is being checked'}.`);
    } finally {
      this.busyId = '';
    }
  }

  // ── One agent, opened in place ──────────────────────────────────────

  closeDetail(): void {
    void this.router?.navigate(['/agents']);
    this.showList();
  }

  /** One of the open agent's tabs, each at an address of its own. */
  openTabOf(tab: DetailTab): void {
    if (!this.openAgent) return;
    this.openTab = tab;
    void this.router?.navigate(['/agents', this.openAgent.agent_id, ...(tab === 'overview' ? [] : [tab])]);
  }

  private showAgent(agent: InstalledAgent): void {
    this.openAgent = agent;
    this.error = '';
    this.notice = '';
  }

  private showList(): void {
    this.openAgent = null;
    this.error = '';
  }

  // ── What new chats start with ───────────────────────────────────────
  //
  // The switch lives on the agent because that is what it is about. With
  // no Save button the write happens now, and the switch goes back if it
  // fails: a switch that lies about what was saved is worse than one
  // that moves twice.

  /** The agents a new chat starts with; null is every one. */
  private get chosen(): string[] | null {
    const agents = this.chatDefaults['agents'];
    return Array.isArray(agents) ? agents.map(String) : null;
  }

  isDefault(agent: InstalledAgent): boolean {
    return !this.chosen || this.chosen.includes(agent.agent_id);
  }

  async toggleDefault(agent: InstalledAgent): Promise<void> {
    if (this.savingDefaultFor) return;
    const on = this.agents.filter((candidate) =>
      candidate.agent_id === agent.agent_id ? !this.isDefault(candidate) : this.isDefault(candidate));
    // Every one switched on is said as all, so an agent installed later is
    // in new chats too.
    const agents = on.length === this.agents.length ? null : on.map((candidate) => candidate.agent_id);
    const was = this.chatDefaults;
    this.chatDefaults = { ...was, agents };
    this.savingDefaultFor = agent.agent_id;
    try {
      const result = await this.profile.savePreferences({ chat: this.chatDefaults });
      if (result.error) {
        this.chatDefaults = was;
        return this.fail(result.error);
      }
      this.flash(`${agent.name} will${this.isDefault(agent) ? '' : ' not'} be in new chats.`);
    } finally {
      this.savingDefaultFor = '';
    }
  }

  get defaultCount(): number {
    return this.agents.filter((agent) => this.isDefault(agent)).length;
  }

  // ── The list ────────────────────────────────────────────────────────

  standing(agent: InstalledAgent): Standing {
    return standingOf(agent, this.updates.has(agent.agent_id));
  }

  /** Everything but Ready needs somebody: the counts and the filter are
   *  read from the same standing the cards show. */
  needsAttention(agent: InstalledAgent): boolean {
    return this.standing(agent).kind !== 'ready';
  }

  facts(agent: InstalledAgent): string[] {
    return agentFacts(agent.manifest);
  }

  /** The three views of the list, each saying how many it holds. The
   *  same array until a count changes: the control draws its choices
   *  again for a new one. */
  get filters(): Choice<'all' | 'attention' | 'updates'>[] {
    const counts = [this.agents.length, this.agents.filter((agent) => this.needsAttention(agent)).length,
      this.agents.filter((agent) => this.updates.has(agent.agent_id)).length];
    if (counts.join() !== this.filterCounts.join()) {
      this.filterCounts = counts;
      this.filterChoices = [
        { value: 'all', name: `All ${counts[0]}` },
        { value: 'attention', name: `Needs attention ${counts[1]}` },
        { value: 'updates', name: `Updates ${counts[2]}` },
      ];
    }
    return this.filterChoices;
  }
  private filterCounts: number[] = [];
  private filterChoices: Choice<'all' | 'attention' | 'updates'>[] = [];

  /** The line under the grid. */
  get foot(): string {
    if (!this.agents.length) return '';
    const ready = this.agents.filter((agent) => agent.state === 'ready').length;
    return `${this.agents.length} installed · ${ready} ready · ${this.defaultCount} in new chats`;
  }

  get shownAgents(): InstalledAgent[] {
    const query = this.query.trim().toLowerCase();
    return this.agents.filter((agent) => {
      if (this.filter === 'attention' && !this.needsAttention(agent)) return false;
      if (this.filter === 'updates' && !this.updates.has(agent.agent_id)) return false;
      return !query || `${agent.name} ${agent.agent_id} ${agent.manifest.agent.description || ''}`
        .toLowerCase().includes(query);
    });
  }

  get pagedAgents(): InstalledAgent[] {
    const start = (this.page - 1) * this.pageSize;
    return this.shownAgents.slice(start, start + this.pageSize);
  }

  setFilter(filter: 'all' | 'attention' | 'updates'): void {
    this.filter = filter;
    this.page = 1;
  }

  search(value: string): void {
    this.query = value;
    this.page = 1;
  }

  /** The version waiting at the agent's source, opened where it is read:
   *  an update is reviewed and installed like any version, and nothing is
   *  installed from here. */
  update(agent: InstalledAgent): void {
    void this.router?.navigate(['/agents/marketplace'], { queryParams: { review: agent.agent_id } });
  }

  // ── Choosing several at once ────────────────────────────────────────

  isSelected(agent: InstalledAgent): boolean {
    return this.selected.has(agent.agent_id);
  }

  toggleSelected(agent: InstalledAgent): void {
    if (!this.selected.delete(agent.agent_id)) this.selected.add(agent.agent_id);
  }

  /** What "select all" means here: what is on screen under the current
   *  search and filter, never the rows they are hiding. */
  get selectableShown(): InstalledAgent[] {
    return this.canUninstall ? this.shownAgents : [];
  }

  selectAllShown(): void {
    for (const agent of this.selectableShown) this.selected.add(agent.agent_id);
  }

  clearSelection(): void {
    this.selected.clear();
  }

  // ── Uninstalling: one question, whether it is one agent or twelve ───

  get uninstallBusy(): boolean {
    return !!this.busyId || this.bulkBusy;
  }

  requestUninstall(agent: InstalledAgent): Promise<void> {
    return this.askUninstall([agent]);
  }

  requestUninstallSelected(): Promise<void> {
    return this.askUninstall(this.agents.filter((agent) => this.isSelected(agent)));
  }

  /** Asked once, by name, saying what goes and what stays. */
  private async askUninstall(going: InstalledAgent[]): Promise<void> {
    if (!going.length || this.uninstallBusy) return;
    const one = going.length === 1;
    const names = going.map((agent) => agent.name).join(', ');
    const sure = await this.confirm.ask({
      title: one ? `Uninstall ${names}?` : `Uninstall ${going.length} agents?`,
      body: (one ? '' : `${names}. `)
        + `${one ? 'It runs' : 'They run'} no more. The records ${one ? 'it' : 'they'} kept stay their `
        + `people's, and installing ${one ? 'it' : 'them'} again gives them back.`,
      confirm: one ? 'Uninstall' : `Uninstall ${going.length}`,
      danger: true,
    });
    if (sure) await this.uninstall(going);
  }

  /** Withdraw each in turn, and say what actually happened. One refusal
   *  neither stops the rest nor hides them: what went is gone, what did
   *  not is named and stays ticked. */
  private async uninstall(going: InstalledAgent[]): Promise<void> {
    const gone: string[] = [];
    const refused: string[] = [];
    this.bulkBusy = true;
    try {
      for (const agent of going) {
        this.busyId = agent.agent_id;
        const result = await this.service.uninstall(agent.agent_id);
        if (result.error) {
          refused.push(`${agent.name} (${result.error})`);
          continue;
        }
        gone.push(agent.name);
        this.selected.delete(agent.agent_id);
      }
    } finally {
      this.busyId = '';
      this.bulkBusy = false;
    }
    await this.reload();
    if (refused.length) {
      this.fail(`Uninstalled ${gone.length}. Still installed: ${refused.join('; ')}`);
    } else {
      this.flash(gone.length === 1 ? `${gone[0]} uninstalled.` : `${gone.length} agents uninstalled.`);
    }
  }
}
