import { Component, OnDestroy, OnInit } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { ActivatedRoute, NavigationEnd, Router } from '@angular/router';
import { firstValueFrom, Subscription } from 'rxjs';

import { FilterGroup, FilterItem } from 'src/app/components/ui/filter-column.component';
import { Card, Chat } from 'src/app/models/chat-protocol';
import { ServerPage, ServerPages } from 'src/app/components/ui/paging';
import { ActivityService, Schedule, ScheduleCounts } from 'src/app/services/activity.service';
import { AiSessionService } from 'src/app/services/ai-session.service';
import { AuthService } from 'src/app/services/auth.service';
import { ConfirmService } from 'src/app/services/confirm.service';
import { WorkSwitchService } from 'src/app/services/work-switch.service';
import { DataPageBase } from '../../data-page-base';
import { cadenceWords, momentWords, secondsOf, until } from './cadence-words';
import { ScheduleFormComponent, ScheduleFormData, ScheduleFormResult } from './schedule-form.component';
import { STATE_WORDS, ScheduleState, failuresOf, lastRun, stateOf, whatOf } from './schedule-shared';

const STATES: ScheduleState[] = ['active', 'paused', 'done', 'failing'];

/** The schedules a page shows. */
const PAGE_SIZE = 20;

/** The cards shown over the list: the rest are answered on Approvals. */
const FIRST_CARDS = 5;

/** What a card asks, as an icon. */
const CARD_ICONS: Record<Card['kind'], string> = {
  approval: 'shield-alert', network: 'globe', question: 'circle-help',
  form: 'key-round', skill: 'sparkles', memory: 'brain-circuit',
};

/**
 * What waits for the person across their chats: the cards that wait for
 * an answer, each leading to its chat, and everything their chats keep
 * on the clock. A schedule's row reads as an appointment: when it comes
 * round, in words; what it does and in which chat; when it runs next
 * and how the last run went.
 *
 * One list of schedules, with a column at its left that narrows it by
 * how a schedule stands and by chat. A row's name opens the schedule at
 * /ai/schedules/<id>, beside the list on a wide screen, with every run
 * kept. Making one and changing when one runs are the same dialog
 * (schedule-form.component); saying it in plain words goes to a chat,
 * where the assistant sets the clock.
 */
@Component({
  selector: 'app-schedules',
  standalone: false,
  templateUrl: './schedules.component.html',
  styleUrl: './schedules.component.css',
})
export class SchedulesComponent extends DataPageBase implements OnInit, OnDestroy {
  loading = true;
  /** The schedules twenty to a page, those that run soonest first,
   *  narrowed by the address's state, chat and search on the server. */
  readonly pages = new ServerPages<Schedule>(PAGE_SIZE, (after, limit) => this.readSchedules(after, limit));
  /** The person's schedules in numbers, by state and by chat, and the one
   *  that runs next: the server's, whatever the filters. */
  counts: ScheduleCounts = { all: 0, active: 0, paused: 0, done: 0, failing: 0 };
  private byChat: { chat_id: string; title: string; count: number }[] = [];
  upcoming: Schedule | null = null;
  /** Schedules read on other pages, and those just made: one opened
   *  from the address may be off the page shown. */
  private known = new Map<string, Schedule>();
  /** The oldest few cards that wait for the person, and how many do. */
  cards: Card[] = [];
  cardsTotal = 0;
  /** The person's chats, by id: their titles and their time zones. */
  private chats = new Map<string, Chat>();
  /** Functions' names, by `agent.function`, from the chats that run them. */
  private names: Record<string, string> = {};
  /** The person stopped everything: the rows stay on the clock and
   *  none runs until they resume. */
  stopped = false;
  resuming = false;

  // ── What the address says ───────────────────────────────────────────
  /** How a schedule stands, or '' for all of them. */
  state: ScheduleState | '' = '';
  chat = '';
  query = '';
  /** The page the address names. */
  page = 1;
  readonly pageSize = PAGE_SIZE;
  /** The schedule opened beside the list; '' for none. */
  openId = '';
  private address = new Subscription();

  /** The schedule an action is on its way for. */
  busyId = '';
  intent = '';
  sending = false;

  /** The clock "in 14 h" is read against, in seconds: it moves every
   *  minute, and the rows are read again with it. */
  now = Date.now() / 1000;
  private ticker: ReturnType<typeof setInterval> | null = null;

  constructor(
    private service: ActivityService,
    private session: AiSessionService,
    private work: WorkSwitchService,
    public auth: AuthService,
    private router: Router,
    private route: ActivatedRoute,
    private dialog: MatDialog,
    private confirm: ConfirmService,
  ) {
    super();
  }

  async ngOnInit(): Promise<void> {
    this.address.add(this.route.queryParamMap.subscribe((params) => {
      const before = { state: this.state, chat: this.chat, query: this.query };
      const state = params.get('state') as ScheduleState;
      this.state = STATES.includes(state) ? state : '';
      this.chat = params.get('chat') ?? '';
      this.query = params.get('q') ?? '';
      this.page = Math.max(1, Number(params.get('page')) || 1);
      if (!this.pages.loaded) return;
      // A new filter reads the first page again; a new search, once the
      // typing stops; a page of the pager, that page.
      if (before.state !== this.state || before.chat !== this.chat) void this.pages.first();
      else if (before.query !== this.query) this.pages.search();
      else if (this.page !== this.pages.page) void this.goTo(this.page);
    }));
    this.address.add(this.router.events.subscribe((event) => {
      if (event instanceof NavigationEnd) void this.readOpened();
    }));
    // Stopped or resumed from the bar at the top of the app: the page follows.
    this.address.add(this.work.stopped$.subscribe((stopped) => (this.stopped = stopped)));

    const [, chats] = await Promise.all([this.reload(), this.session.listChats().catch(() => [] as Chat[])]);
    this.chats = new Map(chats.map((chat) => [chat.chat_id, chat]));
    this.loading = false;
    void this.readOpened();
    this.ticker = setInterval(() => {
      this.now = Date.now() / 1000;
      void this.reload();
    }, 60000);
    await this.readNames();
  }

  ngOnDestroy(): void {
    this.address.unsubscribe();
    this.pages.cancel();
    if (this.ticker) clearInterval(this.ticker);
  }

  /** The oldest few cards, and the page of schedules shown, read again;
   *  the first time, the page the address names. */
  private async reload(): Promise<void> {
    const [waiting] = await Promise.all([
      this.service.list('', FIRST_CARDS),
      this.pages.loaded ? this.pages.reload() : this.pages.first().then(() => this.goTo(this.page)),
    ]);
    // A read that failed says so and leaves what was on screen: an
    // empty list would read as "nothing scheduled".
    const failed = waiting.error || this.pages.error;
    if (failed) return this.fail(`Could not read what waits for you: ${failed}`);
    this.cards = waiting.cards;
    this.cardsTotal = waiting.total;
    this.now = Date.now() / 1000;
  }

  private async readSchedules(after: string, limit: number): Promise<ServerPage<Schedule>> {
    const page = await this.service.schedulePage(after, limit, { state: this.state, chat_id: this.chat, q: this.query });
    if (!page.error) {
      this.counts = page.counts;
      this.byChat = page.chats;
      this.upcoming = page.upcoming;
      for (const schedule of page.rows) this.known.set(schedule.schedule_id, schedule);
      if (page.upcoming) this.known.set(page.upcoming.schedule_id, page.upcoming);
      // Another page: the names of the functions its chats run.
      if (this.pages.loaded) void this.readNames(page.rows);
    }
    return page;
  }

  /** The page the address names, read through the pages before it: a
   *  page is read after the cursor the one before it gave. */
  private async goTo(page: number): Promise<void> {
    while (this.pages.page < page && this.pages.hasNext && !this.pages.error) await this.pages.go(this.pages.page + 1);
    if (page < this.pages.page) await this.pages.go(page);
  }

  /** The schedules of the page shown. */
  get schedules(): Schedule[] {
    return this.pages.rows;
  }

  /** The names of the functions the schedules run, asked of each chat
   *  that runs one. */
  private async readNames(rows: Schedule[] = this.schedules): Promise<void> {
    const chats = new Set(rows.filter((schedule) => 'function' in schedule.what && !this.namesAsked.has(schedule.chat_id))
      .map((schedule) => schedule.chat_id));
    chats.forEach((chatId) => this.namesAsked.add(chatId));
    const offered = await Promise.all([...chats].map((chatId) => this.service.functions(chatId).catch(() => [])));
    for (const fn of offered.flat()) this.names[fn.function] = fn.name;
  }
  /** The chats whose functions were asked for, once each. */
  private namesAsked = new Set<string>();

  get canCreate(): boolean { return this.auth.can('ai:schedule:create'); }
  get canUpdate(): boolean { return this.auth.can('ai:schedule:update'); }
  get canDelete(): boolean { return this.auth.can('ai:schedule:delete'); }

  // ── The address ─────────────────────────────────────────────────────

  go(changes: Record<string, string>): void {
    const queryParams: Record<string, string | null> = { page: null };
    for (const [key, value] of Object.entries(changes)) queryParams[key] = value || null;
    void this.router.navigate([], {
      relativeTo: this.route.firstChild ?? this.route,
      queryParams,
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }

  filter(key: string, value: string): void {
    this.go({ [key]: key === 'state' && value === 'all' ? '' : value });
  }

  private async readOpened(): Promise<void> {
    this.openId = this.route.snapshot.firstChild?.paramMap.get('id') || '';
    if (!this.openId || this.loading || this.opened) return;
    // On no page read: asked of the server by its id.
    const id = this.openId;
    const found = await this.service.schedule(id).catch(() => null);
    if (found) {
      this.known.set(found.schedule_id, found);
    } else if (this.openId === id) {
      this.fail('That schedule is no longer on the clock.');
      this.closeOpened();
    }
  }

  /** The schedule open beside the list: on the page shown, or read
   *  before (another page, or just made). */
  get opened(): Schedule | null {
    if (!this.openId) return null;
    return this.schedules.find((schedule) => schedule.schedule_id === this.openId)
      ?? this.known.get(this.openId) ?? null;
  }

  closeOpened(): void {
    void this.router.navigate(['/ai/schedules'], { queryParamsHandling: 'preserve' });
  }

  // ── Cards ───────────────────────────────────────────────────────────

  /** What a card asks, in a line. */
  cardWords(card: Card): string {
    const who = card.agent || 'Your assistant';
    switch (card.kind) {
      case 'approval': {
        const items = card.request.items || [];
        return `${who} asks to run ${items.length === 1 ? items[0].name || items[0].function : items.length + ' calls'}`;
      }
      case 'network': return `${who} asks to reach ${card.request.hosts.join(', ')}`;
      case 'question': return card.request.text ? `${who} asks: ${card.request.text}` : `${who} asks a question`;
      case 'form': return `${who} needs ${card.request.label || 'a sign-in'}`;
      case 'skill': return `${who} offers to save the skill “${card.request.skill.name}”`;
      default: return `${who} offers to remember something`;
    }
  }

  /** A card's kind as its mark: what is asked, at a glance. */
  cardIcon(card: Card): string {
    return CARD_ICONS[card.kind] ?? 'inbox';
  }

  // ── The numbers at the head ─────────────────────────────────────────

  /** How many stand each way, for the tiles: the server's count of all
   *  the person's schedules. */
  count(state: ScheduleState): number {
    return this.counts[state] || 0;
  }

  /** When the next run is, short: "in 14 h"; held while stopped. */
  get upcomingWhen(): string {
    const schedule = this.upcoming;
    if (!schedule) return '—';
    return this.stopped ? 'On hold' : until(secondsOf(schedule.next_at), this.now);
  }

  /** A tile narrows the list to its state, and a second press lifts it. */
  toggleState(state: ScheduleState): void {
    this.filter('state', this.state === state ? 'all' : state);
  }

  // ── The list ────────────────────────────────────────────────────────

  /** A chat's title, or what to call one without. */
  chatTitle(chatId: string): string {
    return this.chats.get(chatId)?.title || 'Untitled chat';
  }

  /** The zone a schedule's times are read in: its chat's. */
  zoneOf(schedule: Schedule): string {
    return this.chats.get(schedule.chat_id)?.settings.time_zone || 'UTC';
  }

  get chosen(): Record<string, string> {
    return { state: this.state || 'all', chat: this.chat };
  }

  /** The column: by state and by chat, each counted by the server over
   *  all the person's schedules. Made again only when those change. */
  get filters(): FilterGroup[] {
    if (this.column.counts === this.counts && this.column.byChat === this.byChat && this.column.chat === this.chat) {
      return this.column.groups;
    }
    const counts = this.counts;
    const groups: FilterGroup[] = [{
      key: 'state',
      required: true,
      items: [
        { value: 'all', name: 'All', count: counts.all },
        // Paused, Done and Failing only once there is one: most people have none.
        ...STATES.filter((state) => counts[state] || state === 'active')
          .map((state) => ({ value: state, name: STATE_WORDS[state], count: counts[state] || 0 })),
      ],
    }];
    if (this.byChat.length > 1 || this.chat) {
      const items: FilterItem[] = this.byChat.map((one) => ({
        value: one.chat_id, name: one.title || this.chatTitle(one.chat_id), count: one.count,
      }));
      groups.push({ key: 'chat', label: 'By chat', items: items.sort((a, b) => a.name.localeCompare(b.name)) });
    }
    this.column = { counts, byChat: this.byChat, chat: this.chat, groups };
    return groups;
  }
  private column: { counts: ScheduleCounts | null; byChat: unknown; chat: string; groups: FilterGroup[] } = {
    counts: null, byChat: null, chat: '', groups: [],
  };

  /** The schedules the column and the search leave, of the page shown:
   *  the server reads them the next to run first. */
  get shownSchedules(): Schedule[] {
    return this.schedules;
  }

  /** The oldest few cards: the rest are answered on Approvals. */
  get firstCards(): Card[] {
    return this.cards.slice(0, FIRST_CARDS);
  }

  toPage(page: number): void {
    void this.router.navigate([], {
      relativeTo: this.route.firstChild ?? this.route,
      queryParams: { page: page > 1 ? page : null },
      queryParamsHandling: 'merge',
    });
  }

  // ── A schedule, in words ────────────────────────────────────────────

  /** The kind is the mark: a prompt that wakes, or a function run. */
  mark(schedule: Schedule): string { return 'function' in schedule.what ? 'zap' : 'bell'; }
  cadence(schedule: Schedule): string { return cadenceWords(schedule.when, this.zoneOf(schedule)); }
  what(schedule: Schedule): string { return whatOf(schedule, this.names); }
  stateOf(schedule: Schedule): ScheduleState { return stateOf(schedule); }
  stateWord(schedule: Schedule): string { return STATE_WORDS[stateOf(schedule)]; }
  failures(schedule: Schedule): string { return failuresOf(schedule); }

  /** "Next Tue 14 Oct, 09:00 (in 14 h)"; '' when it is not running. */
  next(schedule: Schedule): string {
    const at = secondsOf(schedule.next_at);
    if (schedule.paused || !at) return '';
    const moment = momentWords(at, this.zoneOf(schedule));
    return this.stopped ? `Next ${moment}, once you resume` : `Next ${moment} (${until(at, this.now)})`;
  }

  /** The last run failed: its fact is said in the danger colour. */
  lastFailed(schedule: Schedule): boolean { return !!lastRun(schedule)?.failed; }

  /** "last ran Mon 13 Oct, 09:00 · failed". */
  last(schedule: Schedule): string {
    const run = lastRun(schedule);
    if (!run) return schedule.paused ? '' : 'has not run yet';
    return `last ran ${momentWords(secondsOf(run.at), this.zoneOf(schedule))}${run.failed ? ' · failed' : ''}`;
  }

  // ── The person's own hand on the clock ──────────────────────────────

  private async change(schedule: Schedule, changes: { paused?: boolean; run_now?: boolean; trust?: number },
                       said: string): Promise<void> {
    this.busyId = schedule.schedule_id;
    try {
      const result = await this.service.update(schedule.schedule_id, changes);
      if (result.error || !result.schedule) return this.fail(result.error || 'That could not be saved.');
      this.known.set(result.schedule.schedule_id, result.schedule);
      await this.reload();
      this.flash(said);
    } finally {
      this.busyId = '';
    }
  }

  setPaused(schedule: Schedule, paused: boolean): Promise<void> {
    return this.change(schedule, { paused },
      paused ? 'Paused. It runs no more until you resume it.' : 'Resumed.');
  }

  /** The trust its runs act at, from its next run on. */
  setTrust(schedule: Schedule, trust: number): Promise<void> {
    return this.change(schedule, { trust }, 'Saved. Its next runs act at that trust.');
  }

  /** Its next run is now: what it does shows up in its chat. */
  runNow(schedule: Schedule): Promise<void> {
    return this.change(schedule, { run_now: true }, 'Running now. What it does shows up in its chat.');
  }

  async askDelete(schedule: Schedule): Promise<void> {
    const sure = await this.confirm.ask({
      title: 'Delete this schedule?',
      body: `“${this.what(schedule)}”, ${this.cadence(schedule).replace(/^./, (first) => first.toLowerCase())}. `
        + 'It stops running. What it already did stays in its chat.',
      confirm: 'Delete',
      danger: true,
    });
    if (!sure) return;
    this.busyId = schedule.schedule_id;
    try {
      const result = await this.service.remove(schedule.schedule_id);
      if (result.error) return this.fail(result.error);
      this.known.delete(schedule.schedule_id);
      if (this.openId === schedule.schedule_id) this.closeOpened();
      await this.reload();
      this.flash('Deleted.');
    } finally {
      this.busyId = '';
    }
  }

  /** Lifts the stop on everything, as the bar at the top does. */
  async resumeAll(): Promise<void> {
    this.resuming = true;
    try {
      const result = await this.work.resume();
      if (result.error) this.fail(result.error);
    } finally {
      this.resuming = false;
    }
  }

  // ── Making one, and changing when one runs: the one dialog ──────────

  private async openForm(schedule?: Schedule): Promise<void> {
    const ref = this.dialog.open<ScheduleFormComponent, ScheduleFormData, ScheduleFormResult | null>(
      ScheduleFormComponent, {
        width: '640px', maxWidth: '100vw',
        data: { chats: [...this.chats.values()], schedule, chatId: this.chat, names: this.names },
      });
    const done = await firstValueFrom(ref.afterClosed());
    if (!done) return;
    // A chat the form made is one to offer by its name the next time.
    if (done.chat) this.chats.set(done.chat.chat_id, done.chat);
    if (done.schedule) this.known.set(done.schedule.schedule_id, done.schedule);
    await this.reload();
    await this.readNames();
    this.flash(done.notice);
    if (!schedule) void this.router.navigate(['/ai/schedules', done.schedule.schedule_id], { queryParamsHandling: 'preserve' });
  }

  add(): Promise<void> { return this.openForm(); }
  edit(schedule: Schedule): Promise<void> { return this.openForm(schedule); }

  /** Plain words: the sentence goes to a chat, and the assistant, which
   *  can schedule its chat's work, sets the clock. No second translator. */
  async describe(): Promise<void> {
    const text = this.intent.trim();
    if (!text || this.sending) return;
    // Stopped, nothing runs: a chat made now would hold a message no
    // runtime acts on. The words stay in the box.
    if (this.stopped) {
      return this.fail('Everything is stopped. Resume first, then ask: your words are still in the box.');
    }
    this.sending = true;
    try {
      const created = await this.session.createChat(text.substring(0, 80));
      const chatId = created.data?.chat?.chat_id;
      if (!chatId) return this.fail(created.error || 'Could not open a chat for it.');
      void this.router.navigate(['ai/chats', chatId], {
        state: { initialMessage: { query: text, uploads: [] } },
      });
    } finally {
      this.sending = false;
    }
  }
}
