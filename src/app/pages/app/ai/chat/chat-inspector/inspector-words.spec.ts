import { ChatInspection, ModelCall, wholeInspection } from 'src/app/models/chat-inspect';
import { DEFAULT_CHAT_SETTINGS } from 'src/app/models/chat-protocol';
import { Schedule } from 'src/app/services/activity.service';
import { WorkEntry } from 'src/app/services/chat-state.service';
import {
  activityRows, answerWords, busyTime, byAgent, byModel, cardQuestion, duration, fallbackInspection, filterActivity, isAgentCall,
  nextRun, operationsWords, recordLink, tilesOf, took, upcomingElsewhere,
} from './inspector-words';

const NOW = Date.parse('2026-11-12T10:10:00Z');

const call = (more: Partial<ModelCall> = {}): ModelCall => ({
  at: '2026-11-12T10:00:00Z', agent: '', provider: 'azure', model: 'gpt-5.6-sol', purpose: 'thought',
  input: 48200, output: 3100, cache_read: 0, cache_write: 0, reasoning: 0, latency_ms: 4200, ...more,
});

const schedule = (id: string, more: Partial<Schedule> = {}): Schedule => ({
  schedule_id: id, chat_id: 'c1', what: { prompt: 'Sum up my mail' }, when: { cron: '0 9 * * *' },
  next_at: '2026-11-13T09:00:00Z', paused: false, by: 'person', trust: 1, runs: [], ...more,
});

const work: WorkEntry[] = [
  { id: 'w1', title: 'Mail · Send', status: 'done', kind: 'call', means: { agent: 'mail', function: 'send' },
    started: '2026-11-12T10:01:00Z', ended: '2026-11-12T10:01:12Z', files: ['f2'],
    records: [{ operation: 'read', resource: 'mailbox', ref: 'r1' }, { operation: 'read', resource: 'mailbox', ref: 'r1' }] },
  { id: 'w2', title: 'github · create_issue', status: 'failed', kind: 'mcp', means: { server: 'github', tool: 'create_issue' },
    started: '2026-11-12T10:02:00Z', ended: '2026-11-12T10:02:03Z' },
  { id: 'w3', title: 'Task · Research', status: 'running', kind: 'task', started: '2026-11-12T10:09:00Z' },
];

describe('The inspector in words', () => {
  it('says a length of time as a stopwatch does', () => {
    expect(duration(820)).toBe('820 ms');
    expect(duration(4260)).toBe('4.2s');
    expect(duration(12_900)).toBe('12s');
    expect(duration(72_000)).toBe('1m 12s');
    expect(duration(2 * 3600_000 + 5 * 60_000)).toBe('2h 5m');
    expect(duration(null)).toBe('');
    expect(duration(-1)).toBe('');
  });

  it('counts how long something took, to now while it runs', () => {
    expect(took('2026-11-12T10:00:00Z', '2026-11-12T10:00:09Z')).toBe(9000);
    expect(took('2026-11-12T10:09:00Z', null, NOW)).toBe(60_000);
    expect(took('', null, NOW)).toBeNull();
  });

  it('counts time at work once where calls overlap', () => {
    expect(busyTime([[0, 10], [5, 15], [20, 25], [21, 22], [30, 30]])).toBe(20);
    expect(busyTime([])).toBe(0);
  });

  it('counts an agent\'s function and an MCP tool as agent calls, nothing else', () => {
    expect(work.map(isAgentCall)).toEqual([true, true, false]);
    expect(isAgentCall({ id: 'x', title: '', status: 'done', means: { agent: 'mail' } })).toBeTrue();
  });

  it('merges the work and the model calls into one list, newest first, and filters it', () => {
    const rows = activityRows(work, [call(), call({ at: '2026-11-12T10:05:00Z', purpose: 'agent', agent: 'mail' })],
                              { mail: 'Mail' }, NOW);
    expect(rows.map((row) => row.title)).toEqual([
      'Task · Research', 'Mail asked its model', 'github · create_issue', 'Mail · Send', 'Thought',
    ]);
    expect(rows[0].took).toBe(60_000);
    expect(rows[3].by).toBe('Mail · send');
    expect(rows[2].by).toBe('github · create_issue');
    expect(rows[4].tokens).toBe('48.2K in · 3,100 out');

    expect(filterActivity(rows, 'model').length).toBe(2);
    expect(filterActivity(rows, 'agents').map((row) => row.work?.id)).toEqual(['w2', 'w1']);
    expect(filterActivity(rows, 'failed').map((row) => row.work?.id)).toEqual(['w2']);
    expect(filterActivity(rows, 'all')).toBe(rows);
  });

  it('puts the chat\'s numbers on tiles, each leading to the tab that tells the rest', () => {
    const inspection = wholeInspection({
      usage: { totals: { calls: 14, input: 48200, output: 3100, cache_read: 0, cache_write: 0, reasoning: 0, latency_ms: 0 },
               by_model: [], by_agent: [], calls: [call()] },
      files: [{ record_id: 'f1', name: 'a.pdf', type: '', size: 1, origin: 'attached', agent: '', at: '' }],
      network: [
        { agent: 'mail', host: 'graph.microsoft.com', port: 443, connections: 3, refused: 0, bytes_out: 1, bytes_in: 2,
          first_at: '', last_at: '' },
        { agent: 'web', host: 'graph.microsoft.com', port: 80, connections: 1, refused: 2, bytes_out: 0, bytes_in: 0,
          first_at: '', last_at: '' },
      ],
    });
    const tiles = tilesOf(inspection, work, NOW);
    expect(tiles.map((tile) => [tile.label, tile.value])).toEqual([
      ['Tokens in / out', '48.2K / 3,100'],
      ['Model calls', '14'],
      ['Agent calls · 1 failed', '2'],
      // 4.2 s thinking, 12 s and 3 s of calls, the task's last minute.
      ['Time working', '1m 19s'],
      ['Files', '1'],
      ['Hosts reached · 2 refused', '1'],
    ]);
    expect(tiles[2]).toEqual(jasmine.objectContaining({ tab: 'activity', filter: 'failed', warn: true }));
  });

  it('breaks the tokens down by model and by agent, each row with its share, the largest first', () => {
    const usage = wholeInspection({ usage: {
      totals: { calls: 0, input: 0, output: 0, cache_read: 0, cache_write: 0, reasoning: 0, latency_ms: 0 },
      by_model: [
        { provider: 'azure', model: 'mini', calls: 1, input: 100, output: 50, cache_read: 0, cache_write: 0, reasoning: 0,
          latency_ms: 900 },
        { provider: 'azure', model: 'gpt-5.6-sol', calls: 4, input: 600, output: 250, cache_read: 300, cache_write: 20,
          reasoning: 40, latency_ms: 10_000 },
      ],
      by_agent: [
        { agent: 'mail', calls: 1, input: 10, output: 0, latency_ms: 0 },
        { agent: '', calls: 2, input: 30, output: 0, latency_ms: 0 },
      ],
      calls: [],
    } }).usage;
    expect(byModel(usage).map((row) => [row.name, row.share, row.latency, row.cache_read, row.reasoning])).toEqual([
      ['azure · gpt-5.6-sol', 85, 2500, 300, 40], ['azure · mini', 15, 900, 0, 0],
    ]);
    expect(byAgent(usage, { mail: 'Mail' }).map((row) => [row.name, row.share, row.calls]))
      .toEqual([['Assistant', 75, 2], ['Mail', 25, 1]]);
    expect(byModel(wholeInspection({}).usage)).toEqual([]);
  });

  it('finds the next run: the soonest that is on', () => {
    expect(nextRun([
      schedule('a', { next_at: '2026-11-14T09:00:00Z' }),
      schedule('b', { paused: true, next_at: '2026-11-12T11:00:00Z' }),
      schedule('c', { next_at: '2026-11-13T09:00:00Z' }),
      schedule('d', { next_at: null }),
    ])?.schedule_id).toBe('c');
    expect(nextRun([])).toBeNull();
  });

  it('says how a record was used, and where it opens', () => {
    expect(operationsWords({ update: 1, read: 3 })).toBe('read 3 · update 1');
    const record = { kind: 'data' as const, agent: 'mail', resource: 'notes', ref: 'r1', label: '', operations: {}, last_at: '' };
    expect(recordLink(record)).toEqual(['/data/records', 'mail', 'notes', 'r1']);
    expect(recordLink({ ...record, kind: 'secret' })).toEqual(['/secrets', 'r1']);
    expect(recordLink({ ...record, kind: 'file' })).toEqual(['/data/files', 'r1']);
  });

  it('says what a card asked and how it was answered', () => {
    const names = { mail: 'Mail' };
    expect(cardQuestion({ kind: 'approval', agent: 'mail', request: { items: [
      { agent: 'mail', function: 'send' }, { name: 'Mail · Delete' }, { name: 'Mail · Move' },
    ] } }, names)).toBe('Mail · send, Mail · Delete and 1 more');
    expect(cardQuestion({ kind: 'network', agent: 'web', request: { hosts: ['a.com', 'b.com'] } }, names))
      .toBe('Reach a.com, b.com');
    expect(cardQuestion({ kind: 'memory', agent: '', request: { text: 'Likes tea' } }, names)).toBe('Remember: Likes tea');

    expect(answerWords({ items: { a: true, b: true } })).toBe('Allowed');
    expect(answerWords({ items: { a: true, b: false, c: false } })).toBe('1 of 3 allowed');
    expect(answerWords({ items: { a: false } })).toBe('Declined');
    expect(answerWords({ allowed: false })).toBe('Declined');
    expect(answerWords({ save: true })).toBe('Kept');
    expect(answerWords({ text: 'yes' })).toBe('“yes”');
    expect(answerWords({})).toBe('Declined');
    expect(answerWords(null)).toBe('');
  });

  it('tells what the page knows on its own, for a server without the call', () => {
    const inspection: ChatInspection = fallbackInspection(
      { chat_id: 'c1', settings: DEFAULT_CHAT_SETTINGS, working: true }, work,
      { f1: { name: 'brief.pdf', type: 'application/pdf', size: 1200 }, f2: { name: 'reply.txt' } },
      [schedule('a')], [],
    );
    expect(inspection.files.map((file) => [file.name, file.origin, file.agent])).toEqual([
      ['brief.pdf', 'attached', ''], ['reply.txt', 'produced', 'mail'],
    ]);
    expect(inspection.records).toEqual([jasmine.objectContaining({
      agent: 'mail', resource: 'mailbox', ref: 'r1', operations: { read: 2 }, last_at: '2026-11-12T10:01:12Z' })]);
    expect(inspection.mcp).toEqual([jasmine.objectContaining({ server: 'github', tool: 'create_issue', calls: 1 })]);
    expect(inspection.usage.calls).toEqual([]);
    expect(inspection.processes).toEqual([]);
    expect(inspection.schedules.chat.length).toBe(1);
    expect(inspection.chat.working).toBeTrue();
  });

  it('lists the next runs of the person\'s other chats, soonest first, with their titles', () => {
    const all = [
      schedule('mine'),
      schedule('later', { chat_id: 'c2', next_at: '2026-11-15T09:00:00Z' }),
      schedule('sooner', { chat_id: 'c3', next_at: '2026-11-12T12:00:00Z' }),
      schedule('paused', { chat_id: 'c2', paused: true }),
    ];
    expect(upcomingElsewhere(all, 'c1', { c2: 'Mail digest' }).map((run) => [run.schedule_id, run.chat_title]))
      .toEqual([['sooner', ''], ['later', 'Mail digest']]);
  });

  it('makes an answer whole, whatever it left out', () => {
    const whole = wholeInspection({ memories: 3 } as any);
    expect(whole.usage.totals.input).toBe(0);
    expect(whole.usage.calls).toEqual([]);
    expect(whole.schedules).toEqual({ chat: [], upcoming: [] });
    expect(whole.memories).toBe(3);
    expect(whole.chat.runtime).toBeNull();
  });
});
