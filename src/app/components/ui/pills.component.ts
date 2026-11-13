import { NgFor, NgIf } from '@angular/common';
import { Component, Input } from '@angular/core';
import { MatTooltipModule } from '@angular/material/tooltip';
import { LucideAngularModule } from 'lucide-angular';

/**
 * A row of names as pills, kept to one line's worth: the first few,
 * then "+N more", which names the rest when pointed at. For what a row
 * lists of its own (a person's groups, a group's policies, a node's
 * labels), however many there are.
 *
 *   <app-pills [items]="groupList(member.groups)" icon="users" none="No groups"></app-pills>
 */
@Component({
  selector: 'app-pills',
  standalone: true,
  imports: [NgFor, NgIf, MatTooltipModule, LucideAngularModule],
  host: { class: 'ui-pills' },
  styles: [':host { display: flex; } :host:empty { display: none; }'],
  template: `<span class="ui-pill" *ngIf="!items.length && none">{{ none }}</span><span
      class="ui-pill" *ngFor="let item of first" [title]="item"><lucide-icon *ngIf="icon" [name]="icon" [size]="12"
      aria-hidden="true"></lucide-icon>{{ item }}</span><span class="ui-pill" *ngIf="rest.length" tabindex="0"
      [matTooltip]="rest.join(', ')" [attr.aria-label]="rest.length + ' more: ' + rest.join(', ')">+{{ rest.length }} more</span>`,
})
export class PillsComponent {
  @Input() items: readonly string[] = [];
  /** A Lucide icon's name for every pill, from app.module.ts's set. */
  @Input() icon = '';
  /** How many are shown before "+N more". */
  @Input() max = 3;
  /** What is said when there is none; nothing when empty. */
  @Input() none = '';

  get first(): readonly string[] {
    return this.items.length > this.max + 1 ? this.items.slice(0, this.max) : this.items;
  }

  get rest(): readonly string[] {
    return this.items.length > this.max + 1 ? this.items.slice(this.max) : [];
  }
}
