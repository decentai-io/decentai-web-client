import { Choice } from 'src/app/components/ui/radio-keys';
import {
  AccessEffect, AccessFunction, AccessGroup, AccessRow,
} from 'src/app/services/agents.service';

/**
 * Who may use an installed agent, as the Access tab edits it: one row
 * per group, each an effect, every function or some, and the values of
 * the scopes those functions are narrowed by. What the API server keeps
 * is `AccessRow`; this is the same row while it is being changed.
 */

/** A row being changed. `every` is `["*"]`: every function, today's and
 *  those a later version adds. */
export interface AccessDraft {
  /** Stays the same while the row is on the page, for the list's sake. */
  key: number;
  group_id: string;
  effect: AccessEffect;
  every: boolean;
  /** The functions chosen, when not every one. */
  chosen: string[];
  /** Values by scope; a scope without values is not narrowed. */
  scopes: Record<string, string[]>;
}

export const ACCESS_EFFECTS: Choice<AccessEffect>[] = [
  { value: 'allow', name: 'Allow' },
  { value: 'ask', name: 'Ask first' },
  { value: 'deny', name: 'Don\'t allow' },
];

/** What each effect does, in one sentence under the choice. */
export const EFFECT_WORDS: Record<AccessEffect, string> = {
  allow: 'Its people may use these functions in their chats.',
  ask: 'Each call waits for the chat\'s person to say yes, and they may remember the answer.',
  deny: 'Its people may not use these functions, whatever another row or a policy allows.',
};

let drafted = 0;

export function draftOf(row: AccessRow): AccessDraft {
  const every = row.functions.includes('*');
  return {
    key: ++drafted,
    group_id: row.group_id,
    effect: row.effect,
    every,
    chosen: every ? [] : [...row.functions],
    scopes: Object.fromEntries(Object.entries(row.scopes || {}).map(([name, values]) => [name, [...values]])),
  };
}

/** A new row for a group: allowed, every function. */
export function newDraft(groupId: string): AccessDraft {
  return { key: ++drafted, group_id: groupId, effect: 'allow', every: true, chosen: [], scopes: {} };
}

/** The scopes that narrow what a row covers, in the order the agent
 *  declares them: those of every function, or of the ones chosen. A
 *  scope no function of the row is narrowed by is not asked for. */
export function scopesOf<S extends { name: string }>(
  draft: AccessDraft, functions: AccessFunction[], scopes: S[],
): S[] {
  const covered = draft.every ? functions : functions.filter((fn) => draft.chosen.includes(fn.id));
  const used = new Set(covered.flatMap((fn) => fn.scoped_by || []));
  return scopes.filter((scope) => used.has(scope.name));
}

/** The row as the API server keeps it: the chosen functions in the
 *  agent's order, and only the scopes the row covers that have values. */
export function rowOf<S extends { name: string }>(
  draft: AccessDraft, functions: AccessFunction[], scopes: S[],
): AccessRow {
  const narrowed: Record<string, string[]> = {};
  for (const scope of scopesOf(draft, functions, scopes)) {
    const values = [...new Set((draft.scopes[scope.name] || []).map((value) => value.trim()).filter(Boolean))];
    if (values.length) narrowed[scope.name] = values;
  }
  const known = functions.map((fn) => fn.id);
  const chosen = [
    ...known.filter((id) => draft.chosen.includes(id)),
    // A function no longer declared stays as it was: the server says so.
    ...draft.chosen.filter((id) => !known.includes(id)),
  ];
  return {
    group_id: draft.group_id,
    effect: draft.effect,
    functions: draft.every ? ['*'] : chosen,
    ...(Object.keys(narrowed).length ? { scopes: narrowed } : {}),
  };
}

/** What stops the rows from being saved, in words; '' when nothing.
 *  Anything else is the API server's to refuse. */
export function draftProblem(drafts: AccessDraft[], groups: AccessGroup[]): string {
  const empty = drafts.find((draft) => !draft.every && !draft.chosen.length);
  if (!empty) return '';
  const name = groups.find((group) => group.group_id === empty.group_id)?.name || 'A group';
  return `${name}: choose at least one function, or All functions.`;
}

/** "3 people", "1 person"; '' for a group whose count is not given. */
export function membersWords(group: AccessGroup | undefined): string {
  if (!group || typeof group.members !== 'number') return '';
  return `${group.members} ${group.members === 1 ? 'person' : 'people'}`;
}
