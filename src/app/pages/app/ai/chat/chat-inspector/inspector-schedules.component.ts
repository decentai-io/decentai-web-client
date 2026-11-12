import { Component, EventEmitter, Input, OnChanges, Output } from '@angular/core';

import { UpcomingRun } from 'src/app/models/chat-inspect';
import { ActivityService, Schedule } from 'src/app/services/activity.service';
import { ConfirmService } from 'src/app/services/confirm.service';
import { cadenceWords, momentWords, secondsOf, until } from '../../schedules/cadence-words';
import { STATE_WORDS, failuresOf, stateOf, whatOf } from '../../schedules/schedule-shared';

/**
 * The chat's schedules, each to pause, resume, open or delete, and what
 * runs next in the person's other chats, each a way to its chat.
 */
@Component({
  selector: 'app-inspector-schedules',
  standalone: false,
  templateUrl: './inspector-schedules.component.html',
  styleUrls: ['./inspector-shared.css'],
})
export class InspectorSchedulesComponent implements OnChanges {
  @Input() schedules: Schedule[] = [];
  @Input() upcoming: UpcomingRun[] = [];
  /** The chat's time zone, for its schedules. */
  @Input() zone = '';
  /** A schedule was paused, resumed or deleted: the chat is read again. */
  @Output() changed = new EventEmitter<void>();

  /** The schedules as shown: changed here at once, before the read again. */
  list: Schedule[] = [];
  readonly busy = new Set<string>();
  error = '';

  constructor(private activity: ActivityService, private confirm: ConfirmService) {}

  ngOnChanges(): void {
    this.list = this.schedules;
  }

  what(schedule: Schedule): string {
    return whatOf(schedule, {});
  }

  /** How often, and when next or how it stands. */
  meta(schedule: Schedule): string {
    const state = stateOf(schedule);
    const next = state === 'active' || state === 'failing' ? `next ${momentWords(secondsOf(schedule.next_at), this.zone)}`
      : STATE_WORDS[state];
    return [cadenceWords(schedule.when, this.zone), next, failuresOf(schedule)].filter(Boolean).join(' · ');
  }

  failing(schedule: Schedule): boolean {
    return stateOf(schedule) === 'failing';
  }

  due(run: UpcomingRun): string {
    return until(secondsOf(run.next_at));
  }

  async setPaused(schedule: Schedule, paused: boolean): Promise<void> {
    await this.act(schedule, async () => {
      const res = await this.activity.update(schedule.schedule_id, { paused });
      if (!res.error && res.schedule) {
        this.list = this.list.map((one) => (one.schedule_id === schedule.schedule_id ? res.schedule : one));
      }
      return res.error;
    });
  }

  async remove(schedule: Schedule): Promise<void> {
    const sure = await this.confirm.ask({
      title: 'Delete this schedule?', body: `“${this.what(schedule)}” will not run again.`, confirm: 'Delete', danger: true,
    });
    if (!sure) return;
    await this.act(schedule, async () => {
      const res = await this.activity.remove(schedule.schedule_id);
      if (!res.error) this.list = this.list.filter((one) => one.schedule_id !== schedule.schedule_id);
      return res.error;
    });
  }

  /** One change at a time for a schedule; what went wrong is said. */
  private async act(schedule: Schedule, change: () => Promise<string | undefined>): Promise<void> {
    if (this.busy.has(schedule.schedule_id)) return;
    this.busy.add(schedule.schedule_id);
    this.error = '';
    try {
      const error = await change();
      if (error) this.error = error;
      else this.changed.emit();
    } finally {
      this.busy.delete(schedule.schedule_id);
    }
  }
}
