import { Component, Inject } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';

import { Choice } from 'src/app/components/ui/radio-keys';
import { Chat } from 'src/app/models/chat-protocol';
import {
  ActivityService, SchedulableFunction, Schedule, ScheduleWhat,
} from 'src/app/services/activity.service';
import { AiSessionService } from 'src/app/services/ai-session.service';
import {
  CadenceDraft, CadenceKind, PeriodUnit, WEEK, blankCadence, cadenceOf, cadenceProblem, cronWords,
  momentWords, upcomingOf, whenOf,
} from './cadence-words';

/** What the page hands the dialog. */
export interface ScheduleFormData {
  chats: Chat[];
  /** The schedule whose time is changed; absent to make one. */
  schedule?: Schedule;
  /** The chat a new one starts in, when the list is narrowed to one. */
  chatId?: string;
  /** Functions' names, by `agent.function`. */
  names: Record<string, string>;
}

/** What it closes with when something was saved, and the chat it made
 *  for it, if it made one. */
export interface ScheduleFormResult {
  notice: string;
  schedule: Schedule;
  chat?: Chat;
}

/** One declared input of a function, as a box in the form. */
interface InputBox {
  key: string;
  label: string;
  help: string;
  kind: 'text' | 'number' | 'switch' | 'select' | 'json';
  choices: Choice[];
}

/** The chat every schedule made here goes to unless another is chosen:
 *  made the first time, found by its name after that. */
const HOME_CHAT = 'Schedules';
/** Where this device keeps which chat that is. The assistant may give a
 *  chat a name of its own, so the name alone could lose it. */
const HOME_CHAT_KEY = 'decentai.schedules-chat';

function rememberedHome(): string {
  try {
    return localStorage.getItem(HOME_CHAT_KEY) || '';
  } catch {
    return '';
  }
}
const PROMPT_LIMIT = 4000;

/**
 * A schedule, made, or moved in time: which chat it lives in, what it
 * does (a prompt that wakes the assistant, or an agent's function marked
 * schedulable, run with nobody present, its inputs as a form made from
 * what the function declares), and when — every so often, on days at a
 * time, once, or a cron — with the next runs worked out as the person
 * types, in the chat's time zone.
 *
 * What a schedule does is set when it is made; afterwards only when it
 * runs is changed.
 */
@Component({
  selector: 'app-schedule-form',
  standalone: false,
  templateUrl: './schedule-form.component.html',
  styleUrls: ['./opened-shared.css', './schedule-form.component.css'],
})
export class ScheduleFormComponent {
  readonly editing: Schedule | null;
  readonly week = WEEK;
  readonly promptLimit = PROMPT_LIMIT;

  // ── Which chat ──────────────────────────────────────────────────────
  /** '' is the chat called "Schedules", made when it is first needed. */
  chatId = '';
  chatQuery = '';
  private readonly allChats: Choice[];
  private shownChats: Choice[] = [];
  private shownFor = '';
  /** The chat this form made, to hand back. */
  private made?: Chat;

  // ── What ────────────────────────────────────────────────────────────
  kind: 'prompt' | 'function' = 'prompt';
  prompt = '';
  fn = '';
  /** The functions the chosen chat can schedule. */
  functions: SchedulableFunction[] = [];
  functionChoices: Choice[] = [];
  boxes: InputBox[] = [];
  values: Record<string, any> = {};
  /** The inputs written as JSON instead of box by box. */
  asJson = false;
  inputsText = '{}';

  // ── When ────────────────────────────────────────────────────────────
  cadence: CadenceDraft;
  readonly cadenceKinds: Choice<CadenceKind>[] = [
    { value: 'every', name: 'Every' },
    { value: 'days', name: 'On days' },
    { value: 'once', name: 'Once' },
    { value: 'custom', name: 'Custom' },
  ];
  readonly units: Choice<PeriodUnit>[] = [
    { value: 'minutes', name: 'minutes' },
    { value: 'hours', name: 'hours' },
    { value: 'days', name: 'days' },
  ];

  /** Save was pressed: what is missing is said under its field. */
  tried = false;
  saving = false;
  problem = '';

  constructor(
    @Inject(MAT_DIALOG_DATA) public data: ScheduleFormData,
    private dialogRef: MatDialogRef<ScheduleFormComponent, ScheduleFormResult | null>,
    private service: ActivityService,
    private session: AiSessionService,
  ) {
    const schedule = data.schedule || null;
    this.editing = schedule;

    // The home chat first: by its id once it exists, as an offer to
    // make it until then.
    const remembered = rememberedHome();
    const home = data.chats.find((chat) => chat.chat_id === remembered)
      || data.chats.find((chat) => chat.title === HOME_CHAT);
    this.allChats = [
      home ? { value: home.chat_id, name: home.title, hint: 'Where schedules made here go' }
        : { value: '', name: `A new chat called “${HOME_CHAT}”` },
      ...data.chats.filter((chat) => chat !== home).map((chat) => ({ value: chat.chat_id, name: chat.title || 'Untitled chat' })),
    ];
    this.chatId = schedule?.chat_id || data.chatId || home?.chat_id || '';

    this.cadence = schedule ? cadenceOf(schedule.when, this.zone) : blankCadence();
    // A one-off starts at tomorrow, the same time: a date to change,
    // not an empty box.
    if (!this.cadence.date) {
      this.cadence.date = cadenceOf({ at: new Date(Date.now() + 86400000).toISOString() }, this.zone).date;
    }
    if (!schedule) void this.readFunctions();
  }

  /** The zone the schedule's times are read in: its chat's, or, for the
   *  chat the form will make, this browser's. */
  get zone(): string {
    return this.data.chats.find((chat) => chat.chat_id === this.chatId)?.settings.time_zone
      || AiSessionService.browserTimezone() || 'UTC';
  }

  // ── Which chat ──────────────────────────────────────────────────────

  /** A long list of chats gets a search above it. */
  get manyChats(): boolean { return this.allChats.length > 12; }

  /** The chats the search leaves, the chosen one always among them. */
  get chatChoices(): Choice[] {
    const key = `${this.chatQuery}|${this.chatId}`;
    if (key !== this.shownFor || !this.shownChats.length) {
      const query = this.chatQuery.trim().toLowerCase();
      this.shownFor = key;
      this.shownChats = this.allChats.filter((chat) =>
        !query || chat.value === this.chatId || chat.name.toLowerCase().includes(query));
    }
    return this.shownChats;
  }

  /** What a chat can schedule is of the agents it uses. */
  async readFunctions(): Promise<void> {
    const chatId = this.chatId;
    const offered = chatId ? await this.service.functions(chatId).catch(() => []) : [];
    if (chatId !== this.chatId) return;
    this.functions = offered;
    this.functionChoices = offered.map((fn) => ({ value: fn.function, name: fn.name, hint: fn.function }));
    this.kinds = this.kindsFor(offered.length > 0);
    if (!offered.some((fn) => fn.function === this.fn)) {
      this.fn = '';
      this.boxes = [];
      this.kind = 'prompt';
    }
  }

  kinds = this.kindsFor(false);

  private kindsFor(any: boolean): Choice<'prompt' | 'function'>[] {
    return [
      { value: 'prompt', name: 'Wake the assistant with a prompt', hint: 'It reads the prompt in the chat and does what it says.' },
      {
        value: 'function', name: 'Run a function with nobody present', disabled: !any,
        hint: any ? 'An agent’s function runs by itself; what it finds is written in the chat.'
          : 'No agent this chat uses offers a function that can run on its own.',
      },
    ];
  }

  // ── What ────────────────────────────────────────────────────────────

  get chosenFunction(): SchedulableFunction | null {
    return this.functions.find((fn) => fn.function === this.fn) || null;
  }

  /** The chosen function's inputs as boxes, from the JSON Schema it declares. */
  onFunctionChosen(): void {
    const schema = (this.chosenFunction?.inputs || {}) as { properties?: Record<string, any> };
    const declared = schema.properties || {};
    this.boxes = Object.entries(declared).map(([key, shape]) => {
      const type = String(shape?.type || 'string');
      const options: unknown[] = Array.isArray(shape?.enum) ? shape.enum : [];
      return {
        key,
        label: String(shape?.title || key),
        help: String(shape?.description || ''),
        kind: options.length ? 'select' : type === 'boolean' ? 'switch'
          : type === 'number' || type === 'integer' ? 'number'
          : type === 'string' ? 'text' : 'json',
        choices: options.map((option) => ({ value: String(option), name: String(option) })),
      } as InputBox;
    });
    this.values = {};
    for (const box of this.boxes) {
      const value = declared[box.key]?.default;
      this.values[box.key] = box.kind === 'switch' ? !!value
        : value === undefined || value === null ? ''
        : box.kind === 'json' ? JSON.stringify(value) : value;
    }
    this.asJson = false;
    this.inputsText = JSON.stringify(this.inputsFromBoxes().inputs, null, 2);
  }

  /** The boxes as the function takes them; the first box that does not
   *  read as what it should be is named. */
  private inputsFromBoxes(): { inputs: Record<string, unknown>; problem: string } {
    const inputs: Record<string, unknown> = {};
    for (const box of this.boxes) {
      const value = this.values[box.key];
      if (box.kind === 'switch') { inputs[box.key] = !!value; continue; }
      if (value === '' || value === null || value === undefined) continue;
      if (box.kind === 'number') {
        if (Number.isNaN(Number(value))) return { inputs, problem: `${box.label} must be a number.` };
        inputs[box.key] = Number(value);
      } else if (box.kind === 'json') {
        try { inputs[box.key] = JSON.parse(value); }
        catch { return { inputs, problem: `${box.label} must be valid JSON.` }; }
      } else {
        inputs[box.key] = value;
      }
    }
    return { inputs, problem: '' };
  }

  /** Box by box, or as JSON: each way starts from what the other holds. */
  setAsJson(on: boolean): void {
    if (on) {
      this.inputsText = JSON.stringify(this.inputsFromBoxes().inputs, null, 2);
    } else {
      const held = this.inputsFromText();
      if (held) for (const box of this.boxes) {
        const value = held[box.key];
        this.values[box.key] = box.kind === 'switch' ? !!value
          : value === undefined ? '' : box.kind === 'json' ? JSON.stringify(value) : value;
      }
    }
    this.asJson = on;
  }

  private inputsFromText(): Record<string, unknown> | null {
    try {
      const parsed = JSON.parse(this.inputsText || '{}');
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }

  /** What it does, as the API server takes it. */
  private get what(): ScheduleWhat {
    if (this.kind === 'prompt') return { prompt: this.prompt.trim() };
    return { function: this.fn, inputs: this.asJson ? this.inputsFromText() || {} : this.inputsFromBoxes().inputs };
  }

  get inputsProblem(): string {
    if (this.kind !== 'function' || !this.fn) return '';
    if (this.asJson) return this.inputsFromText() ? '' : 'The inputs must be a JSON object: { "name": value }.';
    return this.inputsFromBoxes().problem;
  }

  get whatProblem(): string {
    if (this.editing) return '';
    if (this.kind === 'prompt') return this.prompt.trim() ? '' : 'Write the prompt the assistant wakes with.';
    return this.fn ? '' : 'Choose the function to run.';
  }

  /** The kind of the schedule being changed, as its mark. */
  get editingMark(): string {
    const what = this.editing?.what;
    return what && 'function' in what ? 'zap' : 'bell';
  }

  /** What an edited schedule does, said as it is. */
  get editingWhat(): string {
    const what = this.editing?.what;
    if (!what) return '';
    return 'prompt' in what ? what.prompt : `Runs ${this.data.names[what.function] || what.function}`;
  }

  // ── When ────────────────────────────────────────────────────────────

  toggleDay(day: number): void {
    const days = this.cadence.days;
    this.cadence.days = days.includes(day) ? days.filter((each) => each !== day) : [...days, day];
  }

  get whenProblem(): string {
    return cadenceProblem(this.cadence, this.zone);
  }

  /** The five parts of the cron being typed, each under its name. */
  get cronParts(): { value: string; name: string }[] {
    const parts = this.cadence.cron.trim().split(/\s+/).filter(Boolean);
    return ['minute', 'hour', 'day of month', 'month', 'day of week']
      .map((name, index) => ({ name, value: parts[index] || '·' }));
  }

  /** What the cadence comes to: the next runs, or the reason there are
   *  none to show. */
  get preview(): string {
    if (this.cadence.kind === 'custom') {
      if (cadenceProblem(this.cadence, this.zone)) return '';
      const words = cronWords(this.cadence.cron);
      return words.startsWith('Custom') ? 'Its next runs are counted when it is saved.'
        : `${words}. Its next runs are counted when it is saved.`;
    }
    if (cadenceProblem(this.cadence, this.zone)) return '';
    const next = upcomingOf(this.cadence, this.zone).map((seconds) => momentWords(seconds, this.zone));
    return next.length ? `Next: ${next.join(' · ')}` : '';
  }

  // ── Saving ──────────────────────────────────────────────────────────

  close(): void {
    if (!this.saving) this.dialogRef.close(null);
  }

  async save(): Promise<void> {
    this.tried = true;
    this.problem = '';
    if (this.whatProblem || this.inputsProblem || this.whenProblem) return;

    this.saving = true;
    try {
      if (this.editing) {
        const result = await this.service.update(this.editing.schedule_id, { when: whenOf(this.cadence, this.zone) });
        if (result.error || !result.schedule) { this.problem = result.error || 'It could not be saved.'; return; }
        this.dialogRef.close({ notice: 'Saved.', schedule: result.schedule });
        return;
      }

      // Everything the form can check is checked before a chat is made
      // for the schedule: a refused form must not leave a chat behind.
      if (!this.chatId && !(await this.makeHome())) return;
      const result = await this.service.create(this.chatId, this.what, whenOf(this.cadence, this.zone));
      if (result.error || !result.schedule) { this.problem = result.error || 'It could not be saved.'; return; }
      this.dialogRef.close({ notice: 'On the clock.', schedule: result.schedule, chat: this.made });
    } finally {
      this.saving = false;
    }
  }

  /** Make the chat called "Schedules", and remember it on this device. */
  private async makeHome(): Promise<boolean> {
    const created = await this.session.createChat(HOME_CHAT);
    const chat = created.data?.chat;
    if (!chat) {
      this.problem = created.error || 'Could not make a chat for it.';
      return false;
    }
    // The chat exists now: a second try goes into it.
    this.made = chat;
    this.data.chats = [...this.data.chats, chat];
    this.allChats[0] = { value: chat.chat_id, name: HOME_CHAT };
    try {
      localStorage.setItem(HOME_CHAT_KEY, chat.chat_id);
    } catch {
      // Without storage it is found by its name, while it keeps it.
    }
    this.shownChats = [];
    this.chatId = chat.chat_id;
    return true;
  }
}
