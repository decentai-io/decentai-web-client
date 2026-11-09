import {
  Component,
  EventEmitter,
  Input,
  ElementRef,
  ViewChild,
  OnChanges,
  SimpleChanges,
  NgZone,
  AfterViewInit,
  OnDestroy,
  Output,
} from '@angular/core';
import { ChatMessage } from 'src/app/models/chat-protocol';
import { ChatTurn, WorkStep } from 'src/app/services/chat-state.service';
import { KnownFile } from '../chat-message/chat-message.component';

@Component({
  selector: 'app-chat-messages-container',
  standalone: false,
  templateUrl: './chat-messages-container.component.html',
  styleUrl: './chat-messages-container.component.css',
})
export class ChatMessagesContainerComponent
  implements OnChanges, AfterViewInit, OnDestroy
{
  @Input() loading = false;
  @Input() isProcessing = false;
  /** The reply as it is being written, shown as one until its message lands. */
  @Input() draft = '';
  draftMessage: ChatMessage | null = null;
  /** Each turn's work, by the turn's key: one card between question and
   *  answer. */
  @Input() steps: Record<string, WorkStep[]> = {};
  @Input() stoppingAll = false;
  @Output() stopAll = new EventEmitter<void>();
  @Input() stoppingWork: string[] = [];
  @Output() stopWork = new EventEmitter<string>();
  /** The files the page knows of, and the installed agents' names, for
   *  the messages. */
  @Input() files: Record<string, KnownFile> = {};
  @Input() names: Record<string, string> = {};
  @Input() turns: ChatTurn[] = [];
  @Input() hasMore = false;
  @Input() loadingOlder = false;

  /** What this chat can reach, by name. An empty conversation that lists
   *  its own capabilities answers "what can I ask?" — which is the
   *  question somebody staring at a blank chat actually has. */
  @Input() agentNames: string[] = [];
  /** The whole answer of a turn, for the one copy control it has. */
  turnText(turn: ChatTurn): string {
    return turn.assistantMessages.flatMap((message) => message.parts)
      .map((part) => ('text' in part ? part.text || '' : '')).filter(Boolean).join('\n\n');
  }
  @Output() loadOlder = new EventEmitter<void>();
  @Output() opener = new EventEmitter<string>();

  /** Openers worth offering: enough to show the shape of a request,
   *  never so many that the page becomes a menu. */
  readonly openers = [
    'What can you help me with?',
    'Which agents can you use in this chat?',
  ];

  get capabilityLine(): string {
    if (!this.agentNames.length) {
      return 'No agents are enabled for this chat — it can talk, but it '
        + 'cannot act in another system yet.';
    }
    const names = this.agentNames.slice(0, 3).join(', ');
    const more = this.agentNames.length - 3;
    return more > 0
      ? `${names} and ${more} more are ready to work in this chat.`
      : `${names} ${this.agentNames.length === 1 ? 'is' : 'are'} ready to work in this chat.`;
  }

  @ViewChild('messagesContainer', { static: false })
  private messagesContainer!: ElementRef<HTMLDivElement>;
  @ViewChild('messagesInner', { static: false })
  private messagesInner?: ElementRef<HTMLDivElement>;

  /** Whether the turn is in hand, as the page shows it: on the moment
   *  work starts, off only once it has stayed off a moment. The flag it
   *  follows blinks at a turn's start — the message sent, the socket's
   *  first word that nothing runs yet, then the work — and the thread
   *  would blink with it. */
  busy = false;
  private static readonly SETTLE_MS = 900;
  private settleTimer: ReturnType<typeof setTimeout> | null = null;

  /** Whether the turn in hand has a card: only when it did something. A
   *  turn that only talks has none, during or after: the answer is all
   *  there is to say. */
  get showLiveWork(): boolean {
    return !!this.steps[this.turns[this.turns.length - 1]?.key ?? '']?.length;
  }

  /** The assistant is on it and has nothing to show yet: three dots
   *  where its answer will be, and, past a few seconds, for how long. */
  get thinking(): boolean {
    return this.busy && !this.draftMessage;
  }

  /** What the turn is doing, as its last line says it, and, past a few
   *  seconds, for how long. */
  get liveLine(): string {
    const steps = this.steps[this.turns[this.turns.length - 1]?.key ?? ''] || [];
    const running = steps.filter((step) => step.status === 'running').length;
    const said = running ? `Working · ${running} running` : 'Thinking';
    return this.elapsedSeconds >= 4 ? `${said} · ${this.elapsedSeconds}s` : said;
  }

  /** How long the current turn has been running, ticking once a second
   *  while the assistant works. */
  turnStartedAt = 0;
  elapsedSeconds = 0;
  private elapsedTimer: any = null;

  private startElapsedClock(): void {
    this.stopElapsedClock();
    this.elapsedTimer = setInterval(() => {
      this.elapsedSeconds = Math.floor((Date.now() - this.turnStartedAt) / 1000);
    }, 1000);
  }

  private stopElapsedClock(): void {
    if (this.elapsedTimer) { clearInterval(this.elapsedTimer); this.elapsedTimer = null; }
  }

  private userNearBottom = true;
  private resizeObs?: ResizeObserver;
  newUpdateCount = 0;

  /** When a scroll we started is expected to have settled. Its own frames
   *  raise scroll events like any other, and reading the thread's position
   *  from one of those says "they have scrolled away" about a movement
   *  nobody made — which switches off the very correction below that
   *  copes with a table arriving late. */
  private autoScrollUntil = 0;

  private scrollingOurselves(): boolean {
    return Date.now() < this.autoScrollUntil;
  }

  constructor(private ngZone: NgZone) {}

  ngOnChanges(changes: SimpleChanges): void {
    // A new message arrived → scroll (always for the user's own message; for AI
    // replies only when the user is already following along near the bottom).
    if (changes['turns']) {
      requestAnimationFrame(() => {
        if (this.resizeObs && this.messagesInner) {
          this.resizeObs.observe(this.messagesInner.nativeElement);
        }
      });
      const curr: ChatTurn[] = changes['turns'].currentValue || [];
      const prev: ChatTurn[] = changes['turns'].previousValue || [];
      const additions = this.activityCount(curr) - this.activityCount(prev);
      if (additions > 0) {
        const isPrepend = !!prev.length && curr.some((turn, index) =>
          turn?.key === prev[0]?.key && index > 0);
        if (isPrepend && this.messagesContainer) {
          const el = this.messagesContainer.nativeElement;
          const oldHeight = el.scrollHeight;
          requestAnimationFrame(() => el.scrollTop += el.scrollHeight - oldHeight);
          return;
        }
        const actor = curr[curr.length - 1]?.userMessage ? 'user' : 'ai';
        if (actor === 'user' || this.userNearBottom) {
          this.deferScrollToBottom(actor !== 'user');
          this.newUpdateCount = 0;
        } else {
          this.newUpdateCount += additions;
        }
      }
    }

    if (changes['draft']) {
      this.draftMessage = this.draft ? { message_id: 'saying', seq: 0, actor: 'assistant',
        parts: [{ type: 'text', text: this.draft }], files: [], client_id: '', at: '' } : null;
      if (this.draftMessage && this.userNearBottom) this.deferScrollToBottom(false);
    }

    if (changes['isProcessing']) this.follow(this.isProcessing);

    // The live work renders below the messages, so reveal it as it
    // updates — otherwise it gets buried offscreen.
    if (changes['steps'] && this.userNearBottom) {
      this.deferScrollToBottom(true);
    }

  }

  /** The flag moved: a turn begins at once; it ends only when the flag
   *  has stayed down for SETTLE_MS, so a blink is no end and no new
   *  beginning — the clock keeps running, the steps stay open. */
  private follow(processing: boolean): void {
    if (processing) {
      if (this.settleTimer) {
        clearTimeout(this.settleTimer);
        this.settleTimer = null;
      }
      if (!this.busy) this.began();
      return;
    }
    if (!this.busy || this.settleTimer) return;
    this.settleTimer = setTimeout(() => this.ngZone.run(() => {
      this.settleTimer = null;
      if (!this.isProcessing) this.ended();
    }), ChatMessagesContainerComponent.SETTLE_MS);
  }

  /** The clock on the live line runs from the moment the person sent,
   *  so a slow first thought is seen to be taking time rather than
   *  doing nothing. The steps open while the work runs: during, they
   *  ARE the content. */
  private began(): void {
    this.busy = true;
    this.turnStartedAt = Date.now();
    this.elapsedSeconds = 0;
    this.startElapsedClock();
    if (this.userNearBottom) this.deferScrollToBottom(true);
  }

  /** At the end the answer is the content: the card folds by itself. */
  private ended(): void {
    this.busy = false;
    this.stopElapsedClock();
  }

  ngAfterViewInit() {
    if (!this.messagesContainer) return;
    this.deferScrollToBottom(false);

    const el = this.messagesContainer.nativeElement;
    this.ngZone.runOutsideAngular(() => {
      // Scroll when container itself resizes (window resize, sidebar toggle, etc.)
      this.resizeObs = new ResizeObserver(() => {
        if (this.userNearBottom) this.scrollToBottom(false);
      });
      this.resizeObs.observe(el);
      if (this.messagesInner) this.resizeObs.observe(this.messagesInner.nativeElement);
    });
  }

  /** How many messages the turns hold between them. */
  private activityCount(turns: ChatTurn[]): number {
    return turns.reduce((count, turn) =>
      count + (turn.userMessage ? 1 : 0) + turn.assistantMessages.length, 0);
  }

  ngOnDestroy() {
    this.resizeObs?.disconnect();
    this.stopElapsedClock();
    if (this.settleTimer) clearTimeout(this.settleTimer);
  }

  showJumpToLatest = false;

  onScroll() {
    if (!this.messagesContainer) return;
    const el = this.messagesContainer.nativeElement;
    const threshold = 100;
    // Only a person's own scroll decides whether to keep following the
    // foot of the thread. Ours does not get a vote.
    if (!this.scrollingOurselves()) {
      this.userNearBottom =
        el.scrollTop + el.clientHeight >= el.scrollHeight - threshold;
    }
    // Reveal the "jump to latest" affordance once the user scrolls up a bit.
    this.showJumpToLatest = el.scrollHeight - (el.scrollTop + el.clientHeight) > 240;
    if (this.userNearBottom) this.newUpdateCount = 0;
    if (el.scrollTop < 100 && this.hasMore && !this.loadingOlder) this.loadOlder.emit();
  }

  jumpToLatest(): void {
    this.showJumpToLatest = false;
    this.newUpdateCount = 0;
    this.scrollToBottom(true);
  }

  /** Wait for DOM layout before scrolling. Two frames, not one: the
   *  thread and its "loading" flag flip in the same change-detection
   *  pass, so after a single frame the messages are in the DOM but the
   *  browser has not laid them out yet and scrollHeight still answers
   *  for the skeleton. */
  private deferScrollToBottom(smooth = false) {
    this.ngZone.runOutsideAngular(() => {
      requestAnimationFrame(() =>
        requestAnimationFrame(() => this.scrollToBottom(smooth)));
    });
  }

  private scrollToBottom(smooth = false) {
    if (!this.messagesContainer) return;
    const el = this.messagesContainer.nativeElement;
    // Going to the foot of the thread IS following it — say so before the
    // move, so the frames it raises cannot argue otherwise, and so that
    // whatever grows afterwards is still chased down.
    this.userNearBottom = true;
    this.autoScrollUntil = Date.now() + (smooth ? 700 : 150);
    el.scrollTo({ top: el.scrollHeight, behavior: smooth ? 'smooth' : 'auto' });
  }
}
