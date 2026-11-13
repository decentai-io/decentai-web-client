import { Component, OnDestroy, OnInit, TemplateRef, ViewChild } from '@angular/core';
import { MatDialog, MatDialogRef } from '@angular/material/dialog';
import { ActivatedRoute, NavigationEnd, Router } from '@angular/router';
import { Subscription } from 'rxjs';
import { filter } from 'rxjs/operators';

import { relativeDate } from 'src/app/components/ui/dates';
import { Choice } from 'src/app/components/ui/radio-keys';
import {
  AgentSource, AgentsService, CatalogOffer, InstalledAgent, Manifest,
} from 'src/app/services/agents.service';
import { ConfirmService } from 'src/app/services/confirm.service';
import { DataPageBase } from '../../data-page-base';
import { CardChip, CardLevel } from '../agent-card.component';
import { AgentStat, agentFacts, agentStats, iconOf, levelBar } from '../agent-shared';
import { SourceDraft } from './source-form.component';

/** Which of a source's agents are shown, and in what order. */
type OfferFilter = 'all' | 'new' | 'installed' | 'updates';
type OfferSort = 'listed' | 'name';

/**
 * The marketplace: where agents come FROM.
 *
 * A source is a catalog's address the organization saved. The sources
 * are a row of chips, and the chosen one's catalog is the page: with
 * nothing chosen in the address, the first source is. The review of one
 * agent, or of several ticked together, takes the page's place.
 *
 * Nothing on this page is running. A catalog is kept as it was read, and
 * installing pins the version reviewed to that reading: a source read
 * again since is reviewed again.
 *
 * Each view has an address under /agents/marketplace: a source's
 * catalog is /<source>, the review of one of its agents /<source>/<agent>
 * (several are their ids with commas between), the source form (a dialog
 * over the page) /sources/new and /<source>/edit. They are views of this
 * one page (routes/app/agents.routes.ts): the page reads the address
 * after each navigation, so Back and a pasted link both work.
 */
@Component({
  selector: 'app-agent-marketplace',
  standalone: false,
  templateUrl: './marketplace.component.html',
  styleUrls: ['../agent-shared.css', './marketplace.component.css'],
})
export class MarketplaceComponent extends DataPageBase implements OnInit, OnDestroy {
  private address = new Subscription();
  loading = true;
  /** The one source an action is in flight for, or 'review'. */
  busyId = '';

  sources: AgentSource[] = [];
  /** The catalog address this deployment suggests. */
  reference = '';
  /** What every source offers, against what is installed. */
  offers: CatalogOffer[] = [];
  /** What is installed: what an update is read against, and what goes
   *  with a source that is deleted. */
  installed: InstalledAgent[] = [];

  /** Which source the address names; none is the first one. */
  selectedId = '';
  query = '';
  filter: OfferFilter = 'all';
  sort: OfferSort = 'listed';
  page = 1;
  readonly pageSize = 12;

  readonly sorts: Choice<OfferSort>[] = [
    { value: 'listed', name: 'As listed' },
    { value: 'name', name: 'By name' },
  ];

  /** The source form, on the dialog shell. */
  @ViewChild('sourceDialog') private sourceDialog?: TemplateRef<unknown>;
  private formRef: MatDialogRef<unknown> | null = null;
  formOpen = false;
  editing: AgentSource | null = null;
  saving = false;
  /** Why the last save was refused, for the form. */
  formError = '';

  /** What is under review: one agent, or the several ticked together. */
  review: { source: AgentSource; offers: CatalogOffer[] } | null = null;
  /** Offers ticked to be reviewed together, keyed per source so one
   *  source's ticks never drag another's along. */
  selected = new Set<string>();
  private catalogScrollY = 0;

  constructor(
    private service: AgentsService,
    private route?: ActivatedRoute,
    private router?: Router,
    private dialog?: MatDialog,
    private confirm?: ConfirmService,
  ) {
    super();
  }

  ngOnDestroy(): void {
    this.address.unsubscribe();
    this.formOpen = false;
    this.formRef?.close();
  }

  async ngOnInit(): Promise<void> {
    await this.load();
    this.loading = false;
    const wanted = this.route?.snapshot.queryParamMap.get('review');
    if (wanted) await this.openReviewOf(wanted);
    else await this.readAddress();
    if (this.router) {
      this.address.add(this.router.events
        .pipe(filter((event) => event instanceof NavigationEnd))
        .subscribe(() => void this.readAddress()));
    }
  }

  private async load(): Promise<void> {
    const [sources, offers, installed] = await Promise.all([
      this.service.sources(), this.service.available(), this.service.installed(),
    ]);
    if (sources.error) this.fail(sources.error);
    this.sources = sources.sources;
    this.reference = sources.reference;
    this.offers = offers;
    this.installed = installed;
  }

  /** Say the view in the address: the segments after /agents/marketplace. */
  private go(...segments: string[]): void {
    void this.router?.navigate(['/agents/marketplace', ...segments]);
  }

  /** Show what the address names. Each part is left alone where the
   *  page already shows it, so pressing something here, which changes
   *  the view and then the address, does not do the work twice. */
  private async readAddress(): Promise<void> {
    const child = this.route?.snapshot.firstChild;
    const path = child?.routeConfig?.path ?? '';
    const named = child?.paramMap.get('source') || '';
    const source = this.sources.find((candidate) => candidate.source_id === named) || null;

    if (path === 'sources/new') {
      if (!this.formOpen || this.editing) this.showForm(null);
      return;
    }
    if (path === ':source/edit' && source) {
      if (this.editing !== source) this.showForm(source);
      return;
    }
    if (this.formOpen) this.hideForm();
    if (!source) {
      if (this.review) this.hideReview();
      if (this.selectedId) this.showSource(null);
      if (named) {
        this.fail('That source is not one of this organization\'s any more.');
        this.go();
      }
      return;
    }
    if (this.selectedId !== source.source_id) this.showSource(source);
    const agents = (child?.paramMap.get('agent') || '').split(',').filter(Boolean);
    if (!agents.length) {
      if (this.review) this.hideReview();
      return;
    }
    const offers = agents.map((agent) => this.offersOf(source).find((offer) => this.idOf(offer) === agent));
    if (offers.some((offer) => !offer)) {
      this.fail('That agent is not in this source\'s catalog.');
      this.go(source.source_id);
      return;
    }
    const shown = this.review?.source.source_id === source.source_id
      && this.review.offers.map((offer) => this.idOf(offer)).join() === agents.join();
    if (!shown) this.showReview(source, offers as CatalogOffer[]);
  }

  /** An installed agent's page asked for its update to be read
   *  (`?review=<agent id>`): its source is opened and the review with it. */
  async openReviewOf(agentId: string): Promise<void> {
    const offer = this.offers.find((candidate) =>
      this.idOf(candidate) === agentId && candidate.status === 'update_available');
    const source = this.sources.find((candidate) => candidate.source_id === offer?.source_id);
    if (!offer || !source) {
      this.fail('No source offers a newer version of that agent: there is nothing to review.');
      return;
    }
    this.showSource(source);
    this.openReview(source, [offer]);
  }

  // ── The list ────────────────────────────────────────────────────────

  /** The source whose catalog is shown: the one the address names, or
   *  the first. */
  get current(): AgentSource | null {
    return this.sources.find((source) => source.source_id === this.selectedId) || this.sources[0] || null;
  }

  private showSource(source: AgentSource | null): void {
    this.selectedId = source?.source_id || '';
    this.query = '';
    this.filter = 'all';
    this.page = 1;
  }

  /** A source as a chip says it: its catalog's name, or its host. */
  sourceName(source: AgentSource): string {
    if (source.name) return source.name;
    try {
      return new URL(source.url).host;
    } catch {
      return source.url;
    }
  }

  offersOf(source: AgentSource): CatalogOffer[] {
    return this.offers.filter((offer) => offer.source_id === source.source_id);
  }

  idOf(offer: CatalogOffer): string {
    return offer.manifest.agent.id;
  }

  nameOf(offer: CatalogOffer): string {
    return offer.manifest.agent.name || this.idOf(offer);
  }

  private matchesFilter(offer: CatalogOffer, filter: OfferFilter): boolean {
    switch (filter) {
      case 'new': return offer.status === 'not_installed';
      case 'installed': return offer.status === 'installed' || offer.status === 'update_available';
      case 'updates': return offer.status === 'update_available';
      default: return true;
    }
  }

  /** The filter's choices with how many agents each holds, made again
   *  only when a count changes: a new list on every check would redraw
   *  the control under the pointer. */
  get filters(): Choice<OfferFilter>[] {
    const offers = this.current ? this.offersOf(this.current) : [];
    const counts = (['all', 'new', 'installed', 'updates'] as OfferFilter[])
      .map((filter) => offers.filter((offer) => this.matchesFilter(offer, filter)).length);
    if (counts.join() !== this.filterCounts.join()) {
      this.filterCounts = counts;
      this.filterChoices = [
        { value: 'all', name: `All ${counts[0]}` },
        { value: 'new', name: `Not installed ${counts[1]}` },
        { value: 'installed', name: `Installed ${counts[2]}` },
        { value: 'updates', name: `Updates ${counts[3]}` },
      ];
    }
    return this.filterChoices;
  }
  private filterCounts: number[] = [];
  private filterChoices: Choice<OfferFilter>[] = [];

  /** The chosen source's agents: the ones the filter and the search
   *  leave, in the chosen order. */
  get shownOffers(): CatalogOffer[] {
    const source = this.current;
    if (!source) return [];
    const query = this.query.trim().toLowerCase();
    const offers = this.offersOf(source).filter((offer) =>
      this.matchesFilter(offer, this.filter) && (!query
        || `${this.idOf(offer)} ${this.nameOf(offer)} ${offer.manifest.agent.description || ''}`
          .toLowerCase().includes(query)));
    if (this.sort === 'name') offers.sort((a, b) => this.nameOf(a).localeCompare(this.nameOf(b)));
    return offers;
  }

  get pagedOffers(): CatalogOffer[] {
    const start = (this.page - 1) * this.pageSize;
    return this.shownOffers.slice(start, start + this.pageSize);
  }

  search(value: string): void {
    this.query = value;
    this.page = 1;
  }

  setFilter(filter: OfferFilter): void {
    this.filter = filter;
    this.page = 1;
  }

  setSort(sort: OfferSort): void {
    this.sort = sort;
    this.page = 1;
  }

  /** Under the catalog: how many of the source's agents are shown. */
  foot(source: AgentSource): string {
    const all = this.offersOf(source).length;
    const shown = this.shownOffers.length;
    if (!all) return '';
    return shown === all ? `${all} ${all === 1 ? 'agent' : 'agents'}` : `${shown} of ${all} agents`;
  }

  /** When the source's catalog was last read. A catalog with no age on
   *  it cannot be told apart from one read a week ago. */
  freshness(source: AgentSource): string {
    return relativeDate(source.read_at).toLowerCase() || 'never';
  }

  isStale(source: AgentSource): boolean {
    const read = source.read_at ? Date.parse(source.read_at) : NaN;
    return isNaN(read) || Date.now() - read > 24 * 60 * 60 * 1000;
  }

  /** The agents installed from a source: what goes with it. */
  installedFrom(source: AgentSource): InstalledAgent[] {
    return this.installed.filter((agent) => agent.source_id === source.source_id);
  }

  // ── What state an offered agent is in ───────────────────────────────

  /** Whether it can be installed from here: no errors, and not already
   *  this version, nor an agent of another source. */
  installable(offer: CatalogOffer): boolean {
    return !offer.errors.length && (offer.status === 'not_installed' || offer.status === 'update_available');
  }

  /** What the card's chip says: only what is not the ordinary case. That
   *  it is installed is the card's foot's to say. */
  offerChip(offer: CatalogOffer): CardChip | null {
    if (offer.errors.length) return { word: 'Cannot be installed', tone: 'danger' };
    if (offer.status === 'update_available') return { word: 'Update available', tone: '' };
    if (offer.status === 'other_source') return { word: 'From another source', tone: '' };
    return null;
  }

  /** The card's line of facts, from the manifest on offer; then the
   *  version installed where a newer one is offered. */
  offerFacts(offer: CatalogOffer): string[] {
    const facts = agentFacts(offer.manifest);
    const held = this.installedOf(offer);
    if (offer.status === 'update_available' && held) facts.push(`v${held.version} installed`);
    return facts;
  }

  /** The same facts as pills with their icons, as the card shows them. */
  offerStats(offer: CatalogOffer): AgentStat[] {
    const stats = agentStats(offer.manifest);
    const held = this.installedOf(offer);
    if (offer.status === 'update_available' && held) stats.push({ icon: 'history', text: `v${held.version} installed` });
    return this.kept(this.statsKept, offer, stats);
  }

  /** Its functions by level, as a card's thin bar. */
  offerLevels(offer: CatalogOffer): CardLevel[] {
    return this.kept(this.levelsKept, offer, levelBar(offer.manifest));
  }

  offerIcon(offer: CatalogOffer): string {
    return iconOf(offer.manifest);
  }

  /** The same array for the same offer until it changes: a new one on
   *  every check would redraw the card's pills under the pointer. */
  private kept<T>(cache: WeakMap<CatalogOffer, { key: string; value: T }>, offer: CatalogOffer, value: T): T {
    const key = JSON.stringify(value);
    const held = cache.get(offer);
    if (held && held.key === key) return held.value;
    cache.set(offer, { key, value });
    return value;
  }
  private statsKept = new WeakMap<CatalogOffer, { key: string; value: AgentStat[] }>();
  private levelsKept = new WeakMap<CatalogOffer, { key: string; value: CardLevel[] }>();

  /** The installed agent of an offer's id, if any. */
  installedOf(offer: CatalogOffer): InstalledAgent | undefined {
    return this.installed.find((agent) => agent.agent_id === this.idOf(offer));
  }

  /** Where an offer's card goes: its review, or nowhere new for one that
   *  cannot be installed. */
  offerLink(source: AgentSource, offer: CatalogOffer): string[] {
    return offer.errors.length
      ? ['/agents/marketplace', source.source_id]
      : ['/agents/marketplace', source.source_id, this.idOf(offer)];
  }

  // ── Saving a source ─────────────────────────────────────────────────

  startCreate(): void {
    this.go('sources', 'new');
    this.showForm(null);
  }

  startEdit(source: AgentSource): void {
    this.go(source.source_id, 'edit');
    this.showForm(source);
  }

  /** Back to where the form was opened from: the source being changed,
   *  the one that was open, or the first. */
  closeForm(): void {
    if (this.saving) return;
    const back = this.editing?.source_id || this.selectedId;
    this.hideForm();
    this.go(...(back ? [back] : []));
  }

  private showForm(editing: AgentSource | null): void {
    this.editing = editing;
    this.formError = '';
    this.error = '';
    if (this.formOpen) return;
    this.formOpen = true;
    if (!this.dialog || !this.sourceDialog) return;
    this.formRef = this.dialog.open(this.sourceDialog, { width: '560px', maxWidth: '100vw' });
    // Escape and a click outside leave the form like Cancel does.
    this.formRef.afterClosed().subscribe(() => {
      this.formRef = null;
      if (this.formOpen) this.closeForm();
    });
  }

  private hideForm(): void {
    this.formOpen = false;
    this.editing = null;
    this.formRef?.close();
  }

  /** Saves the source, which reads its catalog. One the server refused
   *  stays in the form with the reason; one saved whose catalog could not
   *  be read stays there too, as the saved source it now is, so the
   *  address or the credential can be put right. */
  async saveSource(draft: SourceDraft): Promise<void> {
    this.saving = true;
    this.formError = '';
    if (this.formRef) this.formRef.disableClose = true;
    try {
      const result = this.editing
        ? await this.service.updateSource(this.editing.source_id, draft.url, draft.credential)
        : await this.service.createSource(draft.url, draft.credential);
      if (result.error) {
        this.formError = result.error;
        return;
      }
      await this.load();
      const saved = this.sources.find((source) => source.source_id === result.source?.source_id);
      if (saved?.error) {
        this.showSource(saved);
        this.editing = saved;
        this.formError = `Saved, but its catalog could not be read: ${saved.error}`;
        this.go(saved.source_id, 'edit');
        return;
      }
      // A source just saved is the one to look at: its catalog opens.
      this.hideForm();
      if (saved) this.showSource(saved);
      this.go(...(saved ? [saved.source_id] : []));
      this.flash('Source saved and its catalog read.');
    } finally {
      this.saving = false;
      if (this.formRef) this.formRef.disableClose = false;
    }
  }

  /** Read the catalog again: an update is offered once it is read. */
  async refresh(source: AgentSource): Promise<void> {
    this.busyId = source.source_id;
    try {
      const result = await this.service.refreshSource(source.source_id);
      await this.load();
      if (result.error) return this.fail(result.error);
      if (result.source?.error) return this.fail(`Its catalog could not be read: ${result.source.error}`);
      this.flash('Catalog read again.');
    } finally {
      this.busyId = '';
    }
  }

  /** Deleting a source is asked, in the words of what goes with it: the
   *  agents installed from it are uninstalled. */
  async askRemove(source: AgentSource): Promise<void> {
    const installed = this.installedFrom(source);
    const sure = await this.confirm?.ask({
      title: `Delete ${this.sourceName(source)}?`,
      body: installed.length
        ? `Installed from it, and uninstalled with it: ${installed.map((agent) => `${agent.name} ${agent.version}`).join(', ')}. `
          + 'The records they kept stay their people\'s, and installing them again gives them back.'
        : 'No agent is installed from it, so nothing else changes. Add its address again to list it again.',
      confirm: installed.length ? `Delete and uninstall ${installed.length}` : 'Delete',
      danger: true,
    });
    if (!sure) return;
    this.busyId = source.source_id;
    try {
      const result = await this.service.deleteSource(source.source_id);
      if (result.error) return this.fail(result.error);
      await this.load();
      this.go();
      this.flash(`${this.sourceName(source)} deleted.`);
    } finally {
      this.busyId = '';
    }
  }

  // ── Choosing several ────────────────────────────────────────────────

  private selectionKey(source: AgentSource, offer: CatalogOffer): string {
    return `${source.source_id}::${this.idOf(offer)}`;
  }

  selectableOffers(source: AgentSource): CatalogOffer[] {
    return this.offersOf(source).filter((offer) => this.installable(offer));
  }

  isSelected(source: AgentSource, offer: CatalogOffer): boolean {
    return this.selected.has(this.selectionKey(source, offer));
  }

  toggleSelect(source: AgentSource, offer: CatalogOffer): void {
    const key = this.selectionKey(source, offer);
    if (!this.selected.delete(key)) this.selected.add(key);
  }

  selectedCount(source: AgentSource): number {
    return this.selectableOffers(source).filter((offer) => this.isSelected(source, offer)).length;
  }

  selectAll(source: AgentSource): void {
    for (const offer of this.selectableOffers(source)) this.selected.add(this.selectionKey(source, offer));
  }

  clearSelection(source: AgentSource): void {
    for (const offer of this.offersOf(source)) this.selected.delete(this.selectionKey(source, offer));
  }

  /** The ticked agents, read together before any of them is installed. */
  reviewSelected(source: AgentSource): void {
    const chosen = this.selectableOffers(source).filter((offer) => this.isSelected(source, offer));
    if (chosen.length) this.openReview(source, chosen);
  }

  // ── The review, and installing ──────────────────────────────────────

  openReview(source: AgentSource, offers: CatalogOffer[]): void {
    this.go(source.source_id, offers.map((offer) => this.idOf(offer)).join(','));
    this.showReview(source, offers);
  }

  private showReview(source: AgentSource, offers: CatalogOffer[]): void {
    this.catalogScrollY = window.scrollY;
    this.review = { source, offers };
    this.error = '';
    requestAnimationFrame(() => window.scrollTo({ top: 0, behavior: 'auto' }));
  }

  /** Several agents' names, as one phrase. */
  namesOf(offers: CatalogOffer[]): string {
    const names = offers.map((offer) => this.nameOf(offer));
    return names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}` : names.join('');
  }

  /** What was installed before, for an update to be read against. */
  approvedOf(offer: CatalogOffer): Manifest | null {
    return offer.status === 'update_available' ? this.installedOf(offer)?.manifest ?? null : null;
  }

  /** Reading one agent that cannot be installed from here: it is this
   *  version already, or an agent of another source. */
  get reviewOnly(): boolean {
    return this.review?.offers.length === 1 && !this.installable(this.review.offers[0]) && !this.reviewBlocked;
  }

  /** One with errors cannot be installed, alone or among others. */
  get reviewBlocked(): boolean {
    return !!this.review?.offers.some((offer) => offer.errors.length);
  }

  get approveLabel(): string {
    const offers = this.review?.offers || [];
    if (this.busyId === 'review') return 'Installing…';
    if (offers.length > 1) return `Install ${offers.length}`;
    return offers[0]?.status === 'update_available' ? 'Install the update' : 'Install';
  }

  closeReview(): void {
    if (this.busyId || !this.review) return;
    this.go(this.review.source.source_id);
    this.hideReview();
  }

  private hideReview(): void {
    this.review = null;
    requestAnimationFrame(() => window.scrollTo({ top: this.catalogScrollY, behavior: 'auto' }));
  }

  /** Installs what is under review, one after another: each is its own
   *  install, and one refusal never stops the rest. One agent lands on
   *  its own page; several land back in the catalog. What was refused
   *  stays under review, read again, with why: a source read again since
   *  the review is reviewed again. */
  async approve(): Promise<void> {
    if (!this.review || this.busyId) return;
    const { source, offers } = this.review;
    this.busyId = 'review';
    const refused: string[] = [];
    const left: string[] = [];
    let installed: InstalledAgent | undefined;
    try {
      for (const offer of offers) {
        const result = await this.service.install(offer);
        if (result.error) {
          refused.push(`${this.nameOf(offer)}: ${result.error}`);
          left.push(this.idOf(offer));
        } else {
          installed = result.agent;
          this.selected.delete(this.selectionKey(source, offer));
        }
      }
      await this.load();
      if (refused.length) {
        const fresh = this.sources.find((candidate) => candidate.source_id === source.source_id);
        const still = fresh ? this.offersOf(fresh).filter((offer) => left.includes(this.idOf(offer))) : [];
        if (fresh && still.length) {
          this.review = { source: fresh, offers: still };
          this.go(fresh.source_id, still.map((offer) => this.idOf(offer)).join(','));
        }
        return this.fail(refused.join(' · '));
      }
      if (offers.length === 1 && installed && this.router) {
        void this.router.navigate(['/agents', installed.agent_id]);
        return;
      }
      this.busyId = '';
      this.closeReview();
      this.flash(`${offers.length} agents installed. A runtime checks each before any chat uses it.`);
    } finally {
      this.busyId = '';
    }
  }
}
