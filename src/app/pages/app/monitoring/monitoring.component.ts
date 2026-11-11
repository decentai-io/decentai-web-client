import { Component, OnDestroy, OnInit } from '@angular/core';
import { ActivatedRoute, NavigationEnd, Router } from '@angular/router';
import { Subscription } from 'rxjs';
import { filter } from 'rxjs/operators';

import { byDay, clockTime, fullDate } from 'src/app/components/ui/dates';
import { Choice } from 'src/app/components/ui/radio-keys';
import { TrailLine } from 'src/app/services/audit.service';
import { AuthService } from 'src/app/services/auth.service';
import { AgentUsage, MonitoringService } from 'src/app/services/monitoring.service';
import { monitoringViews } from 'src/app/website/config/config';
import { LineGroup, groupLines, lineHasDetails, lineMore, lineOutcome, lineTone } from '../ai/audit/trail-words';
import { bytes } from '../settings/nodes/nodes-words';

export type MonitoringView = (typeof monitoringViews)[number]['value'];

/**
 * Monitoring: what models and agents use, and what was seen of them.
 * Read-only: nothing here changes an agent or what it is given.
 *
 * Five views, each with its own address, each a grant of its own.
 * "Overview" (/monitoring) is what happened in the organization, added up
 * from the audit trail (activity-overview.component). "Tokens" is what
 * the organization's chats and agents had models use, and its estimated
 * cost; "Your usage" is the person's own (token-usage.component).
 * "Agents" is the organization's running agents, as its runtimes report
 * them. "Events" is what runtimes wrote down of the organization's chats,
 * a page at a time. /monitoring opens on the first the person may open.
 */
@Component({
  selector: 'app-monitoring',
  standalone: false,
  templateUrl: './monitoring.component.html',
  styleUrl: './monitoring.component.css',
})
export class MonitoringComponent implements OnInit, OnDestroy {
  view: MonitoringView = 'mine';

  /** The views this person may open, in the order they are offered:
   *  worked out once, when the page opens. */
  views: Choice<MonitoringView>[] = [];
  error = '';
  private address = new Subscription();

  /** How often what the agents use is asked for again, while it is
   *  being looked at. */
  static readonly EVERY_MS = 5000;

  // ── What they use now ───────────────────────────────────────────
  agents: AgentUsage[] = [];
  loadingUsage = true;
  /** How old the numbers are, in words: "Updated 3 s ago". */
  updated = '';
  private updatedAt = 0;
  private timer: ReturnType<typeof setInterval> | null = null;
  private seconds = 0;

  // ── What was seen ───────────────────────────────────────────────
  lines: TrailLine[] = [];
  /** What is listed, alike lines together, under the day it happened on. */
  days: { day: string; items: LineGroup[] }[] = [];
  /** Where the next page starts; '' when this was the last. */
  before = '';
  loading = false;
  loadingMore = false;
  /** What is open: a line by its id, a group by `groupKey`. */
  expanded = new Set<string>();

  constructor(
    private monitoring: MonitoringService,
    public auth: AuthService,
    private router: Router,
    private route: ActivatedRoute,
  ) {}

  async ngOnInit(): Promise<void> {
    this.views = monitoringViews.filter((view) => this.auth.can(view.action)).map(({ value, name }) => ({ value, name }));
    // The view is a child route with no component, so this page is not
    // told when it changes: it reads the address after each navigation.
    this.address.add(this.router.events
      .pipe(filter((event) => event instanceof NavigationEnd))
      .subscribe(() => void this.readView()));
    await this.readView();
  }

  ngOnDestroy(): void {
    this.address.unsubscribe();
    this.stopWatching();
  }

  /** Each view has its own address; going there shows it. */
  go(view: MonitoringView): void {
    void this.router.navigate(view === this.landing ? ['/monitoring'] : ['/monitoring', view]);
  }

  /** What /monitoring itself shows: the first view the person may open. */
  private get landing(): MonitoringView {
    return this.views[0]?.value ?? 'mine';
  }

  private async readView(): Promise<void> {
    const named = this.route.snapshot.firstChild?.url[0]?.path as MonitoringView | undefined;
    const offered = this.views.map((view) => view.value);
    if (named && !offered.includes(named)) {
      void this.router.navigate(['/monitoring'], { replaceUrl: true });
      return;
    }
    const view = named ?? this.landing;
    if (view !== this.view || (view === 'agents' && !this.timer)) await this.select(view);
  }

  async select(view: MonitoringView): Promise<void> {
    this.view = view;
    this.error = '';
    this.stopWatching();
    if (view === 'agents') {
      // One clock, ticking each second: it says how old the numbers
      // are, and asks for new ones when they are old enough.
      this.timer = setInterval(() => this.tick(), 1000);
      await this.readUsage();
    } else if (view === 'events') {
      await this.reload();
    }
  }

  private stopWatching(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.seconds = 0;
  }

  private tick(): void {
    this.seconds += 1;
    if (this.seconds % (MonitoringComponent.EVERY_MS / 1000) === 0) void this.readUsage();
    this.sayUpdated();
  }

  private sayUpdated(): void {
    if (!this.updatedAt) return;
    const ago = Math.round((Date.now() - this.updatedAt) / 1000);
    this.updated = ago < 2 ? 'Updated just now' : `Updated ${ago} s ago`;
  }

  // ── Agents ──────────────────────────────────────────────────────

  async readUsage(): Promise<void> {
    const found = await this.monitoring.usage();
    this.loadingUsage = false;
    if (found.error) {
      this.error = found.error;
      return;
    }
    this.error = '';
    this.agents = found.agents;
    this.updatedAt = Date.now();
    this.sayUpdated();
  }

  /** An agent's share of what all of them hold, for its bar. */
  share(agent: AgentUsage): number {
    const most = Math.max(0, ...this.agents.map((one) => one.memory));
    return most ? Math.max(2, Math.round((agent.memory / most) * 100)) : 0;
  }

  get memory(): number {
    return this.agents.reduce((sum, agent) => sum + agent.memory, 0);
  }

  get processes(): number {
    return this.agents.reduce((sum, agent) => sum + agent.processes, 0);
  }

  get cpu(): number {
    return this.agents.reduce((sum, agent) => sum + agent.cpu, 0);
  }

  /** An agent's row is the same row from one asking to the next: the
   *  numbers change in place. */
  byAgent(_: number, agent: AgentUsage): string { return agent.agent; }

  // ── Events ──────────────────────────────────────────────────────

  async reload(): Promise<void> {
    this.loading = true;
    this.error = '';
    try {
      const page = await this.monitoring.events();
      if (page.error) this.error = page.error;
      this.expanded.clear();
      this.take(page.lines, page.before);
    } finally {
      this.loading = false;
    }
  }

  async older(): Promise<void> {
    if (!this.before || this.loadingMore) return;
    this.loadingMore = true;
    try {
      const page = await this.monitoring.events(this.before);
      if (page.error) this.error = page.error;
      this.take([...this.lines, ...page.lines], page.before);
    } finally {
      this.loadingMore = false;
    }
  }

  private take(lines: TrailLine[], before: string): void {
    this.lines = lines;
    this.before = before;
    this.days = byDay(groupLines(lines), (group) => group.first.at);
  }

  /** A group of several opens to its lines; a group of one is that line,
   *  and opens to its details. */
  groupKey(group: LineGroup): string {
    return group.lines.length > 1 ? `group:${group.first.line_id}` : group.first.line_id;
  }

  toggle(key: string): void {
    if (this.expanded.has(key)) this.expanded.delete(key);
    else this.expanded.add(key);
  }

  isOpen(key: string): boolean { return this.expanded.has(key); }

  // ── Words ───────────────────────────────────────────────────────

  readonly tone = lineTone;
  readonly outcome = lineOutcome;
  readonly more = lineMore;
  readonly hasDetails = lineHasDetails;
  readonly bytes = bytes;

  time(line: TrailLine): string { return clockTime(line.at); }
  fullWhen(line: TrailLine): string { return fullDate(line.at); }

  details(line: TrailLine): string {
    return JSON.stringify({ ids: line.ids, ...line.details }, null, 2);
  }
}
