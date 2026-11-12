import { Component, EventEmitter, Input, Output } from '@angular/core';
import * as Prism from 'prismjs';
import 'prismjs/components/prism-python';

import { ChartInput } from 'src/app/components/chart-viewer/chart-viewer.component';
import { ApprovalItem, Card, CardAnswer, FormRequest } from 'src/app/models/chat-protocol';
import { levelLabel } from 'src/app/pages/app/agents/agent-shared';

/** What the person decided on a card. A file question's file is uploaded
 *  by the page before it answers; a form that connects an account is
 *  connected by the page, then answered. */
export interface CardDecision {
  card_id: string;
  answer?: CardAnswer;
  file?: File;
  connect?: boolean;
}

/** One thing a form asks: a field of the secret, or a question of a
 *  `form` field, by where its answer goes. */
interface Asked {
  key: string;
  label: string;
  secret: boolean;
  number: boolean;
  options: string[];
  required: boolean;
  /** A `form` field's question: the field, and the question's name. */
  form?: { field: string; question: string; remember: boolean };
}

/**
 * A card: what a chat asks its person, and only them, answered here.
 *
 * - approval: the calls one step of the assistant needs the person for,
 *   each an item: an agent's call above its run's trust, or one a policy
 *   says to ask, or a person's MCP tool above its trust. The person allows
 *   all, none, or each as ticked; the answers may be remembered for each
 *   agent, function and record.
 * - network: the code an agent wants to run, what it is for, and the
 *   hosts it would reach.
 * - question: what an agent's `chat` expects: words, a choice, or a file.
 * - form: a secret's empty fields, the questions of a site's sign-in, or
 *   an account to connect. What is typed goes into the record, never
 *   onto the card.
 * - skill and memory: what the assistant offers to keep, shown whole as
 *   plain text, and saved only on the person's word.
 */
@Component({
  selector: 'app-chat-approval-card',
  standalone: false,
  templateUrl: './chat-approval-card.component.html',
  styleUrls: ['./chat-approval-card.component.css'],
})
export class ChatApprovalCardComponent {
  @Input() card!: Card;
  /** The name of the agent asking, as a person knows it. */
  @Input() agentName = '';
  /** The answer is on its way. */
  @Input() busy = false;

  @Output() decided = new EventEmitter<CardDecision>();

  /** The person's own words, for a question. */
  reply = '';
  /** An approval's answers are to be remembered. */
  remember = false;
  /** Each item of an approval as ticked, by its id; unset, it is ticked. */
  ticked: Record<string, boolean> = {};
  /** A form's answers, by `Asked.key`. */
  typed: Record<string, string> = {};
  /** Whether the code or the skill is open; unset, it is open. */
  shown: boolean | null = null;
  /** The code last coloured, so a redraw does not colour it again. */
  private coloured = { source: '', html: '' };

  /** The card's request, whatever its kind. */
  get request(): any {
    return this.card?.request || {};
  }

  get who(): string {
    return this.agentName || (this.card?.agent?.startsWith('mcp:') ? 'An MCP tool' : this.card?.agent)
      || 'The assistant';
  }

  // ── Approval ─────────────────────────────────────────────────────────

  get items(): ApprovalItem[] {
    return this.request.items || [];
  }

  /** What the card asks, in a few words. */
  get approvalTitle(): string {
    const items = this.items;
    return items.length === 1 ? `${this.who} asks to run “${this.itemName(items[0])}”`
      : `${this.who} asks to run ${items.length} calls`;
  }

  get tickedCount(): number {
    return this.items.filter((item) => this.ticked[item.id] !== false).length;
  }

  /** Answers may be remembered for agents' calls; an MCP tool's own level
   *  says whether it asks. */
  get rememberable(): boolean {
    return this.items.some((item) => !item.agent.startsWith('mcp:'));
  }

  itemName(item: ApprovalItem): string {
    return item.name || String(item.function || 'an action').replace(/[_-]+/g, ' ');
  }

  /** What a program's call reaches through the runtime, where it reaches a record. */
  callLabel(item: ApprovalItem): string {
    const call = String(item.call || '');
    const [operation, resource] = call.split(':');
    if (!call) return '';
    return resource ? `${operation.replace('record.', '')} a record of ${resource}` : operation;
  }

  levelLabel(item: ApprovalItem): string {
    return levelLabel(item.level) || '';
  }

  /** Every item allowed (true), none (false), or each as ticked (null). */
  decide(all: boolean | null): void {
    const items = Object.fromEntries(this.items.map((item) => [item.id, all ?? this.ticked[item.id] !== false]));
    this.emit({ items, remember: this.remember });
  }

  // ── Network ──────────────────────────────────────────────────────────

  get codeOpen(): boolean {
    return this.shown ?? true;
  }

  /** The code as coloured markup. Prism escapes what it colours, and the
   *  template's own sanitizer reads the result again. */
  get codeHtml(): string {
    const code = String(this.request.code?.text || '');
    if (this.coloured.source !== code) {
      const language = String(this.request.code?.language || '').toLowerCase();
      const grammar = Prism.languages[language];
      this.coloured = { source: code, html: grammar ? Prism.highlight(code, grammar, language) : Prism.util.encode(code) as string };
    }
    return this.coloured.html;
  }

  // ── Question ─────────────────────────────────────────────────────────

  /** A question's table, as rows the table component reads by column. */
  get tableRows(): Record<string, unknown>[] {
    const table = this.request.table;
    return (table?.rows || []).map((row: unknown[]) =>
      Object.fromEntries((table.columns || []).map((column: string, index: number) => [column, row?.[index]])));
  }

  get chartData(): ChartInput | null {
    const chart = this.request.chart;
    return chart ? {
      labels: chart.labels || [],
      datasets: (chart.series || []).map((series: { name: string; values: number[] }) =>
        ({ label: series.name, data: series.values })),
    } : null;
  }

  // ── Form ─────────────────────────────────────────────────────────────

  /** What the form asks: the secret's empty fields, then each question
   *  of a sign-in that has no answer yet. */
  get asked(): Asked[] {
    const form = this.request as FormRequest;
    const fields: Asked[] = (form.fields || []).filter((field) => field.type !== 'form').map((field) => ({
      key: field.name, label: field.label || field.name, secret: field.type === 'secret', number: field.type === 'number',
      options: field.options || [], required: field.required !== false,
    }));
    for (const [field, questions] of Object.entries(form.questions || {})) {
      for (const [question, ask] of Object.entries(questions || {})) {
        if (ask?.value) continue;
        fields.push({
          key: `${field}.${question}`, label: question, secret: ask?.type === 'secret', number: false, options: [], required: true,
          form: { field, question, remember: ask?.remember !== false },
        });
      }
    }
    return fields;
  }

  get formReady(): boolean {
    return this.asked.every((ask) => !ask.required || !!(this.typed[ask.key] || '').trim());
  }

  /** The values the record takes: each field's, and each sign-in's
   *  questions whole, those the agent answered with them. */
  private formValues(): Record<string, unknown> {
    const form = this.request as FormRequest;
    const values: Record<string, unknown> = {};
    for (const ask of this.asked) {
      const typed = this.typed[ask.key];
      if (ask.form || typed === undefined || typed === '') continue;
      values[ask.key] = ask.number ? Number(typed) : typed;
    }
    for (const [field, questions] of Object.entries(form.questions || {})) {
      values[field] = Object.fromEntries(Object.entries(questions || {}).map(([question, ask]) => [question, {
        type: ask.type, remember: ask.remember !== false,
        value: ask.value ?? this.typed[`${field}.${question}`] ?? '',
      }]));
    }
    return values;
  }

  submitForm(): void {
    if (!this.formReady) return;
    this.emit({ values: this.formValues() }, { connect: !!this.request.connect });
    this.typed = {};
  }

  // ── Skill ────────────────────────────────────────────────────────────

  get skillOpen(): boolean {
    return this.shown ?? true;
  }

  // ── Answering ────────────────────────────────────────────────────────

  /** A network card's yes or no. */
  allow(allowed: boolean): void {
    this.emit({ allowed });
  }

  save(save: boolean): void {
    this.emit({ save });
  }

  /** A question left unanswered: the agent hears nothing came. */
  decline(): void {
    this.emit({});
  }

  answerWith(text: string): void {
    const words = String(text || '').trim();
    if (words) this.emit(this.request.expects === 'choice' ? { choice: words } : { text: words });
  }

  /** A file question: the file goes up with the decision, and the page
   *  uploads it before answering with its record id. */
  fileChosen(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input?.files?.[0];
    input.value = '';
    if (file && !this.busy) this.decided.emit({ card_id: this.card.card_id, file });
  }

  private emit(answer: CardAnswer, more: Partial<CardDecision> = {}): void {
    if (!this.busy) this.decided.emit({ card_id: this.card.card_id, answer, ...more });
  }
}
