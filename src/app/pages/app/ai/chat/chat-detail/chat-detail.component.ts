// chat-detail.component.ts — one chat (api-server.md §7).
//
// AI:Chat:open reads the chat, its last messages and its open cards; the
// socket brings what happens in it as it happens, from where the page
// left off. What the person writes, decides and changes goes over HTTP.
import { Component, ElementRef, OnDestroy, OnInit, TemplateRef, ViewChild } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { ActivatedRoute, Router } from '@angular/router';
import { Subscription, skip } from 'rxjs';

import { Card, Chat, ChatEvent, ChatSettings, DEFAULT_CHAT_SETTINGS, Doing, Screen } from 'src/app/models/chat-protocol';
import { ActivityService } from 'src/app/services/activity.service';
import { AgentsService, InstalledAgent } from 'src/app/services/agents.service';
import { AiSessionService } from 'src/app/services/ai-session.service';
import { AuthService } from 'src/app/services/auth.service';
import { ChatConnectionService, ChatConnectionState } from 'src/app/services/chat-connection.service';
import { ChatDoneService } from 'src/app/services/chat-done.service';
import {
  ChatStateService, ChatTurn, InlineChatError, TimelineItem, WorkEntry,
} from 'src/app/services/chat-state.service';
import { ConfirmService } from 'src/app/services/confirm.service';
import { FilesService } from 'src/app/services/files.service';
import { OauthConnectService } from 'src/app/services/oauth.service';
import { ProfileService } from 'src/app/services/profile.service';
import { ReadAloudService } from 'src/app/services/read-aloud.service';
import { RecordsService } from 'src/app/services/records.service';
import { SettingsLlmService } from 'src/app/services/settings-llm.service';
import { TopBarService } from 'src/app/services/top-bar.service';
import { ViewportService } from 'src/app/services/viewport.service';

import { CardDecision } from '../chat-approval-card/chat-approval-card.component';
import { ChatAgentsDialogComponent, ChatReach } from '../chat-agents-dialog/chat-agents-dialog.component';
import { Prompt } from '../chat-composer/chat-composer.component';
import { TRUST_CHOICES, TURN_BUDGET_CHOICES, chatDefaults } from '../chat-defaults';
import { InspectorTab } from '../chat-inspector/inspector-words';
import { KnownFile } from '../chat-message/chat-message.component';
import { ChatModel } from '../chat-model-picker/chat-model-picker.component';
import { ChatOutputDialogComponent, OutputDialogData } from '../chat-output-dialog/chat-output-dialog.component';
import { ScreenInputEvent, ScreenTab, ScreenView, screenLog } from '../chat-screen/chat-screen.component';
import { ChatSkillsDialogComponent } from '../chat-skills-dialog/chat-skills-dialog.component';
import { FileChoice } from '../file-picker/file-picker.component';

/** The agent whose live browser the header opens. */
export const BROWSER_AGENT = 'browser';

@Component({
  selector: 'app-chat-detail',
  standalone: false,
  templateUrl: './chat-detail.component.html',
  styleUrls: ['./chat-detail.component.css'],
})
export class ChatDetailComponent implements OnInit, OnDestroy {
  /** The chat's row of the app's top bar: back, title, status, actions. */
  @ViewChild('bar', { static: true }) private bar?: TemplateRef<unknown>;
  /** The stop's question takes the focus as it opens, on the answer that
   *  changes nothing. */
  @ViewChild('killCancel') private set killCancel(button: ElementRef<HTMLElement> | undefined) {
    button?.nativeElement.focus();
  }
  @ViewChild('titleInput') private set titleInput(input: ElementRef<HTMLInputElement> | undefined) {
    input?.nativeElement.select();
  }

  chat_id = '';
  chat: Chat | null = null;
  /** What the chat thinks with, as the model picker shows it. */
  chatModel: ChatModel = { model: '', model_id: '', effort: '' };
  /** The agents this chat uses, by name: those it lists, or every one. */
  enabledAgentNames: string[] = [];

  /** Inline header rename — Enter/blur saves, Escape cancels. */
  isEditingTitle = false;
  titleDraft = '';

  turns: ChatTurn[] = [];
  /** The conversation as it is read: turns, run blocks and notes, by time. */
  timeline: TimelineItem[] = [];
  /** Every piece of the chat's work, and what its own thread is doing now. */
  work: WorkEntry[] = [];
  doing: Doing | null = null;
  /** The inspector is open beside the conversation, on which tab, and widened. */
  panelOpen = false;
  panelTab: InspectorTab = 'overview';
  panelExpanded = false;
  cards: Card[] = [];
  /** The reply as it is being written. */
  saying = '';
  working = false;
  isChatLoading = true;
  inlineErrors: InlineChatError[] = [];

  /** Messages before the oldest shown may be read, a page at a time. */
  hasOlderMessages = false;
  loadingOlderMessages = false;
  /** A page of messages, as AI:Chat:open and AI:Message:list answer. */
  private static readonly PAGE = 50;

  /** The files the messages name, by record id: what is known of each. */
  files: Record<string, KnownFile> = {};
  /** The installed agents' names, by id. */
  names: Record<string, string> = {};
  private agents: InstalledAgent[] = [];
  /** Whether a model connection answers for this chat: its own, or the
   *  organization's default. Unknown, it is taken to. */
  hasModel = true;

  /** A screen an agent is showing right now: the latest frame, drawn as
   *  it comes and kept nowhere. */
  screen: ScreenView | null = null;
  /** The person closed the panel. It stays closed for the call that was
   *  showing — its next frame must not undo the click — and opens again
   *  for another call's first frame. */
  screenHidden = false;
  private hiddenCall = '';
  /** Folded to its head: beside the thread, the column gives the room back. */
  screenMinimized = false;
  /** Whether the person holds the browser. Kept here, not in the view:
   *  the view is built again when it moves beside the thread or back. */
  screenTaken = false;
  /** The live browser was asked to open, and its first picture is awaited. */
  screenOpening = false;
  private openingTimer: ReturnType<typeof setTimeout> | null = null;
  /** How long "Opening…" is shown at most: past it, the call's own work
   *  in the thread says what became of it. */
  private static readonly OPENING_MS = 30000;

  /** A phone: the header keeps only what a thumb needs, the rest goes
   *  into the menu. */
  isNarrow = false;
  /** Room for two columns: a live view stands beside the thread. */
  isWide = false;

  connectionState: ChatConnectionState = 'disconnected';
  /** Events were missed, and the chat is being read again. */
  private rereading = false;

  /** Words and files given back to the composer. */
  composerDraft = '';
  stagedFiles: FileChoice[] | null = null;

  /** Cards whose answer is on its way. */
  answering = new Set<string>();

  /** How many schedules this chat keeps: the header's clock shows the
   *  number and opens the inspector on them. */
  scheduleCount = 0;

  readonly trustOptions = TRUST_CHOICES;
  readonly turnBudgetOptions = TURN_BUDGET_CHOICES;

  /** The stop, asked once: the chat's work ends where it stands and its
   *  cards expire. */
  killAsking = false;
  killing = false;
  /** The calls and tasks a stop of their own is on its way for. */
  stoppingWork: string[] = [];
  private killTimer: ReturnType<typeof setTimeout> | null = null;
  /** How long `stopped` is waited for before the button is given back:
   *  the word can be lost, and a button disabled for good is worse than
   *  a stop asked for twice. */
  private static readonly KILL_WAIT_MS = 12000;

  private subscriptions = new Subscription();
  /** The state and the connection outlive this page: a call still in
   *  flight when the person leaves must not write into them afterwards.
   *  `opening` counts the reads of the chat, so a late one is dropped. */
  private destroyed = false;
  private opening = 0;
  /** File ids asked for already, found or not. */
  private askedFiles = new Set<string>();

  constructor(
    private aiSession: AiSessionService,
    private profileService: ProfileService,
    private route: ActivatedRoute,
    private router: Router,
    private dialog: MatDialog,
    private connection: ChatConnectionService,
    private state: ChatStateService,
    private viewport: ViewportService,
    private readAloud: ReadAloudService,
    readonly topBar: TopBarService,
    private activityService: ActivityService,
    private auth: AuthService,
    private agentsService: AgentsService,
    private records: RecordsService,
    private filesService: FilesService,
    private oauth: OauthConnectService,
    private llm: SettingsLlmService,
    private confirm: ConfirmService,
    private chatDone: ChatDoneService,
  ) {}

  get title(): string {
    return this.chat?.title || '';
  }

  get settings(): ChatSettings {
    return { ...DEFAULT_CHAT_SETTINGS, ...(this.chat?.settings || {}) };
  }

  get showSideScreen(): boolean {
    return this.isWide && !!this.screen && !this.screenHidden;
  }

  /** The picture's width over its height: the side column is as wide as
   *  the picture is at the column's full height. */
  get screenRatio(): number {
    const width = Number(this.screen?.width) || 0;
    const height = Number(this.screen?.height) || 0;
    return width > 0 && height > 0 ? width / height : 1.6;
  }

  get isSocketReady(): boolean {
    return this.connectionState === 'connected';
  }

  /** What the banner under the header shows: the two newest, the newest first. */
  get shownErrors(): InlineChatError[] {
    return this.inlineErrors.slice(-2).reverse();
  }

  /** The header's word on what this chat needs: cards first, since they
   *  wait on the person; else what it is doing. */
  get attentionLabel(): string {
    const count = this.cards.length;
    if (count) return count === 1 ? '1 waiting for you' : `${count} waiting for you`;
    if (!this.working) return '';
    return this.doing?.what === 'thinking' ? 'Thinking' : this.doing?.what === 'folding' ? 'Summarizing' : 'Working';
  }

  /** The agents this chat uses: those it lists, or every one. */
  get chatAgents(): InstalledAgent[] {
    const listed = this.settings.agents;
    return this.agents.filter((agent) => !listed || listed.includes(agent.agent_id));
  }

  /** The header's live view: there while a screen is, or while the chat
   *  may use the browser agent, which can be asked to open one. */
  get canBrowse(): boolean {
    return this.chatAgents.some((agent) => agent.agent_id === BROWSER_AGENT);
  }

  /** What the live-view control does now, in words. */
  get liveViewLabel(): string {
    if (this.screenOpening) return 'Opening the browser…';
    if (!this.screen) return 'Open the live browser';
    return this.screenHidden ? 'Show the live view' : 'Hide the live view';
  }

  /** The model, as the panel names it. */
  get modelLabel(): string {
    const model = this.settings.model_id || (this.settings.model ? 'Its connection’s default' : 'The organization’s default');
    return this.settings.effort ? `${model} · ${this.settings.effort} effort` : model;
  }

  /** A piece of work's whole output, in a dialog. */
  openOutput(entry: WorkEntry): void {
    if (!entry.output?.ref) return;
    this.dialog.open<ChatOutputDialogComponent, OutputDialogData>(ChatOutputDialogComponent, {
      width: '760px', maxWidth: '95vw', data: { chatId: this.chat_id, ref: entry.output.ref, title: entry.title },
    });
  }

  get schedulesLabel(): string {
    return `${this.scheduleCount} ${this.scheduleCount === 1 ? 'schedule' : 'schedules'} in this chat`;
  }

  /** The browser's own time zone, where the chat keeps another. */
  get browserZone(): string {
    const zone = AiSessionService.browserTimezone();
    return zone && zone !== this.settings.time_zone ? zone : '';
  }

  get composerDisabled(): boolean {
    return this.isChatLoading || !this.hasModel;
  }

  /** What the page says under the composer: why it is closed, or what a
   *  message sent now will do. */
  get composerHint(): string {
    if (this.isChatLoading) return 'Loading conversation…';
    if (!this.hasModel) return 'Choose a model to continue.';
    if (this.working) return 'Sent now, the assistant reads it as it works.';
    return '';
  }

  /** What the status chip reads while the socket is not open. */
  get connectionLabel(): string {
    if (this.connectionState === 'signed-out' || this.connectionState === 'missing') return 'Closed';
    return this.connectionState === 'connecting' || this.connectionState === 'reconnecting' ? 'Connecting…' : 'Reconnect';
  }

  ngOnInit(): void {
    this.topBar.content.set(this.bar ?? null);
    this.state.reset();
    void this.readAloud.refresh();
    this.subscriptions.add(this.viewport.narrow$.subscribe((narrow) => (this.isNarrow = narrow)));
    this.subscriptions.add(this.viewport.wide$.subscribe((wide) => (this.isWide = wide)));
    this.subscriptions.add(this.state.state$.subscribe((state) => {
      this.turns = state.turns;
      this.timeline = state.timeline;
      this.work = Object.values(state.work);
      this.doing = state.doing[''] ?? null;
      this.cards = state.cards;
      this.saying = state.saying;
      this.working = state.working;
      this.isChatLoading = state.loading;
      this.inlineErrors = state.errors;
    }));
    this.subscriptions.add(this.connection.state$.subscribe((connection) => this.onConnection(connection)));
    this.subscriptions.add(this.connection.events$.subscribe((event) => this.onEvent(event)));

    // The first message, handed over by the chats page that made the
    // chat. Taken once: a reload keeps the history entry's state, and
    // the message must not be sent again every time the page is.
    const { initialMessage, ...rest } = history.state || {};
    const initial: Prompt | null = initialMessage || null;
    if (initial) history.replaceState(rest, '');
    this.chat_id = this.route.snapshot.paramMap.get('chat_id') || '';
    this.chatDone.opened(this.chat_id);
    // Another chat opened from this one (the inspector's runs in other
    // chats): the page stays, so it lets go of this chat and opens that.
    this.subscriptions.add(this.route.paramMap.pipe(skip(1)).subscribe((params) => {
      const chatId = params.get('chat_id') || '';
      if (chatId && chatId !== this.chat_id) this.switchChat(chatId);
    }));
    void this.readAgents();
    void this.initChat().then((opened) => {
      if (opened && initial) void this.onPrompt(initial);
    });
  }

  ngOnDestroy(): void {
    this.destroyed = true;
    // Left still working, the app tells the person once it is done.
    this.chatDone.closed(this.chat_id, this.title, this.working);
    this.topBar.content.set(null);
    this.clearKillTimer();
    this.endOpening();
    // A reply being said belongs to the chat that was left.
    this.readAloud.stop();
    // Leaving with the browser in hand gives it back: the agent would
    // otherwise wait on a person who is no longer there.
    if (this.screenTaken && this.screen) this.onScreenInput([{ type: 'control', action: 'release' }]);
    this.subscriptions.unsubscribe();
    this.connection.disconnect();
  }

  // =========================
  // Reading the chat
  // =========================

  /** Leave this chat for another, on the same page: what was held of this
   *  one goes, and that one is read and connected to. */
  private switchChat(chatId: string): void {
    if (this.screenTaken && this.screen) this.onScreenInput([{ type: 'control', action: 'release' }]);
    this.chatDone.closed(this.chat_id, this.title, this.working);
    this.chatDone.opened(chatId);
    this.connection.disconnect();
    this.state.reset();
    this.endScreen();
    this.chat_id = chatId;
    this.setChat(null);
    this.files = {};
    this.askedFiles.clear();
    this.scheduleCount = 0;
    this.stoppingWork = [];
    this.hasOlderMessages = false;
    void this.initChat();
  }

  /** Read the chat from its records, and open its socket from there. */
  private async initChat(): Promise<boolean> {
    if (!(await this.readChat())) return false;
    this.connection.connect(this.chat_id, () => this.state.value.latestEventSeq);
    return true;
  }

  /** The chat, its last messages and its open cards, merged into what
   *  the page holds. */
  private async readChat(): Promise<boolean> {
    const opening = ++this.opening;
    const res = await this.aiSession.openChat(this.chat_id);
    if (this.destroyed || opening !== this.opening) return false;
    if (res.error || !res.data) {
      this.state.addError('assistant', 'chat_unreadable', res.error || 'Unable to load the conversation.');
      void this.router.navigate(['ai/chats']);
      return false;
    }
    const first = this.state.value.loading;
    this.setChat(res.data.chat);
    this.state.load(res.data);
    if (first) {
      this.hasOlderMessages = res.data.messages.length >= ChatDetailComponent.PAGE;
      void this.readModels();
      // The work and what happened besides, as they were before the page was.
      const kept = await this.aiSession.events(this.chat_id, Math.max(0, res.data.events - 500)).catch(() => []);
      if (!this.destroyed && opening === this.opening) this.state.replay(kept);
    }
    void this.knowFiles();
    void this.countSchedules();
    return true;
  }

  private async readAgents(): Promise<void> {
    this.agents = await this.agentsService.installed().catch(() => []);
    this.names = Object.fromEntries(this.agents.map((agent) => [agent.agent_id, agent.name]));
    this.setChat(this.chat);
  }

  /** The chat as the API server last answered it, and what is shown of it. */
  private setChat(chat: Chat | null): void {
    this.chat = chat;
    this.chatModel = {
      model: this.settings.model, model_id: this.settings.model_id ?? '', effort: this.settings.effort,
    };
    const listed = this.settings.agents;
    this.enabledAgentNames = this.agents.filter((agent) => !listed || listed.includes(agent.agent_id))
      .map((agent) => agent.name);
  }

  /** Whether a connection answers for this chat, where the person may
   *  list connections at all. */
  private async readModels(): Promise<void> {
    if (!this.auth.can('settings:llm:list')) return;
    const connections = await this.llm.list().catch(() => null);
    if (!connections || this.destroyed) return;
    const own = this.settings.model;
    this.hasModel = own ? connections.some((connection) => connection.connection_id === own)
      : connections.some((connection) => connection.default);
  }

  /** What is known of the files the messages name: each read once, the
   *  first time a message names one the page does not know. */
  private async knowFiles(): Promise<void> {
    const unknown = [...new Set(this.state.value.messages.flatMap((message) => message.files))]
      .filter((id) => !this.askedFiles.has(id));
    unknown.forEach((id) => this.askedFiles.add(id));
    const found = await Promise.all(unknown.map((id) => this.records.get('file', id).catch(() => null)));
    const known = found.filter((record) => record?.file).map((record) => [record!.record_id, record!.file!]);
    if (known.length && !this.destroyed) this.files = { ...this.files, ...Object.fromEntries(known) };
  }

  async loadOlderMessages(): Promise<void> {
    const oldest = this.state.value.messages.find((message) => !message.message_id.startsWith('pending:'));
    if (!oldest || !this.hasOlderMessages || this.loadingOlderMessages) return;
    this.loadingOlderMessages = true;
    try {
      const opening = this.opening;
      const res = await this.aiSession.listMessages(this.chat_id, oldest.message_id, ChatDetailComponent.PAGE);
      if (this.destroyed || opening !== this.opening) return;
      if (res.error || !res.data) {
        this.state.addError('assistant', 'history_failed', res.error || 'Unable to load earlier messages.', true);
        return;
      }
      this.state.addOlder(res.data.messages);
      this.hasOlderMessages = res.data.messages.length >= ChatDetailComponent.PAGE;
      void this.knowFiles();
    } finally {
      this.loadingOlderMessages = false;
    }
  }

  // =========================
  // The socket
  // =========================

  private onConnection(connection: ChatConnectionState): void {
    this.connectionState = connection;
    // Pictures travel on the socket and are never replayed: a view left
    // as it was across a lost socket would go on saying "watching".
    if (connection !== 'connected') this.settleScreen();
    if (connection === 'connected') {
      this.state.clearErrors('connection');
    } else if (connection === 'reconnecting') {
      this.state.addError('connection', 'reconnecting', 'The connection was interrupted. Reconnecting…', true);
    } else if (connection === 'missing') {
      this.state.addError('connection', 'missing', 'This chat is not yours any more: it was deleted, or handed on.');
    }
  }

  private onEvent(event: ChatEvent): void {
    const order = this.state.sequence(event);
    if (order === 'gap' && !this.rereading) {
      // Events were missed, past what the socket replays: the chat is
      // read again from its records.
      this.rereading = true;
      void this.readChat().finally(() => (this.rereading = false));
    }
    if (order !== 'take') return;
    switch (event.event) {
      case 'message':
        this.state.addMessage(event.data);
        void this.knowFiles();
        if (event.data.actor === 'assistant') {
          // Said as it arrives, where the person asked for that.
          this.readAloud.arrived(event.data.message_id, event.data.parts
            .map((part) => ('text' in part ? part.text || '' : '')).filter(Boolean).join('\n\n'), event.data.at);
        }
        return;
      case 'working':
        this.state.setWorking(true);
        this.chatDone.working(this.chat_id);
        return;
      case 'idle':
        this.state.setWorking(false);
        this.chatDone.idle(this.chat_id, this.title);
        return;
      case 'work':
        this.state.work(event.data);
        return;
      case 'saying':
        this.state.addSaying(String(event.data.text || ''));
        return;
      case 'doing':
        this.state.setDoing(event.data);
        return;
      case 'progress': {
        const { call, line } = event.data;
        this.state.progress(event.data.work, line);
        // The screen's own call speaking: its words go in the log under
        // the picture.
        if (this.screen?.call === call && line) this.screen = { ...this.screen, log: screenLog(this.screen.log, line) };
        return;
      }
      case 'screen':
        this.showScreen(event.data.agent, event.data.call, event.data.screen);
        return;
      case 'card_opened':
        this.state.addCard(event.data);
        return;
      case 'card_closed':
        // Gone from the cards waiting; its answer takes its place in the thread.
        this.state.closeCard(event.data.card_id);
        this.state.remember(event);
        return;
      case 'stopped':
        this.clearKillTimer();
        this.killing = false;
        this.endScreen();
        this.state.stopped();
        this.state.remember(event);
        return;
      case 'runtime_unavailable':
        this.state.setWorking(false);
        this.state.addError('connection', 'runtime_unavailable',
          'No runtime can take this chat now. What you wrote is kept, and read once one can.', true);
        return;
      case 'schedule_added':
        this.state.remember(event);
        void this.countSchedules();
        return;
      case 'schedule_ran':
      case 'settings_changed':
        this.state.remember(event);
        return;
    }
  }

  // =========================
  // The screen
  // =========================

  private showScreen(agent: string, call: string, screen: Screen | null): void {
    if (!screen) {
      if (this.screen?.call === call) this.endScreen();
      return;
    }
    // A PNG's bytes start "\x89PNG", "iVBOR" in base64; anything else is
    // taken for the JPEG the standard allows beside it.
    const mime = screen.image.startsWith('iVBOR') ? 'image/png' : 'image/jpeg';
    // The browser asked for from the header: its first picture is shown.
    if (this.screenOpening) {
      this.endOpening();
      this.screenHidden = false;
      this.hiddenCall = '';
    }
    this.screen = {
      call, src: `data:${mime};base64,${screen.image}`,
      width: Number(screen.width) || 1, height: Number(screen.height) || 1,
      agent_name: this.names[agent] || agent,
      log: this.screen?.call === call ? this.screen.log : [],
      at: Date.now(), tabs: this.screenTabs(screen.tabs),
    };
    if (this.screenHidden && this.hiddenCall !== call) this.screenHidden = false;
  }

  /** The tabs a frame tells of. The same list object is kept while
   *  nothing in it changed: a strip rebuilt with every frame would take
   *  a click away from under the pointer. */
  private screenTabs(told: unknown): ScreenTab[] {
    const tabs: ScreenTab[] = (Array.isArray(told) ? told : []).filter((tab) => tab && Number(tab.index) >= 1)
      .map((tab) => ({ index: Number(tab.index), title: String(tab.title || tab.address || 'New tab'),
        address: String(tab.address || ''), active: !!tab.active }));
    const before = this.screen?.tabs || [];
    const same = before.length === tabs.length && before.every((tab, i) => tab.index === tabs[i].index
      && tab.title === tabs[i].title && tab.address === tabs[i].address && tab.active === tabs[i].active);
    return same ? before : tabs;
  }

  /** The live view marked idle: its last picture stays, and nothing
   *  behind it is claimed to be running. */
  private settleScreen(): void {
    if (this.screen && !this.screen.idle) this.screen = { ...this.screen, idle: true };
    this.screenTaken = false;
  }

  /** The live view gone altogether: its call closed it, or the chat was stopped. */
  private endScreen(): void {
    this.endOpening();
    this.screen = null;
    this.screenTaken = false;
    this.screenHidden = false;
    this.hiddenCall = '';
  }

  /** The person's hand on the screen: to the agent, over the socket. */
  onScreenInput(input: ScreenInputEvent[]): void {
    if (this.screen && input.length) this.connection.send('AI:Chat:screen', { call: this.screen.call, input });
  }

  /** The person closed the panel; the agent hears it. */
  onScreenClosed(): void {
    if (this.screen && !this.screen.idle) this.onScreenInput([{ type: 'control', action: 'close' }]);
    this.screenHidden = true;
    this.hiddenCall = this.screen?.call || '';
  }

  /** A hidden panel comes back. */
  showHiddenScreen(): void {
    this.screenHidden = false;
    this.hiddenCall = '';
  }

  /** The header's live view: shown or hidden where there is a screen; with
   *  none, the browser agent is asked to open its browser, as it was left,
   *  and the view shows with its first picture. */
  async toggleLiveView(): Promise<void> {
    if (this.screen) {
      if (this.screenHidden) this.showHiddenScreen();
      else this.onScreenClosed();
      return;
    }
    if (this.screenOpening) return;
    this.screenOpening = true;
    const chatId = this.chat_id;
    const res = await this.aiSession.call(chatId, BROWSER_AGENT, 'browse_watch', { action: 'open' });
    if (this.destroyed || chatId !== this.chat_id) return;
    if (res.error) {
      this.endOpening();
      this.state.addError('assistant', 'browser_refused', `The browser could not be opened: ${res.error}`);
      return;
    }
    if (this.screenOpening && !this.openingTimer) {
      this.openingTimer = setTimeout(() => this.endOpening(), ChatDetailComponent.OPENING_MS);
    }
  }

  private endOpening(): void {
    if (this.openingTimer) clearTimeout(this.openingTimer);
    this.openingTimer = null;
    this.screenOpening = false;
  }

  // =========================
  // Writing
  // =========================

  /** The person's words, and their files: shown at once, sent over
   *  HTTP, and kept by the server whatever the socket is doing. */
  async onPrompt(message: Prompt): Promise<void> {
    const files = message.uploads.map((upload) => upload.record_id).filter((id): id is string => !!id);
    for (const upload of message.uploads) {
      if (upload.record_id) {
        this.files[upload.record_id] = { name: upload.filename, type: upload.file_type, size: upload.file_size };
      }
    }
    const clientId = crypto.randomUUID();
    // Told before it is sent: the chat can be at work before the send's answer is back.
    this.chatDone.began(this.chat_id, this.title, this.state.value.working);
    this.state.startSubmission(clientId, message.query, files);
    const res = await this.aiSession.input(this.chat_id, message.query, files, clientId);
    if (this.destroyed) return;
    if (res.error || !res.data) {
      // Take the words back: leaving them on screen beside an error
      // saying they were not sent is worse than never showing them.
      this.state.dropSubmission(clientId);
      this.giveBack(message);
      this.state.addError('composer', 'send_failed', res.error || 'The message could not be sent. Try again.', true);
      return;
    }
    this.state.addMessage(res.data.message);
  }

  /** Words and files back in the composer. Emptied, then given back
   *  after a check, so the same words given back twice still come back. */
  private giveBack(message: Prompt): void {
    this.composerDraft = '';
    setTimeout(() => (this.composerDraft = message.query || ''));
    const files = message.uploads.filter((upload) => upload.record_id);
    if (files.length) {
      this.stagedFiles = files.map((upload) => ({
        record_id: upload.record_id!, name: upload.filename, type: upload.file_type, size: upload.file_size,
      }));
    }
  }

  // =========================
  // Stopping
  // =========================

  askKill(): void {
    this.killAsking = true;
  }

  /** One call or task stopped, the rest going on. Its `work` event says
   *  when it has. */
  async stopWork(work: string): Promise<void> {
    if (this.stoppingWork.includes(work)) return;
    this.stoppingWork = [...this.stoppingWork, work];
    const res = await this.aiSession.stop(this.chat_id, work);
    this.stoppingWork = this.stoppingWork.filter((one) => one !== work);
    if (res.error) this.state.addError('assistant', 'stop_failed', res.error, true);
  }

  async confirmKill(): Promise<void> {
    if (this.killing) return;
    this.killAsking = false;
    this.killing = true;
    const res = await this.aiSession.stop(this.chat_id);
    if (res.error) {
      this.killing = false;
      this.state.addError('assistant', 'stop_failed', res.error, true);
      return;
    }
    this.clearKillTimer();
    this.killTimer = setTimeout(() => {
      this.killTimer = null;
      this.killing = false;
    }, ChatDetailComponent.KILL_WAIT_MS);
  }

  private clearKillTimer(): void {
    if (this.killTimer) clearTimeout(this.killTimer);
    this.killTimer = null;
  }

  // =========================
  // Cards
  // =========================

  /** A card's answer: a file uploaded first, an account connected first,
   *  then the answer, which the API server keeps before the runtime
   *  hears it. */
  async onDecision(decision: CardDecision): Promise<void> {
    const card = this.cards.find((one) => one.card_id === decision.card_id);
    if (!card || this.answering.has(card.card_id)) return;
    this.answering.add(card.card_id);
    try {
      let answer = decision.answer;
      if (decision.file) {
        const sent = await this.filesService.upload(decision.file).done;
        if (!sent.record) {
          this.state.addError('approval', 'upload_failed', sent.error || `Could not attach ${decision.file.name}.`, true);
          return;
        }
        answer = { file: sent.record.record_id };
      }
      if (decision.connect && card.kind === 'form') {
        const connected = await this.oauth.connect(card.request.record);
        if (connected.error) {
          this.state.addError('approval', 'connect_failed', connected.error, true);
          return;
        }
      }
      if (!answer) return;
      const res = await this.aiSession.decide(card.card_id, answer);
      if (res.error) {
        // Answered elsewhere, or expired: asking again can only be
        // refused again, so the card goes, and the reason is said.
        if (res.code === 'not_found' || res.code === 'conflict') this.state.closeCard(card.card_id);
        this.state.addError('approval', 'answer_failed', res.error, res.code !== 'not_found' && res.code !== 'conflict');
        return;
      }
      this.state.closeCard(card.card_id);
      // The answer sets the chat going again.
      this.chatDone.began(this.chat_id, this.title, this.working);
    } finally {
      this.answering.delete(card.card_id);
    }
  }

  private async countSchedules(): Promise<void> {
    if (!this.auth.can('ai:schedule:list')) return;
    const read = await this.activityService.schedules(this.chat_id).catch(() => null);
    if (!read || read.error || this.destroyed) return;
    this.scheduleCount = read.schedules.length;
  }

  // =========================
  // Settings
  // =========================

  /** Change some of the chat's settings; the holder is given them again. */
  private async change(settings: Partial<ChatSettings>): Promise<boolean> {
    const res = await this.aiSession.updateChat(this.chat_id, { settings });
    if (res.error || !res.data) {
      this.onError(res.error);
      return false;
    }
    this.setChat(res.data.chat);
    return true;
  }

  /** A setting changed in the inspector. */
  onSettingsChosen(changes: Partial<ChatSettings>): void {
    void this.change(changes);
  }

  onTrustLevelChange(trust: number): void {
    void this.change({ trust: trust as ChatSettings['trust'] });
  }

  onTurnBudgetChange(turns: number): void {
    void this.change({ turn_budget: turns });
  }

  /** The chat's schedules keep the browser's time from now on. */
  useBrowserZone(): void {
    if (this.browserZone) void this.change({ time_zone: this.browserZone });
  }

  trustLabel(level: number): string {
    return this.trustOptions.find((option) => option.value === level)?.name ?? `Level ${level}`;
  }

  turnBudgetLabel(turns: number): string {
    return this.turnBudgetOptions.find((option) => option.value === turns)?.name ?? `${turns} turns`;
  }

  /** The model picked under the composer: this chat thinks with it from
   *  its next turn, and the person's next chat starts with it. */
  async onModelChosen(model: ChatModel): Promise<void> {
    const picked = { model: model.model, model_id: model.model_id, effort: model.effort };
    if (!(await this.change(picked))) return;
    void this.readModels();
    const kept = await this.defaults();
    const saved = await this.profileService.savePreferences({ chat: { ...kept, ...picked } });
    if (saved.error) {
      this.onError(`The model was changed for this chat, but could not be kept for your next: ${saved.error}`);
    }
  }

  /** What the person's new chats start with. */
  private async defaults(): Promise<Partial<ChatSettings>> {
    return chatDefaults((await this.profileService.get())?.preferences.chat);
  }

  private async openAgentsDialog(): Promise<void> {
    const defaults = await this.defaults();
    const ref = this.dialog.open(ChatAgentsDialogComponent, {
      width: '480px', maxWidth: '95vw',
      data: { agents: this.settings.agents, mcp_servers: this.settings.mcp_servers, defaults },
    });
    ref.afterClosed().subscribe((result: ChatReach | null) => {
      if (result) void this.change(result);
    });
  }

  /** Which skills this chat puts in front of the assistant: not a
   *  security boundary, but where its attention goes. */
  private async openSkillsDialog(): Promise<void> {
    const defaults = await this.defaults();
    const ref = this.dialog.open(ChatSkillsDialogComponent, {
      width: '560px', maxWidth: '95vw',
      data: { skills: this.settings.skills, defaults: defaults.skills ?? null },
    });
    ref.afterClosed().subscribe((result: { skills: string[] | null } | null) => {
      if (result) void this.change(result);
    });
  }

  // =========================
  // Header actions
  // =========================

  /** The inspector, opened on a tab; asked for the tab it is open on, closed. */
  togglePanel(tab: InspectorTab): void {
    const showing = this.panelOpen && this.panelTab === tab;
    this.panelTab = tab;
    this.panelOpen = !showing;
  }

  onStatusDotClicked(): void {
    if (!this.isSocketReady) this.connection.reconnectNow();
  }

  startTitleEdit(): void {
    this.titleDraft = this.title;
    this.isEditingTitle = true;
  }

  cancelTitleEdit(): void {
    this.isEditingTitle = false;
    this.titleDraft = '';
  }

  async saveTitle(): Promise<void> {
    if (!this.isEditingTitle) return;
    const next = this.titleDraft.trim();
    this.isEditingTitle = false;
    this.titleDraft = '';
    if (!next || next === this.title) return;
    const res = await this.aiSession.updateChat(this.chat_id, { title: next });
    if (res.error || !res.data) this.onError(res.error);
    else this.setChat(res.data.chat);
  }

  /** The conversation taken away, on the person's word: its messages,
   *  its events and its cards. Its settings and schedules stay. */
  async clearConversation(): Promise<void> {
    const sure = await this.confirm.ask({
      title: 'Clear this conversation?',
      body: 'Its messages and cards are deleted for good. The chat, its settings and its schedules stay.',
      confirm: 'Clear', danger: true,
    });
    if (!sure) return;
    const res = await this.aiSession.clearChat(this.chat_id);
    if (res.error) {
      this.onError(res.error);
      return;
    }
    this.connection.disconnect();
    this.state.reset();
    this.endScreen();
    void this.initChat();
  }

  onMessagesActionClicked(type: 'refresh' | 'agents' | 'skills'): void {
    if (type === 'refresh') {
      this.state.reset();
      void this.initChat();
    } else if (type === 'agents') {
      void this.openAgentsDialog();
    } else {
      void this.openSkillsDialog();
    }
  }

  // =========================
  // Alerts
  // =========================

  private onError(message = ''): void {
    this.state.addError('assistant', 'chat_error', message || 'Something went wrong. Refresh the conversation and try again.');
  }

  dismissError(id: number): void {
    this.state.dismissError(id);
  }

  retryInlineError(error: InlineChatError): void {
    this.state.dismissError(error.id);
    if (error.scope === 'connection') this.connection.reconnectNow();
  }
}
