import { Component, Input, OnChanges, SimpleChanges } from '@angular/core';

import { Choice } from 'src/app/components/ui/radio-keys';
import { AgentFunction, Manifest } from 'src/app/services/agents.service';
import { LEVEL_MEANINGS, PERMISSION_LEVELS, levelLabel, levelMeaning } from './agent-shared';

/** One input or output of a function, read from its JSON Schema. */
interface Param {
  name: string;
  type: string;
  required: boolean;
}

/** One function, as a row of the table reads it. */
export interface ReadFunction {
  fn: AgentFunction;
  title: string;
  level: string;
  params: Param[];
  returns: Param[];
  /** Which scope each input carries: `notebook from notebook`. */
  scopes: { name: string; from: string; required: boolean }[];
  /** What a search looks in. */
  words: string;
}

/** A level to show, or every one. */
type LevelFilter = 'all' | `${number}`;

/** How many rows a page of the table holds. */
const PAGE_SIZE = 25;

/**
 * Everything an agent can be asked to do, from its manifest, as one
 * table: each function's name, what it does, how far it may go, which
 * scopes narrow it, whether a schedule may run it, and what it calls on
 * the runtime. A row opens to what it takes and returns. The table is
 * narrowed by level and by a search, and paged when long. The same for
 * an installed agent and one under review.
 */
@Component({
  selector: 'app-agent-functions',
  standalone: false,
  templateUrl: './agent-functions.component.html',
  styleUrls: ['./agent-shared.css', './agent-functions.component.css'],
})
export class AgentFunctionsComponent implements OnChanges {
  @Input({ required: true }) manifest!: Manifest;
  /** Every row open to what it takes and returns. */
  @Input() expanded = false;
  /** The sentence above the table: left out where the page around says
   *  it already. */
  @Input() legend = true;
  /** Shown narrowed to one level (0 to 3) when the page asks. */
  @Input() level: number | null = null;

  functions: ReadFunction[] = [];
  levels: Choice<LevelFilter>[] = [];
  filter: LevelFilter = 'all';
  query = '';
  page = 1;
  readonly pageSize = PAGE_SIZE;
  /** The rows opened, by function id. */
  open = new Set<string>();
  /** The minor columns any function fills. */
  columns = { scopes: false, schedule: false, calls: false };

  readonly meanings = LEVEL_MEANINGS;
  readonly meaningOf = levelMeaning;

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['manifest']) {
      this.functions = (this.manifest?.functions || []).map((fn) => {
        const title = fn.name || fn.id;
        return {
          fn,
          title,
          level: levelLabel(fn.level),
          params: this.paramsOf(fn.inputs),
          returns: this.paramsOf(fn.outputs),
          scopes: Object.entries(fn.authorization || {}).map(([name, source]) => ({
            name, from: String(source?.from_input || ''), required: source?.required !== false,
          })),
          words: `${title} ${fn.id} ${fn.description || ''}`.toLowerCase(),
        };
      });
      const total = this.functions.length;
      this.levels = [
        { value: 'all', name: `All ${total}` },
        ...PERMISSION_LEVELS
          .map((name, index) => ({ name, index, count: this.functions.filter((row) => row.fn.level === index).length }))
          .filter((level) => level.count)
          .map((level) => ({ value: `${level.index}` as LevelFilter, name: `${level.name} ${level.count}` })),
      ];
      // A column no function fills says nothing: it is left out.
      this.columns = {
        scopes: this.functions.some((row) => row.scopes.length),
        schedule: this.functions.some((row) => row.fn.schedulable),
        calls: this.functions.some((row) => row.fn.calls?.length),
      };
      this.open = new Set(this.expanded ? this.functions.map((row) => row.fn.id) : []);
      this.page = 1;
    }
    if (changes['level'] || changes['manifest']) {
      const wanted = this.level === null ? 'all' : `${this.level}`;
      this.filter = this.levels.some((choice) => choice.value === wanted) ? wanted as LevelFilter : 'all';
      this.page = 1;
    }
  }

  private paramsOf(schema: any): Param[] {
    const required: string[] = schema?.required || [];
    return Object.entries(schema?.properties || {}).map(([name, property]: [string, any]) => ({
      name, type: String(property?.type || 'any'), required: required.includes(name),
    }));
  }

  /** The level filter is worth showing only where there is more than one. */
  get filterable(): boolean {
    return this.levels.length > 2;
  }

  /** The functions the level and the search leave. */
  get shown(): ReadFunction[] {
    const query = this.query.trim().toLowerCase();
    return this.functions.filter((row) =>
      (this.filter === 'all' || `${row.fn.level}` === this.filter) && (!query || row.words.includes(query)));
  }

  get paged(): ReadFunction[] {
    const start = (this.page - 1) * this.pageSize;
    return this.shown.slice(start, start + this.pageSize);
  }

  setFilter(filter: LevelFilter): void {
    this.filter = filter;
    this.page = 1;
  }

  search(query: string): void {
    this.query = query;
    this.page = 1;
  }

  showAll(): void {
    this.search('');
    this.setFilter('all');
  }

  isOpen(row: ReadFunction): boolean {
    return this.open.has(row.fn.id);
  }

  toggle(row: ReadFunction): void {
    if (!this.open.delete(row.fn.id)) this.open.add(row.fn.id);
  }

  /** A row has something to open to. */
  hasMore(row: ReadFunction): boolean {
    return !!(row.params.length || row.returns.length || row.fn.calls?.length || row.scopes.length || row.fn.description);
  }

  /** How many columns the table has, for an opened row to span. */
  get columnCount(): number {
    return 4 + Object.values(this.columns).filter(Boolean).length;
  }

  scopeNames(row: ReadFunction): string {
    return row.scopes.map((scope) => scope.name).join(', ');
  }

  byId(_: number, row: ReadFunction): string {
    return row.fn.id;
  }
}
