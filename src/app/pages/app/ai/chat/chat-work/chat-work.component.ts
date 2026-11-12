import { Component, EventEmitter, Input, Output } from '@angular/core';

import { WorkItem } from 'src/app/models/chat-protocol';
import { WorkEntry } from 'src/app/services/chat-state.service';
import { KnownFile } from '../chat-message/chat-message.component';

/** A row of the card: a piece of work, as deep as the tasks it is under. */
export interface WorkRow {
  entry: WorkEntry;
  depth: number;
}

/**
 * A turn's work as one card, between what was asked and the answer: a
 * header that says what is happening or what it came to, and a row for
 * each piece of work (a task's own work under it), with how it stands,
 * how long it took, and the agent's latest word or its output's first
 * line. A row opens to the whole story: why it ran, what it was given,
 * what came back (the whole of it a click away), the files it returned,
 * the records it touched, and the card it waited on. Open while the work
 * runs, folded to its header once it is over, until the person says
 * otherwise.
 */
@Component({
  selector: 'app-chat-work',
  standalone: false,
  templateUrl: './chat-work.component.html',
  styleUrl: './chat-work.component.css',
})
export class ChatWorkComponent {
  static readonly STATUS_ICONS: Record<WorkItem['status'], string> = {
    running: 'loader-circle', waiting: 'hourglass', done: 'circle-check', failed: 'circle-x', stopped: 'circle-stop',
    unknown: 'circle-help',
  };
  static readonly KIND_ICONS: Record<string, string> = {
    call: 'bot', mcp: 'server', task: 'list-checks', question: 'circle-question-mark', sleep: 'pause',
    schedule: 'calendar-clock', memory: 'lightbulb', skill: 'sparkles',
  };
  static readonly STATUS_WORDS: Record<WorkItem['status'], string> = {
    running: 'Running', waiting: 'Waiting for you', done: 'Done', failed: 'Failed', stopped: 'Stopped',
    unknown: 'Unknown',
  };

  @Input() work: WorkEntry[] = [];
  /** The assistant is at work on this turn. */
  @Input() live = false;
  /** Seconds the turn has run, while it runs. */
  @Input() elapsed = 0;
  /** The files the page knows of, by id. */
  @Input() files: Record<string, KnownFile> = {};
  @Input() stoppingAll = false;
  @Output() stopAll = new EventEmitter<void>();
  /** The pieces of work a stop of their own is on its way for. */
  @Input() stopping: string[] = [];
  /** Stop one piece of work; the rest goes on. */
  @Output() stopOne = new EventEmitter<string>();
  /** Read a piece of work's whole output. */
  @Output() openOutput = new EventEmitter<WorkEntry>();

  /** What the person opened or shut; otherwise it follows the work. */
  private chosen: boolean | null = null;
  /** The rows opened to their story. */
  readonly opened = new Set<string>();

  get running(): boolean {
    return this.live || this.work.some((entry) => entry.status === 'running');
  }

  get open(): boolean {
    return this.chosen ?? this.running;
  }

  toggleCard(): void {
    this.chosen = !this.open;
  }

  toggleRow(id: string): void {
    if (!this.opened.delete(id)) this.opened.add(id);
  }

  get failed(): number {
    return this.work.filter((entry) => entry.status === 'failed').length;
  }

  /** The rows in order, each task's own work under it. */
  get rows(): WorkRow[] {
    const ids = new Set(this.work.map((entry) => entry.id));
    const rows: WorkRow[] = [];
    const add = (entry: WorkEntry, depth: number): void => {
      rows.push({ entry, depth });
      for (const child of this.work) if (child.thread === entry.id) add(child, depth + 1);
    };
    for (const entry of this.work) if (!entry.thread || !ids.has(entry.thread)) add(entry, 0);
    return rows;
  }

  /** "Working · 2 running · 12s", or what it came to: "Ran 3 steps · 1
   *  failed · 31s". */
  get headline(): string {
    if (this.running) {
      const running = this.work.filter((entry) => entry.status === 'running').length;
      return ['Working', running ? `${running} running` : '', this.elapsed >= 3 ? this.duration(this.elapsed) : '']
        .filter(Boolean).join(' · ');
    }
    const count = this.work.length;
    const began = Math.min(...this.work.map((entry) => Date.parse(entry.started || '') || Infinity));
    const ended = Math.max(...this.work.map((entry) => Date.parse(entry.ended || '') || 0));
    const took = ended > began ? this.duration((ended - began) / 1000) : '';
    return [`Ran ${count} step${count === 1 ? '' : 's'}`, this.failed ? `${this.failed} failed` : '', took]
      .filter(Boolean).join(' · ');
  }

  icon(entry: WorkEntry): string {
    return ChatWorkComponent.KIND_ICONS[entry.kind || ''] ?? 'circle-dot';
  }

  statusIcon(entry: WorkEntry): string {
    return ChatWorkComponent.STATUS_ICONS[entry.status];
  }

  /** How it stands, and how long it took once it ended. */
  meta(entry: WorkEntry): string {
    const took = Date.parse(entry.ended || '') - Date.parse(entry.started || '');
    const words = ChatWorkComponent.STATUS_WORDS[entry.status];
    return took >= 0 && entry.ended ? `${words} · ${this.duration(took / 1000)}` : words;
  }

  /** The line under a row: the agent's latest word while it runs, else
   *  the first of what came back. */
  line(entry: WorkEntry): string {
    return entry.status === 'running' || entry.status === 'waiting' ? entry.line || '' : entry.output?.line || '';
  }

  fileName(id: string): string {
    return this.files[id]?.name || 'A file';
  }

  /** The records its program touched, in words: "read mailbox · created notes". */
  records(entry: WorkEntry): string {
    return (entry.records ?? []).map((record) => `${record.operation} ${record.resource}`.trim()).join(' · ');
  }

  /** Seconds as a person reads a stopwatch. */
  duration(seconds: number): string {
    if (seconds < 60) return `${Math.max(0, Math.round(seconds))}s`;
    return `${Math.floor(seconds / 60)}m ${Math.round(seconds % 60)}s`;
  }
}
