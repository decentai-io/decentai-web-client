import { Component, EventEmitter, Input, Output } from '@angular/core';

import { WorkStep } from 'src/app/services/chat-state.service';

/**
 * A turn's work as one card, between what was asked and the answer: a
 * header that says what is happening or what it came to, and a row for
 * each call or task of the assistant, how it stands, each agent's latest
 * word on its call, and the page's own notes. Open while the work runs,
 * folded to its header once it is over, until the person says otherwise.
 */
@Component({
  selector: 'app-chat-work',
  standalone: false,
  templateUrl: './chat-work.component.html',
  styleUrl: './chat-work.component.css',
})
export class ChatWorkComponent {
  static readonly ICONS: Record<NonNullable<WorkStep['status']>, string> = {
    running: 'loader-circle', done: 'circle-check', failed: 'circle-x', stopped: 'circle-stop',
  };

  @Input() steps: WorkStep[] = [];
  /** The assistant is at work on this turn. */
  @Input() live = false;
  /** Seconds the turn has run, while it runs. */
  @Input() elapsed = 0;
  @Input() stoppingAll = false;
  @Output() stopAll = new EventEmitter<void>();
  /** The calls and tasks a stop of their own is on its way for. */
  @Input() stopping: string[] = [];
  /** Stop one call or task; the rest goes on. */
  @Output() stopOne = new EventEmitter<string>();

  /** What the person opened or shut; otherwise it follows the work. */
  private chosen: boolean | null = null;

  /** The assistant's calls and tasks, not the lines and notes. */
  get tasks(): WorkStep[] {
    return this.steps.filter((step) => step.status);
  }

  get running(): boolean {
    return this.live || this.tasks.some((step) => step.status === 'running');
  }

  get open(): boolean {
    return this.chosen ?? this.running;
  }

  toggleCard(): void {
    this.chosen = !this.open;
  }

  get failed(): number {
    return this.tasks.filter((step) => step.status === 'failed').length;
  }

  /** "Working · 2 running · 12s", or what it came to: "Ran 3 tasks ·
   *  1 failed". */
  get headline(): string {
    if (this.running) {
      const running = this.tasks.filter((step) => step.status === 'running').length;
      return ['Working', running ? `${running} running` : '', this.elapsed >= 3 ? this.duration(this.elapsed) : '']
        .filter(Boolean).join(' · ');
    }
    if (!this.tasks.length) return this.steps[this.steps.length - 1]?.text || 'Nothing ran';
    const count = this.tasks.length;
    return [`Ran ${count} task${count === 1 ? '' : 's'}`, this.failed ? `${this.failed} failed` : '']
      .filter(Boolean).join(' · ');
  }

  icon(step: WorkStep): string {
    return step.status ? ChatWorkComponent.ICONS[step.status] : step.agent ? 'message-square' : 'circle-dot';
  }

  meta(step: WorkStep): string {
    return step.status ? step.status.charAt(0).toUpperCase() + step.status.slice(1) : step.agent || '';
  }

  /** Seconds as a person reads a stopwatch. */
  duration(seconds: number): string {
    if (seconds < 60) return `${Math.round(seconds)}s`;
    return `${Math.floor(seconds / 60)}m ${Math.round(seconds % 60)}s`;
  }
}
