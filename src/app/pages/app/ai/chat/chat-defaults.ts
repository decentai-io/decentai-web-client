/**
 * What a chat starts with where nobody chose, said once: the pages that
 * show it (a chat's menu, Chat defaults, a webhook's chat) read it from
 * here.
 */
import { Choice } from 'src/app/components/ui/radio-keys';
import { ChatSettings, DEFAULT_CHAT_SETTINGS } from 'src/app/models/chat-protocol';
import { LlmConnection } from 'src/app/services/settings-llm.service';

/** A chat's trust levels, as a choice: a function runs without asking
 *  when its level is at or below the chat's; each hint says what that
 *  leaves to ask about. Chat defaults and a webhook's chat offer these;
 *  `short` is the name where four must fit side by side. */
export const TRUST_CHOICES = [
  { value: 0, name: 'Ask for every change', short: 'Ask first', hint: 'Reads run; every change asks first.' },
  { value: 1, name: 'Standard', short: 'Standard',
    hint: 'Reads and ordinary changes run; wider changes and outside actions ask first.' },
  { value: 2, name: 'Trusted', short: 'Trusted', hint: 'Everything inside the platform runs; outside actions ask first.' },
  { value: 3, name: 'Autonomous', short: 'Autonomous', hint: 'Everything runs without asking.' },
];

/** How many turns the assistant may take on one message; 0 is no limit. */
export const TURN_BUDGET_CHOICES = [
  { value: 0, name: 'Unlimited', hint: 'Runs until done, or until you stop it.' },
  { value: 20, name: 'Standard', hint: '20 turns' },
  { value: 40, name: 'Long', hint: '40 turns' },
  { value: 100, name: 'Longest', hint: '100 turns' },
];

/** How hard the assistant's model is asked to think; '' is the model's
 *  own default. */
export const EFFORT_CHOICES: { value: ChatSettings['effort']; name: string }[] = [
  { value: '', name: 'Default' },
  { value: 'low', name: 'Low' },
  { value: 'medium', name: 'Medium' },
  { value: 'high', name: 'High' },
];

/** The model a chat thinks with, as two of its settings: a connection
 *  ('' for the organization's default) and one of its models ('' for
 *  the connection's first). */
export type ModelPick = Pick<ChatSettings, 'model' | 'model_id'>;

/** The model a pick means on a connection: the one named while the
 *  connection still offers it, else its first. */
export function modelOf(pick: ModelPick, connection: LlmConnection | undefined): string {
  const models = connection?.models ?? [];
  return models.includes(pick.model_id) ? pick.model_id : models[0] ?? '';
}

/** Every model of these connections as one choice, its value
 *  `<connection>|<model>`, the organization's default first (`|`). A
 *  connection that names no model can't be thought with, so is not one. */
export function modelChoices(connections: LlmConnection[]): Choice<string>[] {
  return [{ value: '|', name: "The organization's default" },
    ...connections.flatMap((connection) => connection.models.map((model) => ({
      value: `${connection.connection_id}|${model}`,
      name: connection.models.length > 1 ? `${connection.name} · ${model}` : connection.name,
    })))];
}

/** A pick as one of those choices' values. */
export function modelValue(pick: ModelPick, connections: LlmConnection[]): string {
  if (!pick.model) return '|';
  return `${pick.model}|${modelOf(pick, connections.find((c) => c.connection_id === pick.model))}`;
}

/** One of those choices' values as a pick. */
export function modelPick(value: string): ModelPick {
  const at = value.indexOf('|');
  return at < 0 ? { model: value, model_id: '' } : { model: value.slice(0, at), model_id: value.slice(at + 1) };
}

/** The settings a person's new chat starts with, from what they kept
 *  (`preferences.chat`): only what is one of a chat's settings, and of
 *  its kind, is taken. A list's kind is null or a list of ids. */
export function chatDefaults(kept: Record<string, unknown> | undefined): Partial<ChatSettings> {
  const chosen: Record<string, unknown> = {};
  for (const [name, standard] of Object.entries(DEFAULT_CHAT_SETTINGS)) {
    const value = kept?.[name];
    const fits = standard === null ? value === null || Array.isArray(value) : typeof value === typeof standard;
    if (value !== undefined && fits) chosen[name] = value;
  }
  return chosen as Partial<ChatSettings>;
}

/**
 * A chat's choice of agents, skills or MCP servers, as a dialog holds it:
 * every one the person may use, now and later (`null`), or those ticked,
 * none included.
 */
export class ListChoice {
  all = true;
  chosen = new Set<string>();

  constructor(value: string[] | null | undefined = null) {
    this.take(value);
  }

  take(value: string[] | null | undefined): void {
    this.all = value == null;
    this.chosen = new Set(value ?? []);
  }

  has(id: string): boolean {
    return this.all || this.chosen.has(id);
  }

  toggle(id: string): void {
    if (!this.chosen.delete(id)) this.chosen.add(id);
  }

  /** All of them, or the ids ticked. Choosing "those ticked" starts from
   *  every one shown, as "all" showed them. */
  setAll(all: boolean, shown: string[]): void {
    if (!all && this.all) this.chosen = new Set(shown);
    this.all = all;
  }

  get value(): string[] | null {
    return this.all ? null : [...this.chosen];
  }
}
