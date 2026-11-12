import { Component, EventEmitter, Input, OnChanges, Output } from '@angular/core';

import { clockTime, relativeDate } from 'src/app/components/ui/dates';
import { WorkEntry } from 'src/app/services/chat-state.service';
import { ChatWorkComponent } from '../chat-work/chat-work.component';
import {
  ACTIVITY_FILTERS, ActivityFilter, ActivityRow, agentName, duration, filterActivity, tokens, touchedWords,
} from './inspector-words';

/**
 * Every call the chat made, newest first, as one list: its agents' and
 * MCP servers' calls and its model calls. A row says what, by whom, how
 * long and how much; it opens to the rest: what it was given, what came
 * back (the whole output a click away), its files and records, or a model
 * call's tokens. What still runs can be stopped alone. The Overview shows
 * its newest few the same way, without the filters.
 */
@Component({
  selector: 'app-inspector-activity',
  standalone: false,
  templateUrl: './inspector-activity.component.html',
  styleUrls: ['./inspector-shared.css', './inspector-activity.component.css'],
})
export class InspectorActivityComponent implements OnChanges {
  @Input() rows: ActivityRow[] = [];
  /** The whole list, with its filters and the way to the audit; else a few. */
  @Input() filterable = false;
  @Input() filter: ActivityFilter = 'all';
  @Output() filterChange = new EventEmitter<ActivityFilter>();
  @Input() fileNames: Record<string, string> = {};
  @Input() names: Record<string, string> = {};
  @Input() stopping: string[] = [];
  @Input() chatId = '';
  @Output() stopWork = new EventEmitter<string>();
  @Output() openOutput = new EventEmitter<WorkEntry>();

  readonly filters = ACTIVITY_FILTERS;
  readonly opened = new Set<string>();
  shown: ActivityRow[] = [];

  readonly duration = duration;
  readonly tokens = tokens;
  readonly clockTime = clockTime;
  readonly agentName = agentName;
  readonly touched = touchedWords;

  ngOnChanges(): void {
    this.shown = this.filterable ? filterActivity(this.rows, this.filter) : this.rows;
  }

  setFilter(filter: ActivityFilter): void {
    this.filter = filter;
    this.filterChange.emit(filter);
    this.ngOnChanges();
  }

  toggle(key: string): void {
    if (!this.opened.delete(key)) this.opened.add(key);
  }

  live(row: ActivityRow): boolean {
    return row.status === 'running' || row.status === 'waiting';
  }

  /** The row's first figure: how long it took, or how it stands when that
   *  says more. */
  headline(row: ActivityRow): string {
    if (row.status === 'done') return duration(row.took);
    const word = ChatWorkComponent.STATUS_WORDS[row.status];
    return row.status === 'running' && row.took !== null ? `${word} · ${duration(row.took)}` : word;
  }

  /** Its second: a model call's tokens, else when it began. */
  footnote(row: ActivityRow): string {
    return row.tokens || relativeDate(row.at || null);
  }

  get emptyTitle(): string {
    return this.filter === 'failed' ? 'Nothing failed' : 'No calls yet';
  }
}
