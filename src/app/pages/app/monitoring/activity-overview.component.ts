import { Component, OnInit } from '@angular/core';

import { Choice } from 'src/app/components/ui/radio-keys';
import { AgentUsage, MonitoringService, SummaryRow } from 'src/app/services/monitoring.service';

/** One thing done, how often, and how it ended. */
export interface WhatDone {
  what: string;
  success: number;
  refused: number;
  failed: number;
  total: number;
}

/** The trail's rows added up by what was done, the most first. */
export function byWhat(rows: SummaryRow[]): WhatDone[] {
  const found = new Map<string, WhatDone>();
  for (const row of rows) {
    const done = found.get(row.what) ?? { what: row.what, success: 0, refused: 0, failed: 0, total: 0 };
    found.set(row.what, done);
    if (row.outcome === 'success' || row.outcome === 'refused' || row.outcome === 'failed') done[row.outcome] += row.count;
    done.total += row.count;
  }
  return [...found.values()].sort((a, b) => b.total - a.total);
}

/**
 * Monitoring's Overview: what happened in the organization over the last
 * days, added up from the audit trail by what was done and how it ended
 * (Agents:Monitor:summary), beside the agents running now
 * (Agents:Monitor:usage).
 *
 * Read the way the dataviz rules ask: the numbers first, as tiles; then
 * one bar list in the accent, with what did not succeed said beside each.
 */
@Component({
  selector: 'app-activity-overview',
  standalone: false,
  templateUrl: './activity-overview.component.html',
  styleUrl: './activity-overview.component.css',
})
export class ActivityOverviewComponent implements OnInit {
  days = 7;
  readonly windows: Choice<number>[] = [
    { value: 1, name: 'Today' },
    { value: 7, name: '7 days' },
    { value: 30, name: '30 days' },
  ];

  done: WhatDone[] = [];
  /** The agents running now; null until a runtime's report is read, or
   *  where it could not be. */
  running: AgentUsage[] | null = null;
  loading = true;
  read = false;
  error = '';

  constructor(private monitoring: MonitoringService) {}

  async ngOnInit(): Promise<void> {
    await this.load();
  }

  async choose(days: number): Promise<void> {
    this.days = days;
    await this.load();
  }

  async load(): Promise<void> {
    this.loading = true;
    this.error = '';
    // What runs now must not hold the rest back: its tile fills in when
    // it is read.
    void this.monitoring.usage().then((usage) => (this.running = usage.error ? null : usage.agents));
    const summary = await this.monitoring.summary(this.days);
    this.loading = false;
    if (summary.error) {
      this.error = summary.error;
      return;
    }
    this.done = byWhat(summary.summary);
    this.read = true;
  }

  // ── The tiles ───────────────────────────────────────────────────

  get total(): number { return this.done.reduce((sum, done) => sum + done.total, 0); }
  get refused(): number { return this.done.reduce((sum, done) => sum + done.refused, 0); }
  get failed(): number { return this.done.reduce((sum, done) => sum + done.failed, 0); }

  get okShare(): string {
    if (!this.total) return '';
    const ok = this.done.reduce((sum, done) => sum + done.success, 0);
    return `${Math.round((ok / this.total) * 100)}% succeeded`;
  }

  get processes(): number {
    return (this.running ?? []).reduce((sum, agent) => sum + agent.processes, 0);
  }

  // ── The bar list ────────────────────────────────────────────────

  share(value: number): number {
    const most = this.done[0]?.total ?? 0;
    return most ? Math.max(2, (value / most) * 100) : 0;
  }

  // ── Words ───────────────────────────────────────────────────────

  number(value: number): string {
    return compact(value);
  }

  get inWindow(): string {
    return this.days === 1 ? 'today' : `in the last ${this.days} days`;
  }
}

/** A top an axis can say: 1, 2 or 5 times a power of ten, at or above
 *  the highest value. */
export function niceTop(highest: number): number {
  if (highest <= 0) return 0;
  const power = 10 ** Math.floor(Math.log10(highest));
  for (const step of [1, 2, 5, 10]) {
    if (step * power >= highest) return step * power;
  }
  return 10 * power;
}

/** 1,284 · 12.9K · 4.2M — proportional figures, as tiles want them. */
export function compact(value: number): string {
  if (Math.abs(value) < 10_000) return value.toLocaleString();
  return new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 }).format(value);
}
