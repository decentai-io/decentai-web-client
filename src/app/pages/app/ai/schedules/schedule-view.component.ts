import { Component, EventEmitter, Input, OnChanges, Output, SimpleChanges } from '@angular/core';

import { Choice } from 'src/app/components/ui/radio-keys';
import { Schedule, ScheduleRun } from 'src/app/services/activity.service';
import { TRUST_CHOICES } from '../chat/chat-defaults';
import { cadenceWords, momentWords, secondsOf, until } from './cadence-words';
import { STATE_WORDS, ScheduleState, failuresOf, stateOf } from './schedule-shared';

type RunFilter = 'all' | 'failed';

/**
 * One schedule, opened: when it runs and what it does, at reading size;
 * when it runs next; and every run kept, each with the words it ended on.
 *
 * Nothing here changes anything itself: the page owns the doors, and
 * this says which one was asked for.
 */
@Component({
  selector: 'app-schedule-view',
  standalone: false,
  templateUrl: './schedule-view.component.html',
  styleUrls: ['./opened-shared.css', './schedule-view.component.css'],
})
export class ScheduleViewComponent implements OnChanges {
  @Input({ required: true }) schedule!: Schedule;
  /** What it does, in the page's words. */
  @Input() what = '';
  @Input() chatTitle = '';
  /** Its chat's time zone: its times are read in it. */
  @Input() zone = 'UTC';
  /** The clock the page ticks, in seconds: "in 14 h" follows it. */
  @Input() now = Date.now() / 1000;
  /** Everything is stopped: nothing below is about to happen. */
  @Input() stopped = false;
  @Input() canUpdate = false;
  @Input() canDelete = false;
  @Input() busy = false;

  @Output() closed = new EventEmitter<void>();
  @Output() edit = new EventEmitter<void>();
  @Output() setPaused = new EventEmitter<boolean>();
  /** The trust its runs act at, chosen. */
  @Output() setTrust = new EventEmitter<number>();

  readonly trustChoices = TRUST_CHOICES;
  @Output() runNow = new EventEmitter<void>();
  @Output() remove = new EventEmitter<void>();

  cadence = '';
  state: ScheduleState = 'active';
  failures = '';
  /** Newest first: the last run is the one being asked about. */
  runs: ScheduleRun[] = [];
  /** When it runs next, in seconds; 0 when it does not. */
  nextAt = 0;

  runFilter: RunFilter = 'all';
  runFilters: Choice<RunFilter>[] = [];

  ngOnChanges(changes: SimpleChanges): void {
    const schedule = this.schedule;
    this.cadence = cadenceWords(schedule.when, this.zone);
    this.state = stateOf(schedule);
    this.failures = failuresOf(schedule);
    this.runs = [...(schedule.runs || [])].reverse();
    this.nextAt = schedule.paused ? 0 : secondsOf(schedule.next_at);
    const failed = this.runs.filter((run) => run.failed).length;
    this.runFilters = [
      { value: 'all', name: `All ${this.runs.length}` },
      { value: 'failed', name: `Failed ${failed}` },
    ];
    // Another schedule starts with every run shown.
    const before = changes['schedule']?.previousValue as Schedule | undefined;
    if (before?.schedule_id !== schedule.schedule_id) this.runFilter = 'all';
  }

  get stateWord(): string { return STATE_WORDS[this.state]; }

  /** The trust its runs act at, in words; its chat's for one older than trusts. */
  get trustName(): string {
    const trust = this.schedule.trust;
    return trust === null || trust === undefined ? "Its chat's" : TRUST_CHOICES[trust]?.name || `Level ${trust}`;
  }

  get shownRuns(): ScheduleRun[] {
    return this.runFilter === 'failed' ? this.runs.filter((run) => run.failed) : this.runs;
  }

  /** What it runs, as an agent's function: shown with its inputs. */
  get inputs(): string {
    const what = this.schedule.what;
    return 'function' in what && Object.keys(what.inputs || {}).length ? JSON.stringify(what.inputs, null, 2) : '';
  }

  get mark(): string {
    return 'function' in this.schedule.what ? 'zap' : 'bell';
  }

  moment(at: string | number): string {
    return momentWords(typeof at === 'number' ? at : secondsOf(at), this.zone);
  }

  away(seconds: number): string { return until(seconds, this.now); }
}
