import {
  blankCadence, cadenceOf, cadenceProblem, cadenceWords, cronWords, momentIn, upcomingOf, whenOf,
} from './cadence-words';

describe('a cadence in words', () => {
  it('says the common crons as a person would', () => {
    expect(cronWords('0 9 * * 1-5')).toBe('Every weekday at 09:00');
    expect(cronWords('30 17 * * *')).toBe('Every day at 17:30');
    expect(cronWords('0 8 * * 1,3,5')).toBe('Every Mon, Wed and Fri at 08:00');
    expect(cronWords('0 10 * * 0,6')).toBe('Every weekend at 10:00');
    expect(cronWords('*/15 * * * *')).toBe('Every 15 minutes');
    expect(cronWords('0 */2 * * *')).toBe('Every 2 hours');
    expect(cronWords('0 * * * *')).toBe('Every hour');
    expect(cronWords('0 9 1 * *')).toBe('On day 1 of every month at 09:00');
  });

  it('leaves a cron it cannot be sure of as it is written', () => {
    expect(cronWords('0 9 1-7 * 1')).toBe('Custom: 0 9 1-7 * 1');
    expect(cronWords('@daily')).toBe('Custom: @daily');
  });

  it('says a period and a one-off', () => {
    expect(cadenceWords({ every: 7200 })).toBe('Every 2 hours');
    expect(cadenceWords({ every: 3600 })).toBe('Every hour');
    expect(cadenceWords({ cron: '0 9 * * 1-5' })).toBe('Every weekday at 09:00');
    expect(cadenceWords({ at: '2026-10-14T06:00:00+00:00' }, 'UTC')).toContain('Once, ');
  });
});

describe('a cadence as a form', () => {
  it('reads a schedule back into the boxes it was written with', () => {
    expect(cadenceOf({ every: 7200 }, 'UTC')).toEqual(jasmine.objectContaining({ kind: 'every', count: 2, unit: 'hours' }));
    expect(cadenceOf({ cron: '30 17 * * 1-5' }, 'UTC')).toEqual(jasmine.objectContaining({ kind: 'days', days: [1, 2, 3, 4, 5], time: '17:30' }));
    expect(cadenceOf({ cron: '0 9 1 * *' }, 'UTC').kind).toBe('custom');
    // 2026-10-14 06:00 UTC is 09:00 in Riyadh.
    expect(cadenceOf({ at: '2026-10-14T06:00:00+00:00' }, 'Asia/Riyadh'))
      .toEqual(jasmine.objectContaining({ kind: 'once', date: '2026-10-14', time: '09:00' }));
  });

  it('writes what the API server takes, a one-off as the moment the chat\'s zone shows', () => {
    const draft = blankCadence();
    expect(whenOf(draft, 'UTC')).toEqual({ cron: '0 9 * * 1,2,3,4,5' });
    expect(whenOf({ ...draft, days: [0, 1, 2, 3, 4, 5, 6] }, 'UTC')).toEqual({ cron: '0 9 * * *' });
    expect(whenOf({ ...draft, kind: 'every', count: 2, unit: 'hours' }, 'UTC')).toEqual({ every: 7200 });
    expect(whenOf({ ...draft, kind: 'once', date: '2026-10-14', time: '17:00' }, 'Asia/Riyadh'))
      .toEqual({ at: '2026-10-14T14:00:00.000Z' });
  });

  it('says what is wrong before anything is sent', () => {
    const draft = blankCadence();
    const now = Date.UTC(2026, 9, 13, 12, 0);
    expect(cadenceProblem(draft, 'UTC', now)).toBe('');
    expect(cadenceProblem({ ...draft, days: [] }, 'UTC', now)).toBe('Choose at least one day.');
    expect(cadenceProblem({ ...draft, kind: 'every', count: 0 }, 'UTC', now)).toContain('whole number');
    expect(cadenceProblem({ ...draft, kind: 'once', date: '2026-10-13', time: '09:00' }, 'UTC', now)).toBe('That time has passed.');
    expect(cadenceProblem({ ...draft, kind: 'once', date: '2026-10-14', time: '09:00' }, 'UTC', now)).toBe('');
    expect(cadenceProblem({ ...draft, kind: 'custom', cron: '0 9 * *' }, 'UTC', now)).toContain('five parts');
  });

  it('works out the next runs in the schedule\'s own zone', () => {
    // Tuesday 13 October 2026, 12:00 UTC: 15:00 in Riyadh.
    const now = Date.UTC(2026, 9, 13, 12, 0);
    const next = upcomingOf(blankCadence(), 'Asia/Riyadh', 3, now).map((seconds) => new Date(seconds * 1000).toISOString());
    // Weekdays at 09:00 Riyadh is 06:00 UTC: Wed, Thu, Fri.
    expect(next).toEqual(['2026-10-14T06:00:00.000Z', '2026-10-15T06:00:00.000Z', '2026-10-16T06:00:00.000Z']);
    expect(momentIn('Europe/London', 2026, 7, 1, 9, 0)).toBe(Date.UTC(2026, 6, 1, 8, 0));
  });
});
