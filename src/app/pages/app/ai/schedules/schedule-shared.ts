import { Schedule, ScheduleRun } from 'src/app/services/activity.service';

/**
 * A schedule in the words the list, its page and the form all use: how
 * it stands, what it runs, and how a run of it ended.
 */

export type ScheduleState = 'active' | 'paused' | 'done' | 'failing';

export const STATE_WORDS: Record<ScheduleState, string> = {
  active: 'Active', paused: 'Paused', done: 'Done', failing: 'Failing',
};

/** Newest last, as the API server keeps them. */
export function lastRun(schedule: Schedule): ScheduleRun | null {
  const runs = schedule.runs || [];
  return runs.length ? runs[runs.length - 1] : null;
}

/** How a schedule stands: a one-off with no next run is done; one whose
 *  last run failed is failing for as long as it is on. */
export function stateOf(schedule: Schedule): ScheduleState {
  if (schedule.paused) return 'paused';
  if (!schedule.next_at) return 'done';
  return lastRun(schedule)?.failed ? 'failing' : 'active';
}

/** The function a schedule runs, by the name its agent gave it, or its
 *  id without its agent when that name is not known. */
export function functionLabel(id: string, names: Record<string, string>): string {
  return names[id] || id.split('.').slice(1).join('.') || id;
}

/** What a schedule does: the prompt it wakes the assistant with, or the
 *  function it runs. */
export function whatOf(schedule: Schedule, names: Record<string, string>): string {
  const what = schedule.what;
  return 'prompt' in what ? what.prompt : `Run ${functionLabel(what.function, names)}`;
}

/** "1 of 10 failed"; '' when none did. */
export function failuresOf(schedule: Schedule): string {
  const runs = schedule.runs || [];
  const failed = runs.filter((run) => run.failed).length;
  return failed ? `${failed} of ${runs.length} failed` : '';
}
