import { RecordTone } from 'src/app/components/ui/record-row.component';
import { TrailLine } from 'src/app/services/audit.service';

/**
 * The audit trail as it is read, here and in Monitoring's events: the
 * same thing done several times in a row is one row with a count. A page
 * that asks the same question every few seconds would otherwise bury
 * everything else.
 */

/** Lines alike and next to each other, newest first. */
export interface LineGroup {
  /** The newest of them: what the row shows. */
  first: TrailLine;
  lines: TrailLine[];
}

/** How long after its newest line a group still takes another. */
const WITHIN_MS = 60_000;

/** What makes two lines the same thing done again: what, who, in which
 *  chat, and how it ended. */
function sameness(line: TrailLine): string {
  return [line.what, line.who, line.chat_id, line.outcome].join('|');
}

/** Lines newest first, in groups: a line joins the group before it when
 *  it is the same thing, at most a minute older than the group's newest. */
export function groupLines(lines: TrailLine[]): LineGroup[] {
  const groups: LineGroup[] = [];
  for (const line of lines) {
    const last = groups[groups.length - 1];
    const gap = last ? new Date(last.first.at).getTime() - new Date(line.at).getTime() : NaN;
    if (last && sameness(last.first) === sameness(line) && gap >= 0 && gap <= WITHIN_MS) {
      last.lines.push(line);
    } else {
      groups.push({ first: line, lines: [line] });
    }
  }
  return groups;
}

/** The dot of a line: how it ended. */
export function lineTone(line: TrailLine): RecordTone {
  return line.outcome === 'success' ? 'ok' : line.outcome === 'refused' || line.outcome === 'failed' ? 'bad' : 'muted';
}

/** How it ended, in a word, for a reader that does not see the dot. */
export function lineOutcome(line: TrailLine): string {
  return ({ success: 'Succeeded', refused: 'Refused', failed: 'Failed' } as Record<string, string>)[line.outcome]
    ?? line.outcome;
}

/** Who wrote it, as a chip. */
export function lineKind(line: TrailLine): string {
  return ({ person: 'Person', runtime: 'Runtime', webhook: 'Webhook', anyone: 'Not signed in' } as Record<string, string>)[line.kind]
    ?? line.kind;
}

/** The line under the words: why it did not succeed. */
export function lineMore(line: TrailLine): string {
  return line.outcome === 'success' ? '' : [lineOutcome(line), line.reason].filter(Boolean).join(' · ');
}

/** Whether a line has more than its row shows. */
export function lineHasDetails(line: TrailLine): boolean {
  return line.ids.length > 0 || Object.keys(line.details || {}).length > 0;
}
