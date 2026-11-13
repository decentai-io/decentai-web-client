import { NgFor, NgIf } from '@angular/common';
import { Component, EventEmitter, Input, Output } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { LucideAngularModule } from 'lucide-angular';

import { AgentMarkComponent } from 'src/app/components/ui/agent-mark.component';
import { AgentChoice } from './secret-shared';

/** Above this many, the list has a search. */
const SEARCH_FROM = 6;

/**
 * The agents that may use a secret, as a checklist: each agent's mark,
 * its name, and the resource of its own it would use the secret as. The
 * one the secret was made for is ticked and stays. A search narrows a
 * long list; what is ticked stays ticked whatever the search shows.
 *
 *   <app-secret-agents [choices]="choices" [(chosen)]="chosen"></app-secret-agents>
 */
@Component({
  selector: 'app-secret-agents',
  standalone: true,
  imports: [NgFor, NgIf, FormsModule, MatCheckboxModule, LucideAngularModule, AgentMarkComponent],
  template: `
    <span class="search-field agents-search" *ngIf="choices.length > searchFrom">
      <lucide-icon name="search" [size]="16" aria-hidden="true"></lucide-icon>
      <input class="input" type="search" placeholder="Search agents" aria-label="Search agents"
             [(ngModel)]="query" [ngModelOptions]="{ standalone: true }" />
    </span>
    <div class="agents-checks" role="group" [attr.aria-label]="label">
      <mat-checkbox class="check-row" *ngFor="let choice of shown; trackBy: byKey"
                    [checked]="choice.own || chosen.includes(choice.key)" [disabled]="choice.own || disabled"
                    (change)="toggle(choice)">
        <span class="agents-row">
          <app-agent-mark size="sm" [name]="choice.name"></app-agent-mark>
          <span class="agents-words">
            <span class="check-name">{{ choice.name }}</span>
            <span class="check-hint">{{ choice.hint }}</span>
          </span>
        </span>
      </mat-checkbox>
    </div>
    <p class="agents-none" *ngIf="!choices.length">No agent you may use takes a secret like this one.</p>
    <p class="agents-none" *ngIf="choices.length && !shown.length">No agent matches.</p>
  `,
  styles: [`
    :host { display: flex; flex-direction: column; gap: 8px; min-width: 0; }
    .agents-search { margin-bottom: 4px; }
    .agents-checks { display: flex; flex-direction: column; }
    .agents-row { display: flex; align-items: center; gap: 10px; min-width: 0; }
    .agents-words { display: flex; flex-direction: column; min-width: 0; }
    .agents-none { color: var(--ink-2); font-size: var(--t-sm); line-height: var(--lh-sm); }
  `],
})
export class SecretAgentsComponent {
  @Input({ required: true }) choices: AgentChoice[] = [];
  /** The keys ticked (`<agent>/<resource>`); the own one may be left out. */
  @Input() chosen: string[] = [];
  @Input() disabled = false;
  /** What the group of boxes is, for a screen reader. */
  @Input() label = 'Agents that may use it';
  @Output() chosenChange = new EventEmitter<string[]>();

  query = '';
  readonly searchFrom = SEARCH_FROM;

  /** The choices the search leaves. */
  get shown(): AgentChoice[] {
    const query = this.query.trim().toLowerCase();
    return query ? this.choices.filter((choice) => `${choice.name} ${choice.hint}`.toLowerCase().includes(query))
      : this.choices;
  }

  byKey(_: number, choice: AgentChoice): string {
    return choice.key;
  }

  toggle(choice: AgentChoice): void {
    if (choice.own) return;
    this.chosen = this.chosen.includes(choice.key)
      ? this.chosen.filter((key) => key !== choice.key) : [...this.chosen, choice.key];
    this.chosenChange.emit(this.chosen);
  }
}
