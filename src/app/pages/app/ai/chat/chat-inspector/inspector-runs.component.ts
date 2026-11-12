import { Component, Input, OnChanges } from '@angular/core';

import { clockTime, fullDate, relativeDate } from 'src/app/components/ui/dates';
import { ChatInspection, ChatProcess, NetworkUse } from 'src/app/models/chat-inspect';
import { bytes } from 'src/app/pages/app/settings/nodes/nodes-words';
import { agentName, duration, took } from './inspector-words';

/** How a process ended, in a word. */
const ENDED: Record<string, string> = {
  idle: 'Idle', stopped: 'Stopped', failed: 'Failed', exited: 'Exited', runtime_gone: 'Runtime gone',
};

/**
 * What ran the chat: the runtime that holds it, the processes its agents
 * ran (where, how long, how they ended, how much they used), and where
 * they reached over the network, with the totals.
 */
@Component({
  selector: 'app-inspector-runs',
  standalone: false,
  templateUrl: './inspector-runs.component.html',
  styleUrls: ['./inspector-shared.css', './inspector-runs.component.css'],
})
export class InspectorRunsComponent implements OnChanges {
  @Input({ required: true }) inspection!: ChatInspection;
  @Input() names: Record<string, string> = {};

  totals = { connections: 0, refused: 0, bytes_out: 0, bytes_in: 0 };
  readonly bytes = bytes;
  readonly relativeDate = relativeDate;

  ngOnChanges(): void {
    this.totals = this.inspection.network.reduce((sum, row) => ({
      connections: sum.connections + row.connections, refused: sum.refused + row.refused,
      bytes_out: sum.bytes_out + row.bytes_out, bytes_in: sum.bytes_in + row.bytes_in,
    }), { connections: 0, refused: 0, bytes_out: 0, bytes_in: 0 });
  }

  get runtime(): { name: string; line: string } {
    const { runtime, last_runtime, working } = this.inspection.chat;
    if (runtime) return { name: runtime.id, line: `Holds it now, for ${duration(took(runtime.since, null)) || 'a moment'}` };
    if (last_runtime) return { name: last_runtime, line: 'Held it last; none holds it now' };
    return { name: 'No runtime', line: working ? 'One is being found' : 'None holds it now' };
  }

  /** When a host was first and last reached, whole, for the tooltip. */
  reached(row: NetworkUse): string {
    return [row.first_at && `First ${fullDate(row.first_at)}`, row.last_at && `Last ${fullDate(row.last_at)}`]
      .filter(Boolean).join(' · ');
  }

  agent(process: ChatProcess | NetworkUse): string {
    return agentName(process.agent, this.names);
  }

  ended(process: ChatProcess): string {
    return process.ended_at ? ENDED[process.reason] ?? (process.reason || 'Ended') : 'Running';
  }

  /** Where, when and for how long, and what it used. */
  facts(process: ChatProcess): string {
    return [
      clockTime(process.started_at), duration(took(process.started_at, process.ended_at)),
      process.memory_peak !== null ? `peak ${bytes(process.memory_peak)}` : '',
      process.cpu_seconds !== null ? `CPU ${duration(process.cpu_seconds * 1000)}` : '',
    ].filter(Boolean).join(' · ');
  }
}
