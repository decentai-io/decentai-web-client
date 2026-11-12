import { Component, Input, OnInit } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';

import { byDay, clockTime } from 'src/app/components/ui/dates';
import { Choice } from 'src/app/components/ui/radio-keys';
import { AuditService, TrailFilters, TrailLine, TrailPage } from 'src/app/services/audit.service';
import { AuthService } from 'src/app/services/auth.service';
import { Failure } from 'src/app/services/request.service';
import { ProfileService } from 'src/app/services/profile.service';
import {
  LineGroup, groupLines, lineHasDetails, lineKind, lineMore, lineOutcome, lineTone,
} from './trail-words';

type AuditTab = 'mine' | 'org';

/**
 * Audit: the trail the API server writes — a line for every change and
 * every refusal, never a secret's value or a body — and what runtimes
 * wrote down of the chats they held.
 *
 * Two views. "Mine" is the person's own lines — theirs to read. "Organization"
 * is everyone's, or one person's — a grant of its own, so the choice
 * appears only for people who hold it.
 *
 * It is read by day, a page at a time, newest first. The same thing done
 * several times in a row is one row with a count (trail-words.ts). The
 * API server narrows it: to what was done (an action, or its start), to
 * how it ended, and to one chat, whose menu opens this page with
 * `?chat=<id>`.
 */
@Component({
  selector: 'app-audit',
  standalone: false,
  templateUrl: './audit.component.html',
  styleUrl: './audit.component.css',
})
export class AuditComponent implements OnInit {
  /** Which view the address names (/audit or /audit/org): the route's
   *  data, bound to this input by the router. */
  @Input() initialView: AuditTab = 'mine';
  loading = true;
  loadingMore = false;
  error = '';
  tab: AuditTab = 'mine';
  readonly tabs: Choice<AuditTab>[] = [
    { value: 'mine', name: 'Mine' },
    { value: 'org', name: 'Organization' },
  ];
  lines: TrailLine[] = [];
  /** The lines read, in groups, under the day each happened on. */
  days: { day: string; items: LineGroup[] }[] = [];
  /** Where the next page starts; '' when this was the last. */
  before = '';
  /** What is open: a line by its id, a group by `groupKey`. */
  expanded = new Set<string>();

  /** What was done: an action, or its start (`ai:chat`). */
  what = '';
  /** How the lines ended. */
  ended: TrailFilters['outcome'] = '';
  readonly outcomes: Choice<TrailFilters['outcome']>[] = [
    { value: '', name: 'Any outcome' },
    { value: 'success', name: 'Done' },
    { value: 'refused', name: 'Refused' },
    { value: 'failed', name: 'Failed' },
  ];
  /** One chat's lines alone, as the address says. */
  chat = '';
  /** In the organization's view, one person's lines alone. */
  person = '';
  people: Choice[] = [];

  constructor(
    private audit: AuditService,
    public auth: AuthService,
    private router: Router,
    private route: ActivatedRoute,
    private profiles: ProfileService,
  ) {}

  get canSeeOrg(): boolean { return this.auth.can('ai:audit:list_all'); }

  async ngOnInit(): Promise<void> {
    this.chat = this.route.snapshot.queryParamMap.get('chat') || '';
    if (this.initialView === 'org' && this.canSeeOrg) {
      this.tab = 'org';
      const peers = await this.profiles.peers().catch(() => null);
      this.people = [{ value: '', name: 'Everyone' },
        ...(peers?.people ?? []).map((person) => ({ value: person.user_id, name: person.name || person.email }))];
    }
    await this.reload();
  }

  /** Each view has its own address, and going there draws the page
   *  again with that view: nothing is read from here. */
  selectTab(tab: AuditTab): void {
    if (this.tab === tab) return;
    this.router.navigate([tab === 'org' ? '/audit/org' : '/audit'], { queryParamsHandling: 'preserve' });
  }

  async reload(): Promise<void> {
    this.loading = true;
    this.error = '';
    try {
      const page = await this.read('');
      this.expanded.clear();
      this.take(page.lines, page.before);
    } finally {
      this.loading = false;
    }
  }

  async loadMore(): Promise<void> {
    if (!this.before || this.loadingMore) return;
    this.loadingMore = true;
    try {
      const page = await this.read(this.before);
      this.take([...this.lines, ...page.lines], page.before);
    } finally {
      this.loadingMore = false;
    }
  }

  private async read(before: string): Promise<TrailPage & Failure> {
    const filters: TrailFilters = { chat_id: this.chat, what: this.what.trim().toLowerCase(), outcome: this.ended };
    const page = this.tab === 'org' ? await this.audit.all(before, { ...filters, user_id: this.person })
      : await this.audit.mine(before, filters);
    if (page.error) this.error = page.error;
    return page;
  }

  private take(lines: TrailLine[], before: string): void {
    this.lines = lines;
    this.before = before;
    this.days = byDay(groupLines(lines), (group) => group.first.at);
  }

  choosePerson(userId: string): void {
    this.person = userId;
    void this.reload();
  }

  chooseOutcome(outcome: TrailFilters['outcome']): void {
    this.ended = outcome;
    void this.reload();
  }

  // ── The numbers at the head ─────────────────────────────────────────

  /** How many of the lines read ended this way. */
  count(outcome: TrailFilters['outcome']): number {
    return this.lines.filter((line) => line.outcome === outcome).length;
  }

  /** A tile narrows the record to how its lines ended; a second press
   *  lifts it. */
  toggleOutcome(outcome: TrailFilters['outcome']): void {
    this.chooseOutcome(this.ended === outcome ? '' : outcome);
  }

  get filtered(): boolean {
    return !!this.what.trim() || !!this.ended || !!this.person || !!this.chat;
  }

  clearFilters(): void {
    this.what = '';
    this.ended = '';
    this.person = '';
    if (this.chat) {
      this.chat = '';
      void this.router.navigate([], { queryParams: { chat: null }, queryParamsHandling: 'merge', replaceUrl: true });
    }
    void this.reload();
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

  // ── Words ───────────────────────────────────────────────────────────

  readonly kind = lineKind;
  readonly tone = lineTone;
  readonly outcome = lineOutcome;
  readonly more = lineMore;
  readonly hasDetails = lineHasDetails;

  time(line: TrailLine): string { return clockTime(line.at); }

  details(line: TrailLine): string {
    return JSON.stringify(line.details || {}, null, 2);
  }
}
