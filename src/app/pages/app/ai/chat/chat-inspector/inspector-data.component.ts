import { Component, Input } from '@angular/core';

import { relativeDate } from 'src/app/components/ui/dates';
import { sizeLabel } from 'src/app/components/ui/file-types';
import { ChatFile, ChatInspection, RecordUse } from 'src/app/models/chat-inspect';
import { agentName, operationsWords, recordLink } from './inspector-words';

/**
 * What the chat touched: the files attached to it and made by it, the
 * records and secrets its agents read or wrote (names and counts, never
 * a value), the skills it read, the MCP tools it called, and how many of
 * the person's memories go with its prompts.
 */
@Component({
  selector: 'app-inspector-data',
  standalone: false,
  templateUrl: './inspector-data.component.html',
  styleUrls: ['./inspector-shared.css'],
})
export class InspectorDataComponent {
  @Input({ required: true }) inspection!: ChatInspection;
  @Input() names: Record<string, string> = {};

  static readonly RECORD_ICONS: Record<RecordUse['kind'], string> = { secret: 'key-round', data: 'database', file: 'file' };

  readonly relativeDate = relativeDate;
  readonly operations = operationsWords;
  readonly link = recordLink;

  /** Where a file came from, its size and when: "Made by Mail · 1.3 MB". */
  fileMeta(file: ChatFile): string {
    const from = file.origin === 'produced' ? `Made by ${agentName(file.agent, this.names)}` : 'Attached';
    return [from, sizeLabel(file.size), relativeDate(file.at)].filter(Boolean).join(' · ');
  }

  recordIcon(record: RecordUse): string {
    return InspectorDataComponent.RECORD_ICONS[record.kind] ?? 'database';
  }

  recordMeta(record: RecordUse): string {
    return [agentName(record.agent, this.names), record.resource].filter(Boolean).join(' · ');
  }
}
