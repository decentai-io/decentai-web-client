import { ComponentFixture, TestBed, fakeAsync, flushMicrotasks, tick } from '@angular/core/testing';
import { FormsModule } from '@angular/forms';
import { MatTooltipModule } from '@angular/material/tooltip';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { RouterModule, provideRouter } from '@angular/router';
import {
  Activity, ArrowRight, ArrowRightLeft, Bot, BrainCircuit, CalendarClock, ChevronsLeft, ChevronsRight, CircleDot,
  CircleQuestionMark, CircleStop, CloudOff, Database, File, FileText, Globe, History, Info, KeyRound, Lightbulb,
  ListChecks, LoaderCircle, LucideAngularModule, Paperclip, Pause, PencilLine, Play, Server, ShieldCheck, Sparkles,
  SquareTerminal, Timer, Trash2, X,
} from 'lucide-angular';
import { Subject } from 'rxjs';

import { EmptyComponent } from 'src/app/components/ui/empty.component';
import { FileIconComponent } from 'src/app/components/ui/file-icon.component';
import { SegmentedComponent } from 'src/app/components/ui/segmented.component';
import { ChatInspection, wholeInspection } from 'src/app/models/chat-inspect';
import { ChatEvent, DEFAULT_CHAT_SETTINGS } from 'src/app/models/chat-protocol';
import { ActivityService, Schedule } from 'src/app/services/activity.service';
import { AgentsService } from 'src/app/services/agents.service';
import { AiSessionService } from 'src/app/services/ai-session.service';
import { ChatConnectionService } from 'src/app/services/chat-connection.service';
import { WorkEntry } from 'src/app/services/chat-state.service';
import { ConfirmService } from 'src/app/services/confirm.service';
import { ChatInspectorComponent, REFRESH_MS } from './chat-inspector.component';
import { InspectorActivityComponent } from './inspector-activity.component';
import { InspectorDataComponent } from './inspector-data.component';
import { InspectorOverviewComponent } from './inspector-overview.component';
import { InspectorRunsComponent } from './inspector-runs.component';
import { InspectorSchedulesComponent } from './inspector-schedules.component';
import { InspectorSetupComponent } from './inspector-setup.component';

const ICONS = {
  Activity, ArrowRight, ArrowRightLeft, Bot, BrainCircuit, CalendarClock, ChevronsLeft, ChevronsRight, CircleDot,
  CircleQuestionMark, CircleStop, CloudOff, Database, File, FileText, Globe, History, Info, KeyRound, Lightbulb,
  ListChecks, LoaderCircle, Paperclip, Pause, PencilLine, Play, Server, ShieldCheck, Sparkles, SquareTerminal, Timer,
  Trash2, X,
};

const schedule = (id: string, more: Partial<Schedule> = {}): Schedule => ({
  schedule_id: id, chat_id: 'c1', what: { prompt: 'Sum up my mail' }, when: { cron: '0 9 * * *' },
  next_at: '2026-11-13T09:00:00Z', paused: false, by: 'person', trust: 1, runs: [], ...more,
});

/** What the server holds of the chat's schedule, as the inspector changes it. */
interface Held { paused: boolean; deleted: boolean }

/** An answer of AI:Chat:inspect, as the contract shapes it. */
function sample(held: Held = { paused: false, deleted: false }): ChatInspection {
  return wholeInspection({
    chat: {
      chat_id: 'c1', title: 'Inbox', created_at: '2026-11-12T09:00:00Z', updated_at: '2026-11-12T10:05:00Z',
      settings: DEFAULT_CHAT_SETTINGS, working: true, runtime: { id: 'runtime-cks6o5', since: '2026-11-12T10:00:00Z' },
      last_runtime: null,
    },
    usage: {
      totals: { calls: 2, input: 48200, output: 3100, cache_read: 1000, cache_write: 0, reasoning: 0, latency_ms: 6000 },
      by_model: [
        { provider: 'azure', model: 'gpt-5.6-sol', calls: 2, input: 48200, output: 3100, cache_read: 1000,
          cache_write: 0, reasoning: 0, latency_ms: 6000 },
      ],
      by_agent: [
        { agent: '', calls: 1, input: 40000, output: 3000, latency_ms: 4000 },
        { agent: 'mail', calls: 1, input: 8200, output: 100, latency_ms: 2000 },
      ],
      calls: [
        { at: '2026-11-12T10:04:00Z', agent: '', provider: 'azure', model: 'gpt-5.6-sol', purpose: 'thought',
          input: 40000, output: 3000, cache_read: 1000, cache_write: 0, reasoning: 0, latency_ms: 4000 },
        { at: '2026-11-12T10:00:00Z', agent: '', provider: 'azure', model: 'gpt-5.6-sol', purpose: 'fold',
          input: 8200, output: 100, cache_read: 0, cache_write: 0, reasoning: 0, latency_ms: 2000 },
      ],
    },
    processes: [
      { process: 'p1', agent: 'mail', version: '1.0.1', runtime: 'runtime-cks6o5', sandbox: 'sandbox-a', machine: 'x86_64',
        started_at: '2026-11-12T10:01:00Z', ended_at: null, reason: '', detail: '', memory_peak: 256 * 1024 ** 2,
        cpu_seconds: 2 },
      { process: 'p0', agent: 'web', version: '2.0.0', runtime: 'runtime-cks6o5', sandbox: 'sandbox-b', machine: 'arm64',
        started_at: '2026-11-12T09:30:00Z', ended_at: '2026-11-12T09:31:00Z', reason: 'failed', detail: 'Out of memory',
        memory_peak: null, cpu_seconds: null },
    ],
    network: [
      { agent: 'mail', host: 'graph.microsoft.com', port: 443, connections: 4, refused: 0, bytes_out: 2048,
        bytes_in: 3 * 1024 ** 2, first_at: '2026-11-12T10:01:00Z',
        last_at: new Date(Date.now() - 5 * 60_000).toISOString() },
      { agent: 'web', host: 'evil.example', port: 80, connections: 0, refused: 2, bytes_out: 0, bytes_in: 0,
        first_at: '', last_at: '' },
    ],
    cards: [
      { card_id: 'k2', kind: 'approval', agent: 'mail', call: 'w1', status: 'answered', at: '2026-11-12T10:01:00Z',
        answered_at: '2026-11-12T10:01:30Z', request: { items: [{ id: 'i1', agent: 'mail', function: 'send', name: 'Mail · Send' }] },
        answer: { items: { i1: true } } },
      { card_id: 'k1', kind: 'question', agent: '', call: '', status: 'expired', at: '2026-11-12T09:00:00Z',
        answered_at: null, request: { text: 'Which folder?' }, answer: null },
    ],
    skills: [{ skill_id: 'sk1', name: 'Writing replies', times: 3, last_at: '2026-11-12T10:00:00Z' }],
    mcp: [{ server: 'github', tool: 'create_issue', calls: 2, last_at: '2026-11-12T10:00:00Z' }],
    files: [
      { record_id: 'f1', name: 'brief.pdf', type: 'application/pdf', size: 1300 * 1024, origin: 'attached', agent: '',
        at: '2026-11-12T09:00:00Z' },
      { record_id: 'f2', name: 'reply.txt', type: 'text/plain', size: 120, origin: 'produced', agent: 'mail',
        at: '2026-11-12T10:02:00Z' },
    ],
    records: [
      { kind: 'secret', agent: 'mail', resource: 'login', ref: 's1', label: 'Work mail', operations: { read: 2 },
        last_at: '' },
      { kind: 'data', agent: 'mail', resource: 'notes', ref: 'n1', label: '', operations: { create: 1, update: 2 },
        last_at: '' },
    ],
    schedules: {
      chat: held.deleted ? [] : [schedule('s1', { paused: held.paused })],
      upcoming: [{ ...schedule('s9', { chat_id: 'c2', what: { prompt: 'Weekly report' } }), chat_title: 'Reports' }],
    },
    memories: 4,
  });
}

const work: WorkEntry[] = [
  { id: 'w1', title: 'Mail · Send', status: 'done', kind: 'call', means: { agent: 'mail', function: 'send' },
    started: '2026-11-12T10:01:00Z', ended: '2026-11-12T10:01:12Z', inputs: '{"to":"sam"}',
    output: { size: 900, line: 'Sent to sam', ref: 'o1' }, files: ['f2'] },
  { id: 'w2', title: 'Mail · Archive', status: 'running', kind: 'call', means: { agent: 'mail', function: 'archive' },
    started: '2026-11-12T10:03:00Z' },
];

/** The services the inspector reads, every call recorded. */
function fakes(answer?: () => any) {
  const held: Held = { paused: false, deleted: false };
  const events = new Subject<ChatEvent>();
  const session = {
    inspect: jasmine.createSpy('inspect').and.callFake(async () => (answer ? answer() : { data: sample(held) })),
    peekChats: () => [{ chat_id: 'c2', title: 'Reports' }],
  };
  const activity = {
    schedules: jasmine.createSpy('schedules').and.callFake(async (chatId = '') => ({
      schedules: chatId ? [schedule('s1')] : [schedule('s1'), schedule('s9', { chat_id: 'c2' })],
    })),
    update: jasmine.createSpy('update').and.callFake(async (id: string, changes: any) => {
      held.paused = changes.paused;
      return { schedule: schedule(id, changes) };
    }),
    remove: jasmine.createSpy('remove').and.callFake(async () => {
      held.deleted = true;
      return {};
    }),
  };
  const agents = {
    remembered: jasmine.createSpy('remembered').and.resolveTo([
      { id: 'm1', agent: 'mail', function: 'send', record: '', allowed: true, at: '' },
      { id: 'm2', agent: 'other', function: 'x', record: '', allowed: false, at: '' },
    ]),
    forget: jasmine.createSpy('forget').and.resolveTo({}),
  };
  return { events, session, activity, agents };
}

describe('ChatInspectorComponent', () => {
  let fixture: ComponentFixture<ChatInspectorComponent>;
  let root: HTMLElement;
  let fake: ReturnType<typeof fakes>;

  async function render(answer?: () => any) {
    fake = fakes(answer);
    await TestBed.configureTestingModule({
      declarations: [
        ChatInspectorComponent, InspectorOverviewComponent, InspectorActivityComponent, InspectorDataComponent,
        InspectorRunsComponent, InspectorSchedulesComponent, InspectorSetupComponent,
      ],
      imports: [
        FormsModule, MatTooltipModule, NoopAnimationsModule, RouterModule, LucideAngularModule.pick(ICONS),
        SegmentedComponent, EmptyComponent, FileIconComponent,
      ],
      providers: [
        provideRouter([]),
        { provide: AiSessionService, useValue: fake.session },
        { provide: ActivityService, useValue: fake.activity },
        { provide: AgentsService, useValue: fake.agents },
        { provide: ChatConnectionService, useValue: { events$: fake.events } },
        { provide: ConfirmService, useValue: { ask: async () => true } },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(ChatInspectorComponent);
    fixture.componentRef.setInput('chatId', 'c1');
    fixture.componentRef.setInput('settings', DEFAULT_CHAT_SETTINGS);
    fixture.componentRef.setInput('working', true);
    fixture.componentRef.setInput('work', work);
    fixture.componentRef.setInput('names', { mail: 'Mail', web: 'Web' });
    fixture.componentRef.setInput('agents', [{ agent_id: 'mail', name: 'Mail' }]);
    fixture.componentRef.setInput('model', 'gpt-5.6-sol');
    fixture.componentRef.setInput('files', { f1: { name: 'brief.pdf', type: 'application/pdf', size: 1 } });
    root = fixture.nativeElement;
    await settle();
  }

  async function settle() {
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  afterEach(() => fixture?.destroy());

  const text = (within: Element = root) => within.textContent?.replace(/\s+/g, ' ').trim() ?? '';
  const all = (selector: string) => Array.from(root.querySelectorAll<HTMLElement>(selector));
  const button = (words: string, selector = 'button') => all(selector).find((one) => text(one) === words)!;
  async function open(tab: string) {
    button(tab, '[role="tab"]').click();
    await settle();
  }

  it('shows the chat at a glance: its state, its runtime, its numbers, its newest calls and its next run', async () => {
    await render();
    expect(fake.session.inspect).toHaveBeenCalledOnceWith('c1');
    expect(text(root.querySelector('.ov-status')!)).toContain('Working');
    expect(text(root.querySelector('.ov-status')!)).toContain('Held by runtime-cks6o5');
    // Where the tokens went: by model, and by agent, each row's share a bar.
    const [models, agents] = all('.tok-table');
    expect(Array.from(models.querySelectorAll<HTMLElement>('tbody td')).map((cell) => text(cell)))
      .toEqual(['azure · gpt-5.6-sol', '2', '48.2K', '3,100', '1,000 / 0', '0', '3.0s']);
    expect(Array.from(agents.querySelectorAll<HTMLTableRowElement>('tbody tr')).map((row) => text(row.cells[0])))
      .toEqual(['Assistant', 'Mail']);
    expect(all('.tok-bar > span').map((bar) => bar.style.width)).toEqual(['100%', '84%', '16%']);
    expect(all('.ui-tile-label').map((one) => text(one))).toEqual([
      'Tokens in / out', 'Model calls', 'Agent calls', 'Time working', 'Files', 'Hosts reached · 2 refused',
    ]);
    expect(text(all('.ui-tile-value')[0])).toBe('48.2K / 3,100');
    expect(all('app-inspector-overview .act-toggle').length).toBe(4);
    expect(text(root.querySelector('#ov-next')!.parentElement!)).toContain('Sum up my mail');

    // A tile opens the tab that tells the rest.
    all('.ui-tile')[1].click();
    await settle();
    expect(fixture.componentInstance.tab).toBe('activity');
    expect(all('app-inspector-activity .insp-name').map((one) => text(one)))
      .toEqual(['Thought', 'Summarized the conversation']);
  });

  it('lists every call in Activity, filters them, opens one to its story, and stops one that runs', async () => {
    await render();
    const stopped: string[] = [];
    const outputs: WorkEntry[] = [];
    fixture.componentInstance.stopWork.subscribe((id) => stopped.push(id));
    fixture.componentInstance.openOutput.subscribe((entry) => outputs.push(entry));
    await open('Activity');

    expect(all('.insp-name').map((one) => text(one)))
      .toEqual(['Thought', 'Mail · Archive', 'Mail · Send', 'Summarized the conversation']);
    button('Failed', '.segment').click();
    await settle();
    expect(text(root.querySelector('app-empty')!)).toContain('Nothing failed');
    button('Agents', '.segment').click();
    await settle();

    all('.act-toggle').find((one) => text(one).includes('Mail · Send'))!.click();
    await settle();
    const story = text(root.querySelector('.insp-story')!);
    expect(story).toContain('Sent to sam');
    expect(story).toContain('reply.txt');
    button('Open the whole output').click();
    expect(outputs.map((entry) => entry.id)).toEqual(['w1']);

    (root.querySelector('[aria-label="Stop Mail · Archive"]') as HTMLElement).click();
    expect(stopped).toEqual(['w2']);
  });

  it('shows what the chat touched in Data, never a value', async () => {
    await render();
    await open('Data');
    const words = text();
    expect(words).toContain('brief.pdf');
    expect(words).toContain('Made by Mail');
    expect(words).toContain('Work mail');
    expect(words).toContain('read 2');
    expect(words).toContain('create 1 · update 2');
    expect(words).toContain('Writing replies');
    expect(words).toContain('create_issue');
    expect(words).toContain('4 of your memories go with its prompts');
    expect(all('a.insp-row').map((one) => one.getAttribute('href'))).toContain('/secrets/s1');
  });

  it('shows the runtime, its processes and the network with totals in Runs', async () => {
    await render();
    await open('Runs');
    expect(text(all('.insp-section')[0])).toContain('runtime-cks6o5');
    const processes = all('.insp-section')[1];
    expect(text(processes)).toContain('Mail v1.0.1');
    expect(text(processes)).toContain('peak 256 MB');
    expect(text(processes)).toContain('Running');
    expect(text(processes)).toContain('Out of memory');
    expect(all('tfoot td').map((cell) => text(cell))).toEqual(['All hosts', '4', '2', '2 KB', '3 MB', '']);
    // When each host was last reached; the first and last moments whole in its tooltip.
    expect(all('.runs-last').map((cell) => text(cell))).toEqual(['5 min ago', '—']);
  });

  it('pauses and deletes this chat\'s schedules, and links the next runs of other chats', async () => {
    await render();
    await open('Schedules');
    expect(text()).toContain('Every day at 09:00');
    expect(all('a.sched-chat').map((one) => [text(one), one.getAttribute('href')])).toEqual([['Reports', '/ai/chats/c2']]);

    (root.querySelector('[aria-label="Pause Sum up my mail"]') as HTMLElement).click();
    await settle();
    expect(fake.activity.update).toHaveBeenCalledWith('s1', { paused: true });
    expect(root.querySelector('[aria-label="Resume Sum up my mail"]')).not.toBeNull();
    expect(fake.session.inspect).toHaveBeenCalledTimes(2);

    (root.querySelector('[aria-label="Delete Sum up my mail"]') as HTMLElement).click();
    await settle();
    expect(fake.activity.remove).toHaveBeenCalledWith('s1');
    expect(text(all('.insp-section')[0])).toContain('None.');
  });

  it('changes the setup in place, forgets a decision, and lists what it asked', async () => {
    await render();
    const changed: unknown[] = [];
    fixture.componentInstance.changeSettings.subscribe((one) => changed.push(one));
    await open('Setup');

    button('Trusted', '.segment').click();
    button('Long', '.segment').click();
    expect(changed).toEqual([{ trust: 2 }, { turn_budget: 40 }]);

    // Only the decisions for the agents it uses.
    expect(all('#setup-remembered + .insp-list .insp-name').map((one) => text(one))).toEqual(['Mail · send']);
    button('Forget').click();
    await settle();
    expect(fake.agents.forget).toHaveBeenCalledWith('m1');
    expect(text()).toContain('None for this chat\'s agents.');

    expect(all('.setup-outcome').map((one) => text(one))).toEqual(['Allowed', 'Expired']);
    expect(text()).toContain('Which folder?');
  });

  it('works from what the page knows on a server without the call', async () => {
    await render(() => ({ error: 'No such endpoint.', code: 'not_found' }));
    expect(text()).toContain('This server tells only the live work');
    expect(fake.activity.schedules).toHaveBeenCalledWith('c1');
    expect(all('.ui-tile-label').length).toBe(6);
    // No token breakdown to show: no tables.
    expect(root.querySelector('#ov-tokens')).toBeNull();

    await open('Data');
    expect(text()).toContain('brief.pdf');
    expect(text()).toContain('Made by Mail');
    await open('Schedules');
    expect(text(root.querySelector('a.sched-chat')!)).toBe('Reports');

    // It asks no more for a call the server does not have.
    fake.events.next({ seq: 1, at: '', event: 'idle', data: {} });
    await new Promise((resolve) => setTimeout(resolve, REFRESH_MS + 50));
    expect(fake.session.inspect).toHaveBeenCalledTimes(1);
    expect(fake.activity.schedules).toHaveBeenCalledTimes(4);
  });

  it('says quietly why it could not read the chat, and keeps the rest usable', async () => {
    await render(() => ({ error: 'The server is busy.', code: 'too_many' }));
    expect(text(root.querySelector('.insp-quiet.is-error')!)).toContain('The server is busy.');
    expect(all('.ui-tile').length).toBe(6);
  });
});

describe('ChatInspectorComponent reading again', () => {
  it('reads the chat again a second after the events that change it, once for a burst', fakeAsync(() => {
    const fake = fakes();
    const component = new ChatInspectorComponent(fake.session as any, fake.activity as any,
                                                 { events$: fake.events } as any);
    component.chatId = 'c1';
    component.ngOnInit();
    flushMicrotasks();
    expect(fake.session.inspect).toHaveBeenCalledTimes(1);

    // A call that starts changes nothing the server tells.
    fake.events.next({ seq: 1, at: '', event: 'work', data: { id: 'w', title: '', status: 'running' } });
    tick(REFRESH_MS * 2);
    expect(fake.session.inspect).toHaveBeenCalledTimes(1);

    fake.events.next({ seq: 2, at: '', event: 'work', data: { id: 'w', title: '', status: 'done' } });
    tick(500);
    fake.events.next({ seq: 3, at: '', event: 'idle', data: {} });
    tick(REFRESH_MS - 1);
    expect(fake.session.inspect).toHaveBeenCalledTimes(1);
    tick(1);
    flushMicrotasks();
    expect(fake.session.inspect).toHaveBeenCalledTimes(2);

    component.ngOnDestroy();
    fake.events.next({ seq: 4, at: '', event: 'card_closed', data: { card_id: 'k' } });
    tick(REFRESH_MS * 2);
    expect(fake.session.inspect).toHaveBeenCalledTimes(2);
  }));
});
