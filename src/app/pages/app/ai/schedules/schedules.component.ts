import { Component, OnDestroy, OnInit } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { ActivatedRoute, NavigationEnd, Router } from '@angular/router';
import { firstValueFrom, Subscription } from 'rxjs';

import { FilterGroup, FilterItem } from 'src/app/components/ui/filter-column.component';
import { Card, Chat } from 'src/app/models/chat-protocol';
import { ActivityService, Schedule } from 'src/app/services/activity.service';
import { AiSessionService } from 'src/app/services/ai-session.service';
import { AuthService } from 'src/app/services/auth.service';
import { ConfirmService } from 'src/app/services/confirm.service';
import { WorkSwitchService } from 'src/app/services/work-switch.service';
import { DataPageBase } from '../../data-page-base';
import { cadenceWords, momentWords, secondsOf, until } from './cadence-words';
import { ScheduleFormComponent, ScheduleFormData, ScheduleFormResult } from './schedule-form.component';
import { STATE_WORDS, ScheduleState, failuresOf, lastRun, stateOf, whatOf } from './schedule-shared';

const STATES: ScheduleState[] = ['active', 'paused', 'done', 'failing'];

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
  schedules: Schedule[] = [];
  /** The cards that wait for the person, in every chat. */
  cards: Card[] = [];
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
  page = 1;
  readonly pageSize = 20;
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
      const state = params.get('state') as ScheduleState;
      this.state = STATES.includes(state) ? state : '';
      this.chat = params.get('chat') ?? '';
      this.query = params.get('q') ?? '';
      this.page = Math.max(1, Number(params.get('page')) || 1);
    }));
    this.address.add(this.router.events.subscribe((event) => {
      if (event instanceof NavigationEnd) this.readOpened();
    }));
    // Stopped or resumed from the bar at the top of the app: the page follows.
    this.address.add(this.work.stopped$.subscribe((stopped) => (this.stopped = stopped)));

    const [, chats] = await Promise.all([this.reload(), this.session.listChats().catch(() => [] as Chat[])]);
    this.chats = new Map(chats.map((chat) => [chat.chat_id, chat]));
    this.loading = false;
    this.readOpened();
    this.ticker = setInterval(() => {
      this.now = Date.now() / 1000;
      void this.reload();
    }, 60000);
    await this.readNames();
  }

  ngOnDestroy(): void {
    this.address.unsubscribe();
    if (this.ticker) clearInterval(this.ticker);
  }

  private async reload(): Promise<void> {
    const [waiting, read] = await Promise.all([this.service.list(), this.service.schedules()]);
    // A read that failed says so and leaves what was on screen: an
    // empty list would read as "nothing scheduled".
    const failed = waiting.error || read.error;
    if (failed) return this.fail(`Could not read what waits for you: ${failed}`);
    this.schedules = read.schedules;
    this.cards = waiting.cards;
    this.now = Date.now() / 1000;
  }

  /** The names of the functions the schedules run, asked of each chat
   *  that runs one. */
  private async readNames(): Promise<void> {
    const chats = new Set(this.schedules.filter((schedule) => 'function' in schedule.what)
      .map((schedule) => schedule.chat_id));
    const offered = await Promise.all([...chats].map((chatId) => this.service.functions(chatId).catch(() => [])));
    for (const fn of offered.flat()) this.names[fn.function] = fn.name;
  }

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

  private readOpened(): void {
    this.openId = this.route.snapshot.firstChild?.paramMap.get('id') || '';
    if (this.openId && !this.loading && !this.opened) {
      this.fail('That schedule is no longer on the clock.');
      this.closeOpened();
    }
  }

  get opened(): Schedule | null {
    return this.schedules.find((schedule) => schedule.schedule_id === this.openId) || null;
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

  /** How many stand each way, for the tiles. */
  count(state: ScheduleState): number {
    return this.schedules.filter((schedule) => stateOf(schedule) === state).length;
  }

  /** The schedule that runs next, of those that run. */
  get upcoming(): Schedule | null {
    const at = (schedule: Schedule) => secondsOf(schedule.next_at) || Infinity;
    return this.schedules.filter((schedule) => !schedule.paused && secondsOf(schedule.next_at))
      .sort((a, b) => at(a) - at(b))[0] ?? null;
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

  get filters(): FilterGroup[] {
    const counts: Record<string, number> = {};
    const byChat = new Map<string, FilterItem>();
    for (const schedule of this.schedules) {
      const state = stateOf(schedule);
      counts[state] = (counts[state] || 0) + 1;
      const item = byChat.get(schedule.chat_id) ?? { value: schedule.chat_id, name: this.chatTitle(schedule.chat_id), count: 0 };
      item.count = (item.count ?? 0) + 1;
      byChat.set(schedule.chat_id, item);
    }
    const groups: FilterGroup[] = [{
      key: 'state',
      required: true,
      items: [
        { value: 'all', name: 'All', count: this.schedules.length },
        // Paused, Done and Failing only once there is one: most people have none.
        ...STATES.filter((state) => counts[state] || state === 'active')
          .map((state) => ({ value: state, name: STATE_WORDS[state], count: counts[state] || 0 })),
      ],
    }];
    if (byChat.size > 1 || this.chat) {
      groups.push({
        key: 'chat', label: 'By chat',
        items: [...byChat.values()].sort((a, b) => a.name.localeCompare(b.name)),
      });
    }
    return groups;
  }

  /** What the column and the search leave, the next to run first; what
   *  is not running comes after. */
  get shownSchedules(): Schedule[] {
    const query = this.query.trim().toLowerCase();
    const next = (schedule: Schedule) => (schedule.paused ? Infinity : secondsOf(schedule.next_at) || Infinity);
    return this.schedules.filter((schedule) => {
      if (this.state && stateOf(schedule) !== this.state) return false;
      if (this.chat && schedule.chat_id !== this.chat) return false;
      return !query || [this.what(schedule), this.cadence(schedule), this.chatTitle(schedule.chat_id)]
        .join(' ').toLowerCase().includes(query);
    }).sort((a, b) => next(a) - next(b));
  }

  get pagedSchedules(): Schedule[] {
    return this.shownSchedules.slice((this.page - 1) * this.pageSize, this.page * this.pageSize);
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
