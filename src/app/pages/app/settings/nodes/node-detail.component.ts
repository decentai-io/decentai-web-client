import { NgClass, NgFor, NgIf } from '@angular/common';
import { Clipboard } from '@angular/cdk/clipboard';
import { Component, EventEmitter, Input, Output } from '@angular/core';
import { MatTooltipModule } from '@angular/material/tooltip';
import { LucideAngularModule } from 'lucide-angular';

import { fullDate, relativeDate } from 'src/app/components/ui/dates';
import { ListComponent } from 'src/app/components/ui/list.component';
import { ExecutionNode, NodeSandbox } from 'src/app/services/nodes.service';
import {
  bytes, isShared, nodeLabel, nodeState, plural, sandboxState, scopeName, share, STATE_WORDS,
} from './nodes-words';

/** What a person may do to the runtime open in the detail. */
export interface NodeDetailGrants {
  edit: boolean;
  refuse: boolean;
  allow: boolean;
  forget: boolean;
  drain: boolean;
}

/**
 * One runtime, whole: its name and note, whom it serves, how it stands,
 * the chats it holds, and its sandboxes with their room and the agents
 * they run. It shows; the Nodes page acts — every button here is an
 * event the page answers.
 */
@Component({
  selector: 'app-node-detail',
  standalone: true,
  imports: [NgClass, NgFor, NgIf, ListComponent, MatTooltipModule, LucideAngularModule],
  templateUrl: './node-detail.component.html',
  styleUrl: './node-detail.component.css',
})
export class NodeDetailComponent {
  @Input({ required: true }) node!: ExecutionNode;
  @Input() can: NodeDetailGrants = { edit: false, refuse: false, allow: false, forget: false, drain: false };
  /** What an action is on its way for: the runtime's id, or
   *  `<runtime id>#<sandbox>`. */
  @Input() busy = '';

  @Output() back = new EventEmitter<void>();
  @Output() edit = new EventEmitter<void>();
  @Output() refuse = new EventEmitter<void>();
  @Output() allow = new EventEmitter<void>();
  @Output() forget = new EventEmitter<void>();
  @Output() drain = new EventEmitter<{ sandbox: NodeSandbox; on: boolean }>();
  /** The whole runtime drained, or undone. */
  @Output() drainAll = new EventEmitter<boolean>();

  copied = false;

  readonly bytes = bytes;
  readonly share = share;
  readonly sandboxState = sandboxState;
  readonly relativeDate = relativeDate;
  readonly fullDate = fullDate;

  constructor(private clipboard: Clipboard) {}

  get label(): string { return nodeLabel(this.node); }
  get state() { return nodeState(this.node); }
  get stateWord(): string { return STATE_WORDS[this.state]; }
  get organization(): string { return scopeName(this.node); }
  get shared(): boolean { return isShared(this.node); }

  /** Whether it may be drained now: it is connected, and not refused. */
  get drainable(): boolean {
    return this.can.drain && this.node.live && !this.node.refused;
  }

  get stateLine(): string {
    if (this.node.live) return 'Reporting now';
    return this.node.seen_at ? `Last heard from ${relativeDate(this.node.seen_at).toLowerCase()}` : 'Never heard from';
  }

  get chatsLine(): string {
    const node = this.node;
    if (!node.held_chats && !node.held_elsewhere) {
      return node.live ? 'It holds no chat now.' : 'It holds no chat.';
    }
    const parts = [];
    if (node.held_chats) parts.push(`${plural(node.held_chats, 'chat')} of this organization`);
    if (node.held_elsewhere) parts.push(`${plural(node.held_elsewhere, 'chat')} of other organizations`);
    return `It holds ${parts.join(' and ')}.`;
  }

  get forgetWhy(): string {
    if (this.node.live) return 'A runtime is forgotten once it is not connected: refuse it first.';
    if (this.node.held_chats || this.node.held_elsewhere) return 'It still holds chats: refuse it first.';
    return '';
  }

  /** The organization's agents a sandbox runs, by id. */
  agentsLine(sandbox: NodeSandbox): string {
    return sandbox.agents.join(', ') || 'None';
  }

  memoryTitle(sandbox: NodeSandbox): string {
    const used = share(sandbox.room?.memory_used, sandbox.room?.memory_max);
    return used === null ? '' : `${used}% of its memory`;
  }

  copyId(): void {
    this.copied = this.clipboard.copy(this.node.node_id);
    if (this.copied) setTimeout(() => (this.copied = false), 1600);
  }

  bySandbox(_: number, sandbox: NodeSandbox): string {
    return sandbox.sandbox_id;
  }
}
