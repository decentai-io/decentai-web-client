import { Component, Input, OnInit } from '@angular/core';

import { Choice } from 'src/app/components/ui/radio-keys';
import { MonitoringService, TokenRow } from 'src/app/services/monitoring.service';
import { compact, niceTop } from './activity-overview.component';

/** Tokens added up over some rows. `unpriced` is the tokens of the rows
 *  the catalog has no price for: the cost is of the rest only. */
export interface TokenTotal {
  key: string;
  calls: number;
  input: number;
  output: number;
  /** Read from the prompt cache or written to it. */
  cached: number;
  cost: number;
  unpriced: number;
}

/** The rows added up by what `key` says of each, the most tokens first. */
export function addUp(rows: TokenRow[], key: (row: TokenRow) => string): TokenTotal[] {
  const totals = new Map<string, TokenTotal>();
  for (const row of rows) {
    const name = key(row);
    const total = totals.get(name) ?? { key: name, calls: 0, input: 0, output: 0, cached: 0, cost: 0, unpriced: 0 };
    totals.set(name, total);
    const cached = (row.cache_read ?? 0) + (row.cache_write ?? 0);
    total.calls += row.calls;
    total.input += row.input;
    total.output += row.output;
    total.cached += cached;
    if (row.cost === null) total.unpriced += row.input + row.output + cached;
    else total.cost += row.cost;
  }
  return [...totals.values()].sort((a, b) => b.input + b.output - (a.input + a.output));
}

/** One column of the tokens chart, ready to draw. */
interface Column {
  day: TokenTotal;
  /** Heights, as a share of the chart's top, 0 to 100. */
  inHeight: number;
  outHeight: number;
  label: string;
  tip: string;
}

/**
 * Monitoring's Tokens: what models used over the last days, as runtimes
 * reported it — the organization's (Agents:Monitor:tokens), by model,
 * agent and person, or, with `mine`, the person's own (AI:Usage:mine), by
 * model.
 *
 * Laid out as the Overview is, and in its styles: the numbers first, on
 * one line; then the one chart over the days, with a table view; then the
 * tables. The cost is an estimate everywhere it is said, and says how
 * much of the tokens it could not price.
 */
@Component({
  selector: 'app-token-usage',
  standalone: false,
  templateUrl: './token-usage.component.html',
  styleUrls: ['./activity-overview.component.css', './token-usage.component.css'],
})
export class TokenUsageComponent implements OnInit {
  /** The person's own tokens, rather than the organization's. */
  @Input() mine = false;

  days = 7;
  readonly windows: Choice<number>[] = [
    { value: 1, name: 'Today' },
    { value: 7, name: '7 days' },
    { value: 30, name: '30 days' },
  ];

  rows: TokenRow[] = [];
  loading = true;
  error = '';
  /** The chart as its table: every value, without the colour. */
  asTable = false;

  private static readonly NONE: TokenTotal = { key: '', calls: 0, input: 0, output: 0, cached: 0, cost: 0, unpriced: 0 };

  total = TokenUsageComponent.NONE;
  models: TokenTotal[] = [];
  agents: TokenTotal[] = [];
  people: TokenTotal[] = [];
  top = 0;
  columns: Column[] = [];

  /** People's and agents' names, by id, as the rows give them. */
  private names = new Map<string, string>();

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
    const read = this.mine ? await this.monitoring.mine(this.days) : await this.monitoring.tokens(this.days);
    this.loading = false;
    if (read.error) {
      this.error = read.error;
      return;
    }
    this.take(read.usage);
  }

  private take(rows: TokenRow[]): void {
    this.rows = rows;
    for (const row of rows) {
      if (row.user_id && row.person) this.names.set(row.user_id, row.person);
      if (row.agent && row.agent_name) this.names.set(row.agent, row.agent_name);
    }
    this.total = addUp(rows, () => '')[0] ?? TokenUsageComponent.NONE;
    this.models = addUp(rows, (row) => `${row.provider}\u0000${row.model}`);
    this.agents = addUp(rows.filter((row) => row.agent), (row) => row.agent ?? '');
    this.people = addUp(rows.filter((row) => row.user_id), (row) => row.user_id ?? '');
    const days = addUp(rows, (row) => row.day).sort((a, b) => a.key.localeCompare(b.key));
    this.top = niceTop(Math.max(0, ...days.map((day) => day.input + day.output)));
    const every = days.length > 10 ? 5 : 1;
    this.columns = days.map((day, index) => ({
      day,
      inHeight: this.top ? (day.input / this.top) * 100 : 0,
      outHeight: this.top ? (day.output / this.top) * 100 : 0,
      label: index % every === 0 ? this.dayLabel(day.key) : '',
      tip: [this.dayTitle(day.key), `${(day.input + day.output).toLocaleString()} tokens in ${count(day.calls, 'call')}`,
            `${this.money(day.cost)} estimated`].join('\n'),
    }));
  }

  // ── Words ───────────────────────────────────────────────────────

  /** Whether some of the tokens have no price: the estimate is then of
   *  the rest only, and the tile says so. */
  get partlyPriced(): boolean { return this.total.unpriced > 0; }

  get inWindow(): string {
    return this.days === 1 ? 'today' : `in the last ${this.days} days`;
  }

  dayTitle(day: string): string {
    return new Date(`${day}T00:00:00Z`).toLocaleDateString(undefined, {
      weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC',
    });
  }

  private dayLabel(day: string): string {
    return new Date(`${day}T00:00:00Z`).toLocaleDateString(undefined,
      this.days <= 7 ? { weekday: 'short', timeZone: 'UTC' } : { day: 'numeric', month: 'short', timeZone: 'UTC' });
  }

  /** The model of a row of `models`, and its provider. */
  model(total: TokenTotal): { provider: string; model: string } {
    const [provider, model] = total.key.split('\u0000');
    return { provider, model };
  }

  /** A person's or an agent's name, for a row of `people` or `agents`. */
  name(total: TokenTotal): string {
    return this.names.get(total.key) || total.key;
  }

  number(value: number): string { return compact(value); }

  /** US dollars, as an estimate is said: cents where there are any, and
   *  a fraction of a cent as less than one. */
  money(value: number): string {
    if (!value) return '$0.00';
    if (value < 0.01) return '<$0.01';
    return new Intl.NumberFormat(undefined, {
      style: 'currency', currency: 'USD', maximumFractionDigits: value < 100 ? 2 : 0,
    }).format(value);
  }

  /** A row's cost, or a dash where none of its tokens has a price. */
  rowCost(total: TokenTotal): string {
    return total.unpriced && total.unpriced === total.input + total.output + total.cached ? '—' : this.money(total.cost);
  }

  byDay(_: number, column: Column): string { return column.day.key; }

  get ticks(): number[] {
    return this.top ? [this.top, this.top / 2, 0] : [0];
  }
}

function count(value: number, word: string): string {
  return `${value.toLocaleString()} ${word}${value === 1 ? '' : 's'}`;
}
