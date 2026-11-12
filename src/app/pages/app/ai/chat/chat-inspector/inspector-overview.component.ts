import { Component, EventEmitter, Input, OnChanges, Output } from '@angular/core';

import { ChatInspection } from 'src/app/models/chat-inspect';
import { Schedule } from 'src/app/services/activity.service';
import { WorkEntry } from 'src/app/services/chat-state.service';
import { cadenceWords, secondsOf, until } from '../../schedules/cadence-words';
import { whatOf } from '../../schedules/schedule-shared';
import {
  ActivityFilter, ActivityRow, InspectorTab, Tile, TokenShare, byAgent, byModel, duration, nextRun, took, tokens,
} from './inspector-words';

/**
 * The chat at a glance: whether it works now and which runtime holds it,
 * its numbers as tiles (each opens the tab that tells the rest), where
 * its tokens went (by model and by agent, each row's share a bar), its
 * newest calls, and its next scheduled run. Stop is here while it works.
 */
@Component({
  selector: 'app-inspector-overview',
  standalone: false,
  templateUrl: './inspector-overview.component.html',
  styleUrls: ['./inspector-shared.css', './inspector-overview.component.css'],
})
export class InspectorOverviewComponent implements OnChanges {
  @Input({ required: true }) inspection!: ChatInspection;
  @Input() working = false;
  @Input() waiting = 0;
  @Input() tiles: Tile[] = [];
  @Input() latest: ActivityRow[] = [];
  @Input() fileNames: Record<string, string> = {};
  @Input() names: Record<string, string> = {};
  @Input() stopping: string[] = [];
  @Input() stoppingAll = false;
  /** The chat's time zone, for its schedules. */
  @Input() zone = '';
  @Output() go = new EventEmitter<{ tab: InspectorTab; filter?: ActivityFilter }>();
  @Output() stopAll = new EventEmitter<void>();
  @Output() stopWork = new EventEmitter<string>();
  @Output() openOutput = new EventEmitter<WorkEntry>();

  /** Where the tokens went: by model, and by agent. */
  models: TokenShare[] = [];
  agents: TokenShare[] = [];
  readonly tokens = tokens;
  readonly duration = duration;

  ngOnChanges(): void {
    this.models = byModel(this.inspection.usage);
    this.agents = byAgent(this.inspection.usage, this.names);
  }

  /** Who holds the chat, and for how long; or who held it last. */
  get holder(): string {
    const { runtime, last_runtime } = this.inspection.chat;
    if (runtime) {
      const held = duration(took(runtime.since, null));
      return held ? `Held by ${runtime.id} for ${held}` : `Held by ${runtime.id}`;
    }
    return last_runtime ? `Last held by ${last_runtime}` : '';
  }

  get next(): Schedule | null {
    return nextRun(this.inspection.schedules.chat);
  }

  what(schedule: Schedule): string {
    return whatOf(schedule, {});
  }

  cadence(schedule: Schedule): string {
    return cadenceWords(schedule.when, this.zone);
  }

  due(schedule: Schedule): string {
    return until(secondsOf(schedule.next_at));
  }
}
