/**
 * What a chat starts with where nobody chose, said once: the pages that
 * show it (a chat's menu, Chat defaults, a webhook's chat) read it from
 * here.
 */
import { ChatSettings, DEFAULT_CHAT_SETTINGS } from 'src/app/models/chat-protocol';

/** A chat's trust levels, as a choice: a function runs without asking
 *  when its level is at or below the chat's; each hint says what that
 *  leaves to ask about. Chat defaults and a webhook's chat offer these. */
export const TRUST_CHOICES = [
  { value: 0, name: 'Ask for every change', hint: 'Reads run; every change asks first.' },
  { value: 1, name: 'Standard', hint: 'Reads and ordinary changes run; wider changes and outside actions ask first.' },
  { value: 2, name: 'Trusted', hint: 'Everything inside the platform runs; outside actions ask first.' },
  { value: 3, name: 'Autonomous', hint: 'Everything runs without asking.' },
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
