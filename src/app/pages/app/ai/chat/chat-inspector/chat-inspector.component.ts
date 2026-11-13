import {
  Component, EventEmitter, Input, OnChanges, OnDestroy, OnInit, Output, SimpleChanges,
} from '@angular/core';
import { Subscription, debounceTime, filter } from 'rxjs';

import { radioKeyTarget } from 'src/app/components/ui/radio-keys';
import { ChatInspection } from 'src/app/models/chat-inspect';
import { ChatEvent, ChatSettings } from 'src/app/models/chat-protocol';
import { ActivityService } from 'src/app/services/activity.service';
import { InstalledAgent } from 'src/app/services/agents.service';
import { AiSessionService } from 'src/app/services/ai-session.service';
import { ChatConnectionService } from 'src/app/services/chat-connection.service';
import { WorkEntry } from 'src/app/services/chat-state.service';
import {
  ActivityFilter, ActivityRow, INSPECTOR_TABS, InspectorTab, KnownFileInfo, Tile, activityRows, fallbackInspection,
  tilesOf, upcomingElsewhere,
} from './inspector-words';

/** How long the inspector waits after the last event that changes it
 *  before it reads the chat again: a burst of calls is one read. */
export const REFRESH_MS = 1000;

/** The events after which what the server tells of the chat has changed:
 *  a call that ended, the chat at rest, a card answered or asked, a
 *  schedule made or run, its settings changed. */
export function changesInspection(event: ChatEvent): boolean {
  if (event.event === 'work') return event.data.status !== 'running' && event.data.status !== 'waiting';
  return ['idle', 'card_opened', 'card_closed', 'schedule_added', 'schedule_ran', 'settings_changed']
    .includes(event.event);
}

/**
 * Everything about one chat, beside the conversation, in six tabs: its
 * numbers and what it does now (Overview), every call it made (Activity),
 * what it touched (Data), what ran it (Runs), its schedules and the
 * person's next runs elsewhere (Schedules), and how it is set up and what
 * it asked (Setup). It reads AI:Chat:inspect as it opens and again after
 * the events that change it; a server without that call gets what the
 * page knows on its own. The live work comes from the page.
 */
@Component({
  selector: 'app-chat-inspector',
  standalone: false,
  templateUrl: './chat-inspector.component.html',
  styleUrls: ['./inspector-shared.css', './chat-inspector.component.css'],
})
export class ChatInspectorComponent implements OnInit, OnChanges, OnDestroy {
  @Input() chatId = '';
  @Input({ required: true }) settings!: ChatSettings;
  @Input() working = false;
  /** The chat's work, every piece of it, live. */
  @Input() work: WorkEntry[] = [];
  /** How many cards wait for the person. */
  @Input() waiting = 0;
  /** The agents this chat uses, and every installed agent's name by id. */
  @Input() agents: InstalledAgent[] = [];
  @Input() names: Record<string, string> = {};
  /** The model, as the chat's picker names it. */
  @Input() model = '';
  /** The files the page knows of, by record id. */
  @Input() files: Record<string, KnownFileInfo> = {};
  @Input() stopping: string[] = [];
  @Input() stoppingAll = false;
  /** Over the conversation, on a phone: no room to widen. */
  @Input() sheet = false;
  /** Widened, for reading tables. */
  @Input() expanded = false;
  @Output() expandedChange = new EventEmitter<boolean>();
  @Output() closed = new EventEmitter<void>();
  @Output() stopWork = new EventEmitter<string>();
  @Output() stopAll = new EventEmitter<void>();
  @Output() openOutput = new EventEmitter<WorkEntry>();
  @Output() changeAgents = new EventEmitter<void>();
  @Output() changeSkills = new EventEmitter<void>();
  @Output() changeSettings = new EventEmitter<Partial<ChatSettings>>();

  readonly tabs = INSPECTOR_TABS;
  /** The tab shown: the page may open the inspector on one (the header's
   *  clock opens Schedules), and hears when the person picks another. */
  @Input() tab: InspectorTab = 'overview';
  @Output() tabChange = new EventEmitter<InspectorTab>();
  activityFilter: ActivityFilter = 'all';

  inspection: ChatInspection | null = null;
  /** The server has no AI:Chat:inspect: what the page knows alone is shown. */
  partial = false;
  error = '';
  rows: ActivityRow[] = [];
  /** The newest few, for the Overview. */
  latest: ActivityRow[] = [];
  tiles: Tile[] = [];
  /** Every file's name the page or the server knows, by record id. */
  fileNames: Record<string, string> = {};

  private events?: Subscription;
  /** Counts the reads, so an answer that comes after a newer one is dropped. */
  private reading = 0;
  private destroyed = false;

  constructor(
    private aiSession: AiSessionService,
    private activity: ActivityService,
    private connection: ChatConnectionService,
  ) {}

  ngOnInit(): void {
    this.events = this.connection.events$.pipe(filter(changesInspection), debounceTime(REFRESH_MS))
      .subscribe(() => void this.load());
    void this.load();
  }

  ngOnChanges(changes: SimpleChanges): void {
    // Another chat, on the same page: nothing of this one is shown for it.
    if (changes['chatId'] && !changes['chatId'].firstChange) {
      this.inspection = null;
      this.error = '';
      void this.load();
    } else if (changes['work'] || changes['names'] || changes['files']) {
      this.derive();
    }
  }

  ngOnDestroy(): void {
    this.destroyed = true;
    this.events?.unsubscribe();
  }

  /** Read the chat: from the server, or from what the page knows where
   *  the server has no such call. A failed read keeps what was shown. */
  async load(): Promise<void> {
    const reading = ++this.reading;
    const res = this.partial ? null : await this.aiSession.inspect(this.chatId);
    if (this.destroyed || reading !== this.reading) return;
    if (res?.data) {
      this.inspection = res.data;
      this.error = '';
    } else {
      this.partial ||= res?.code === 'not_found' && /endpoint/i.test(res.error || '');
      this.error = this.partial ? '' : res?.error || 'Could not read this chat.';
      if (this.partial || !this.inspection) {
        const known = await this.known();
        if (this.destroyed || reading !== this.reading) return;
        this.inspection = known;
      }
    }
    this.derive();
  }

  /** The chat as the page knows it alone: its work, files and schedules. */
  private async known(): Promise<ChatInspection> {
    const [mine, all] = await Promise.all([
      this.activity.schedules(this.chatId).catch(() => ({ schedules: [] })),
      this.activity.schedules().catch(() => ({ schedules: [] })),
    ]);
    const titles = Object.fromEntries((this.aiSession.peekChats() ?? []).map((chat) => [chat.chat_id, chat.title]));
    return fallbackInspection(
      { chat_id: this.chatId, settings: this.settings, working: this.working }, this.work, this.files,
      mine.schedules, upcomingElsewhere(all.schedules, this.chatId, titles),
    );
  }

  /** What the tabs show, worked out once each time what it is made of changes. */
  private derive(): void {
    if (!this.inspection) return;
    this.rows = activityRows(this.work, this.inspection.usage.calls, this.names);
    this.latest = this.rows.slice(0, 4);
    this.tiles = tilesOf(this.inspection, this.work);
    this.fileNames = {
      ...Object.fromEntries(Object.entries(this.files).map(([id, file]) => [id, file.name])),
      ...Object.fromEntries(this.inspection.files.map((file) => [file.record_id, file.name])),
    };
  }

  /** A tile, or a "See all", opens the tab that tells the rest. */
  go(target: { tab: InspectorTab; filter?: ActivityFilter }): void {
    this.select(target.tab);
    if (target.filter) this.activityFilter = target.filter;
  }

  /** The tabs' keys: the arrows move along them, Home and End to the ends. */
  onTabKey(event: KeyboardEvent, index: number): void {
    const target = radioKeyTarget(event.key, index, this.tabs.length);
    if (target === null) return;
    event.preventDefault();
    this.select(this.tabs[target].value);
    (event.currentTarget as HTMLElement).parentElement?.querySelectorAll<HTMLElement>('[role="tab"]')[target]?.focus();
  }

  select(tab: InspectorTab): void {
    this.tab = tab;
    this.tabChange.emit(tab);
  }

  toggleExpanded(): void {
    this.expanded = !this.expanded;
    this.expandedChange.emit(this.expanded);
  }
}
