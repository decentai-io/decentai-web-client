import { Component, Input, OnChanges } from '@angular/core';

import { AgentFunction, Manifest } from 'src/app/services/agents.service';
import { LEVEL_MEANINGS, levelBar, levelLabel, levelMeaning, levelTally } from './agent-shared';

/** One input or output of a function, read from its JSON Schema. */
interface Param {
  name: string;
  type: string;
  required: boolean;
}

/** One function, as a person reads it. */
interface ReadFunction {
  fn: AgentFunction;
  params: Param[];
  returns: Param[];
  /** Which scope each input carries: `notebook from notebook`. */
  scopes: { name: string; from: string; required: boolean }[];
}

/**
 * Everything an agent can be asked to do, from its manifest: how much of
 * each runs without asking, what it takes and returns, what it may call
 * on the runtime, which scopes a policy can narrow it by, and whether a
 * schedule may run it. The same for an installed agent and one under
 * review.
 */
@Component({
  selector: 'app-agent-functions',
  standalone: false,
  templateUrl: './agent-functions.component.html',
  styleUrls: ['./agent-shared.css', './agent-functions.component.css'],
})
export class AgentFunctionsComponent implements OnChanges {
  @Input({ required: true }) manifest!: Manifest;
  /** Every function with what it takes and returns open. */
  @Input() expanded = false;
  /** The level bar and what each level means, above the functions: left
   *  out where the page around says it already. */
  @Input() legend = true;

  functions: ReadFunction[] = [];
  summary: Array<{ name: string; count: number }> = [];
  bar: Array<{ name: string; count: number; share: number; index: number }> = [];
  barWords = '';

  readonly levelLabel = levelLabel;
  readonly meanings = LEVEL_MEANINGS;

  readonly meaningOf = levelMeaning;

  ngOnChanges(): void {
    this.summary = levelTally(this.manifest);
    this.bar = levelBar(this.manifest);
    this.barWords = this.bar.map((level) => `${level.count} ${level.name.toLowerCase()}`).join(', ');
    this.functions = (this.manifest?.functions || []).map((fn) => ({
      fn,
      params: this.paramsOf(fn.inputs),
      returns: this.paramsOf(fn.outputs),
      scopes: Object.entries(fn.authorization || {}).map(([name, source]) => ({
        name, from: String(source?.from_input || ''), required: source?.required !== false,
      })),
    }));
  }

  private paramsOf(schema: any): Param[] {
    const required: string[] = schema?.required || [];
    return Object.entries(schema?.properties || {}).map(([name, property]: [string, any]) => ({
      name, type: String(property?.type || 'any'), required: required.includes(name),
    }));
  }
}
