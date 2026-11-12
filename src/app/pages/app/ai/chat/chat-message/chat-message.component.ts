import { AfterViewChecked, Component, ElementRef, Input, OnChanges, OnDestroy, Renderer2, SimpleChanges } from '@angular/core';
import { Clipboard } from '@angular/cdk/clipboard';
import { MarkdownService } from 'ngx-markdown';
import * as Prism from 'prismjs';

import { drawDiagram } from './chat-diagram';
import 'prismjs/components/prism-bash';
import 'prismjs/components/prism-json';
import 'prismjs/components/prism-python';
import 'prismjs/components/prism-sql';
import 'prismjs/components/prism-typescript';
import 'prismjs/components/prism-yaml';
import { ChartInput } from 'src/app/components/chart-viewer/chart-viewer.component';
import { AgentChart, AgentTable, ChatMessage, MessagePart } from 'src/app/models/chat-protocol';
import { FilesService } from 'src/app/services/files.service';
import { ReadAloudService } from 'src/app/services/read-aloud.service';
import { AppRecord } from 'src/app/services/records.service';
import { ChatMarkdownService } from './chat-markdown.service';

/** What is known of a file a message names: its name, type and size. */
export type KnownFile = NonNullable<AppRecord['file']>;

@Component({
  selector: 'app-chat-message',
  standalone: false,
  templateUrl: './chat-message.component.html',
  styleUrls: ['./chat-message.component.css'],
  // A message's markdown loads nothing from elsewhere; every other
  // page keeps the app's own renderer.
  providers: [{ provide: MarkdownService, useClass: ChatMarkdownService }],
})
export class ChatMessageComponent implements OnChanges, AfterViewChecked, OnDestroy {
  @Input() message!: ChatMessage;

  /** A further assistant message in the same turn: the answer went on,
   *  so the name and the time are not repeated — one speaker, one
   *  header, however many messages it took. */
  @Input() continuation = false;
  /** What the copy control copies when the answer spans several
   *  messages: the whole of it, handed in by the thread. */
  @Input() copyText: string | null = null;
  /** The answer is still being written: its last words end in a caret. */
  @Input() streaming = false;
  /** The files the page knows of, by record id: a message names its
   *  files by id alone. */
  @Input() files: Record<string, KnownFile> = {};
  /** The installed agents' names, by id. */
  @Input() agentNames: Record<string, string> = {};
  copiedPart: string | null = null;
  contentExpanded = false;
  fileError = '';
  private enhancedBlocks = new WeakSet<HTMLElement>();
  /** Which of the message's code blocks, counted from the top, the
   *  person set to wrap. The markdown is drawn again while an answer is
   *  written and when the thread hands in the message anew, and each
   *  drawing is new elements: the choice is kept here, not on them. */
  private wrapped = new Set<number>();
  private cleanups: Array<() => void> = [];

  /** When the message happened — time alone for today, date + time
      otherwise. Empty string → nothing shown. */
  get timeLabel(): string {
    const raw = this.message?.at;
    if (!raw) return '';
    const date = new Date(raw);
    if (isNaN(date.getTime())) return '';
    const time = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    if (date.toDateString() === new Date().toDateString()) return time;
    return `${date.toLocaleDateString([], { month: 'short', day: 'numeric' })}, ${time}`;
  }

  /** The pictures a message's markdown names on the API server, each
   *  shown from a blob fetched with the session (`showOwnPictures`). */
  private ownPictures = new WeakSet<HTMLImageElement>();
  /** Links to the server's files already made to open with the session. */
  private ownLinks = new WeakSet<HTMLAnchorElement>();
  /** An agent's table's rows and a chart's data, made once for each: a new
   *  array on every check is new data to the table, which redraws, which
   *  is checked again, without end. */
  private rowsOf = new WeakMap<AgentTable, Record<string, unknown>[]>();
  private chartsOf = new WeakMap<AgentChart, ChartInput>();
  private blobs: string[] = [];

  constructor(
    private clipboard: Clipboard,
    private filesService: FilesService,
    private host: ElementRef<HTMLElement>,
    private renderer: Renderer2,
    public readAloud: ReadAloudService,
  ) {}

  /** What this reply is known by to the voice: one reply is said at a
   *  time, and the control shows which. */
  get speechKey(): string {
    return String(this.message?.message_id || '');
  }

  get isSpeaking(): boolean {
    return !!this.speechKey && this.readAloud.speaking === this.speechKey;
  }

  ngOnChanges(changes: SimpleChanges): void {
    // Only another message starts folded again. The same message handed
    // in anew — words still arriving, the turn ending, the thread
    // refreshed — keeps what the person opened and wrapped.
    const change = changes['message'];
    if (change && (change.firstChange || change.previousValue?.message_id !== change.currentValue?.message_id)) {
      this.contentExpanded = false;
      this.fileError = '';
      this.wrapped.clear();
    }
  }

  ngAfterViewChecked(): void {
    this.showOwnPictures();
    this.host.nativeElement.querySelectorAll<HTMLElement>('pre').forEach((pre, index) => {
      if (this.enhancedBlocks.has(pre)) return;
      this.enhancedBlocks.add(pre);
      const code = pre.querySelector('code');
      if (!code) return;
      const language = Array.from(code.classList).find((name) => name.startsWith('language-'))
        ?.replace('language-', '') || 'code';
      // Coloured where the language is one of those loaded above.
      // Prism escapes what it colours, so the markup is its own.
      const grammar = Prism.languages[language];
      if (grammar) code.innerHTML = Prism.highlight(code.textContent || '', grammar, language);
      const toolbar = this.renderer.createElement('div');
      this.renderer.addClass(toolbar, 'code-toolbar');
      const label = this.renderer.createElement('span');
      this.renderer.appendChild(label, this.renderer.createText(language));
      const wrap = this.renderer.createElement('button');
      this.renderer.setAttribute(wrap, 'type', 'button');
      const wraps = this.wrapped.has(index);
      if (wraps) this.renderer.addClass(pre, 'code-wrap');
      this.renderer.setAttribute(wrap, 'aria-pressed', String(wraps));
      this.renderer.appendChild(wrap, this.renderer.createText('Wrap'));
      const copy = this.renderer.createElement('button');
      this.renderer.setAttribute(copy, 'type', 'button');
      // Its word changes to "Copied", and that is said aloud.
      this.renderer.setAttribute(copy, 'aria-live', 'polite');
      this.renderer.appendChild(copy, this.renderer.createText('Copy'));
      this.renderer.appendChild(toolbar, label);
      this.renderer.appendChild(toolbar, wrap);
      this.renderer.appendChild(toolbar, copy);
      this.renderer.insertBefore(pre, toolbar, code);
      this.cleanups.push(this.renderer.listen(wrap, 'click', () => {
        const on = pre.classList.toggle('code-wrap');
        wrap.setAttribute('aria-pressed', String(on));
        if (on) this.wrapped.add(index); else this.wrapped.delete(index);
      }));
      if (language === 'mermaid') this.drawInto(pre, toolbar, code);
      this.cleanups.push(this.renderer.listen(copy, 'click', () => {
        this.clipboard.copy(code.textContent || '');
        copy.textContent = 'Copied';
        setTimeout(() => copy.textContent = 'Copy', 1500);
      }));
    });
    this.host.nativeElement.querySelectorAll<HTMLAnchorElement>('.msg-ai markdown a').forEach((link) => {
      if (/^https?:/i.test(link.href)) {
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
      }
    });
  }

  /** A block of Mermaid is shown as the diagram it describes, with its
   *  text one press away. Text that does not draw (a reply still being
   *  written, a mistake) stays the code it is. */
  private drawInto(pre: HTMLElement, toolbar: HTMLElement, code: HTMLElement): void {
    const dark = document.documentElement.classList.contains('dark');
    void drawDiagram(code.textContent || '', dark).then((svg) => {
      if (!svg || !pre.isConnected) return;
      const diagram = this.renderer.createElement('div');
      this.renderer.addClass(diagram, 'code-diagram');
      this.renderer.setAttribute(diagram, 'role', 'img');
      this.renderer.setAttribute(diagram, 'aria-label', 'Diagram');
      // The library's own drawing, made at its strict level: it holds
      // no markup of the message's.
      diagram.innerHTML = svg;
      this.renderer.insertBefore(pre, diagram, code);
      const show = this.renderer.createElement('button');
      this.renderer.setAttribute(show, 'type', 'button');
      this.renderer.setAttribute(show, 'aria-pressed', 'false');
      this.renderer.appendChild(show, this.renderer.createText('Code'));
      this.renderer.insertBefore(toolbar, show, toolbar.children[1]);
      this.renderer.addClass(pre, 'has-diagram');
      toolbar.children[0].textContent = 'Diagram';
      this.cleanups.push(this.renderer.listen(show, 'click', () =>
        show.setAttribute('aria-pressed', String(pre.classList.toggle('show-code')))));
    });
  }

  ngOnDestroy(): void {
    this.cleanups.forEach((cleanup) => cleanup());
    this.blobs.forEach((url) => URL.revokeObjectURL(url));
    this.blobs = [];
  }

  /**
   * A file of the API server's that the markdown names (ChatMarkdownService
   * marks it) cannot load as written: the server is on another origin and
   * knows the person by the token this app holds, which an `<img>` or a
   * link carries nowhere. A picture's bytes are fetched with the token
   * and shown from a blob; a link, followed, opens or saves the file the
   * same way (FilesService.open). Pictures from elsewhere were already
   * made links.
   */
  private showOwnPictures(): void {
    const FILE = ChatMarkdownService.FILE;
    this.host.nativeElement.querySelectorAll<HTMLImageElement>(`img[${FILE}]`).forEach((image) => {
      if (this.ownPictures.has(image)) return;
      this.ownPictures.add(image);
      const id = image.getAttribute(FILE) || '';
      if (!id) return;
      this.filesService.fetchBlob(id).then((blob) => {
        // Shown as a picture only if it is one: anything else stays its
        // description.
        if (!/^image\//i.test(blob.type)) return;
        const url = URL.createObjectURL(blob);
        this.blobs.push(url);
        image.src = url;
      }).catch(() => {
        // Left as its description.
      });
    });
    this.host.nativeElement.querySelectorAll<HTMLAnchorElement>(`a[${FILE}]`).forEach((link) => {
      if (this.ownLinks.has(link)) return;
      this.ownLinks.add(link);
      link.addEventListener('click', (event) => {
        if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey) return;
        event.preventDefault();
        const id = link.getAttribute(FILE) || '';
        if (id) this.filesService.open(id, link.textContent?.trim() || id).catch(() => this.showError('Error opening file.'));
      });
    });
  }

  /** From this many characters an answer is folded. */
  private static readonly FOLD_AT = 6000;

  get isLongResponse(): boolean {
    return this.isAI() && this.getFullText().length > ChatMessageComponent.FOLD_AT;
  }

  /** How long the whole answer is, for the fold's button: "2,400".
   *  The fold is at a height, so what is behind it cannot be counted. */
  get wordCount(): string {
    return this.getFullText().split(/\s+/).filter(Boolean).length.toLocaleString();
  }

  toggleContent(): void {
    this.contentExpanded = !this.contentExpanded;
    if (this.contentExpanded) return;
    // Folding takes away the height the person had scrolled through,
    // and the thread would show what comes after: the answer's own
    // words below the fold seemed gone. Keep its button in sight.
    setTimeout(() => this.host.nativeElement.querySelector('.msg-fold')
      ?.scrollIntoView({ block: 'nearest' }));
  }

  /** From this many files, they become one scrollable strip rather than
   *  that many cards. */
  readonly FILES_FIT = 3;

  get fileIds(): string[] {
    return this.message?.files || [];
  }

  copyToClipboard(text: string, id: string) {
    this.clipboard.copy(text || '');
    this.copiedPart = id;
    setTimeout(() => (this.copiedPart = null), 1500);
  }

  isUser(): boolean {
    return this.message?.actor === 'person';
  }

  isAI(): boolean {
    return this.message?.actor === 'assistant';
  }

  isWebhook(): boolean {
    return this.message?.actor === 'webhook';
  }

  getFullText(): string {
    return (this.message?.parts || []).map((part) => ('text' in part ? part.text || '' : ''))
      .filter(Boolean).join('\n\n');
  }

  /** The agent a part is of, by the name a person knows it by. */
  agentName(part: MessagePart): string {
    return part.type === 'agent' ? this.agentNames[part.agent] || part.agent : '';
  }

  /** An agent's table, as rows the table component reads by column. */
  tableRows(table: AgentTable): Record<string, unknown>[] {
    let rows = this.rowsOf.get(table);
    if (!rows) {
      rows = (table.rows || []).map((row) =>
        Object.fromEntries((table.columns || []).map((column, index) => [column, row?.[index]])));
      this.rowsOf.set(table, rows);
    }
    return rows;
  }

  /** An agent's chart, as the chart component reads it. */
  chartData(chart: AgentChart): ChartInput {
    let data = this.chartsOf.get(chart);
    if (!data) {
      data = {
        labels: chart.labels || [],
        datasets: (chart.series || []).map((series) => ({ label: series.name, data: series.values })),
      };
      this.chartsOf.set(chart, data);
    }
    return data;
  }

  /** What a webhook brought, as it brought it. */
  webhookData(part: MessagePart): string {
    if (part.type !== 'webhook' || part.data === undefined || part.data === null) return '';
    try {
      return JSON.stringify(part.data, null, 2);
    } catch {
      return String(part.data);
    }
  }

  file(id: string): KnownFile | undefined {
    return this.files[id];
  }

  fileName(id: string): string {
    return this.file(id)?.name || 'File';
  }

  /** Whether this file is something a person should simply see. */
  isImageFile(id: string): boolean {
    return String(this.file(id)?.type || '').startsWith('image/');
  }

  /** Save the file: fetched with the session, since a bare link to the
   *  API server carries no token. */
  downloadFile(id: string) {
    this.filesService.download(id, this.file(id)?.name || '').catch(() => this.showError('Error downloading file.'));
  }

  /** Show the file in a new tab, the same way — or save it, when it is a
   *  kind that is not shown (FilesService.open). */
  openFile(id: string) {
    this.filesService.open(id, this.file(id)?.name || '').catch(() => this.showError('Error opening file.'));
  }

  private showError(message: string) {
    this.fileError = message;
  }

  getFileExt(id: string): string {
    const name = this.fileName(id);
    return name.includes('.') ? name.split('.').pop()!.toUpperCase() : 'FILE';
  }

  getFileIcon(id: string): string {
    const ext = this.getFileExt(id).toLowerCase();
    const map: Record<string, string> = {
      pdf: 'file-text',
      doc: 'file-text', docx: 'file-text',
      xls: 'file-spreadsheet', xlsx: 'file-spreadsheet', csv: 'file-spreadsheet',
      ppt: 'presentation', pptx: 'presentation',
      jpg: 'file-image', jpeg: 'file-image', png: 'file-image', gif: 'file-image',
      svg: 'file-image', webp: 'file-image',
      mp4: 'file-video-camera', mov: 'file-video-camera', avi: 'file-video-camera',
      mp3: 'file-music', wav: 'file-music',
      zip: 'file-archive', rar: 'file-archive',
      txt: 'file-text', json: 'file-braces',
      py: 'file-code', js: 'file-code', ts: 'file-code', html: 'file-code', css: 'file-code',
    };
    return map[ext] || 'paperclip';
  }
}
