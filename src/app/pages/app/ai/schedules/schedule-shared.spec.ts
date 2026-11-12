import { Schedule } from 'src/app/services/activity.service';
import { failuresOf, stateOf, whatOf } from './schedule-shared';

const schedule = (more: Partial<Schedule>): Schedule => ({
  schedule_id: 'sch_1', chat_id: 'chat_1', what: { prompt: 'Send the report' }, when: { cron: '0 9 * * *' },
  next_at: '2026-10-14T09:00:00+00:00', paused: false, by: 'person', trust: 1, runs: [], ...more,
});
const run = (failed: boolean) => ({ at: '2026-10-13T09:00:00+00:00', failed, summary: '' });

describe('a schedule in words', () => {
  it('says how it stands', () => {
    expect(stateOf(schedule({}))).toBe('active');
    expect(stateOf(schedule({ paused: true }))).toBe('paused');
    // A one-off with no next run is done.
    expect(stateOf(schedule({ when: { at: '2026-10-13T09:00:00Z' }, next_at: null }))).toBe('done');
    // Failing is about the last run, and only while it is still on.
    expect(stateOf(schedule({ runs: [run(true), run(false)] }))).toBe('active');
    expect(stateOf(schedule({ runs: [run(false), run(true)] }))).toBe('failing');
    expect(stateOf(schedule({ paused: true, runs: [run(true)] }))).toBe('paused');
  });

  it('says what it does: its prompt, or the function by what its agent calls it', () => {
    expect(whatOf(schedule({}), {})).toBe('Send the report');
    const row = schedule({ what: { function: 'notebook.find', inputs: {} } });
    expect(whatOf(row, { 'notebook.find': 'Find notes' })).toBe('Run Find notes');
    expect(whatOf(row, {})).toBe('Run find');
  });

  it('counts the runs that failed', () => {
    expect(failuresOf(schedule({ runs: [run(true), run(false), run(false)] }))).toBe('1 of 3 failed');
    expect(failuresOf(schedule({ runs: [run(false)] }))).toBe('');
  });
});
