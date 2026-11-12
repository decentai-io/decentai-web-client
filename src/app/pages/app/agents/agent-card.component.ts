import { NgClass, NgFor, NgIf } from '@angular/common';
import { Component, EventEmitter, Input, OnChanges, Output } from '@angular/core';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatTooltipModule } from '@angular/material/tooltip';
import { RouterLink } from '@angular/router';
import { LucideAngularModule } from 'lucide-angular';

import { AgentMarkComponent, hueOf } from 'src/app/components/ui/agent-mark.component';
import { AgentStat } from './agent-shared';

/** The chip at a card's top right: a word, and the chip's variant
 *  (styles/controls.scss; '' is the plain one). */
export interface CardChip {
  word: string;
  tone: '' | 'danger' | 'live' | 'warn' | 'accent';
}

/** One level's part of a card's level bar (agent-shared `levelBar`). */
export interface CardLevel {
  name: string;
  count: number;
  share: number;
  index: number;
}

/**
 * One agent, as a card: on the Installed page and in the Marketplace
 * alike, so an agent looks the same before it is approved and after.
 *
 *   <app-agent-card name="Notebook" icon="book-open" version="v2.0.9"
 *                   [chip]="standing(agent)" [link]="['/agents', agent.agent_id]"
 *                   description="Your working memory across conversations."
 *                   [stats]="stats" [levels]="levels">
 *     <app-switch cardFoot label="In new chats" …></app-switch>
 *   </app-agent-card>
 *
 * The card wears the hue the agent's name gives its mark: a wash at its
 * head, so a grid of agents reads as so many different things rather than
 * one tile repeated. Under the words, what it counts (`stats`, as small
 * pills with their icons, or `facts` as a line), and a thin bar of how far
 * its functions may go (`levels`). What is marked `cardFoot` is the
 * card's own controls, under a hairline. With `selectable`, a tick box
 * sits at the top left: seen when the card is pointed at or holds the
 * focus, and always once something is ticked (`selecting`) or under a
 * finger.
 */
@Component({
  selector: 'app-agent-card',
  standalone: true,
  imports: [NgClass, NgFor, NgIf, RouterLink, MatCheckboxModule, MatTooltipModule, LucideAngularModule, AgentMarkComponent],
  styleUrls: ['./agent-shared.css', './agent-card.component.css'],
  host: {
    '[class.is-selectable]': 'selectable',
    '[class.is-selected]': 'selected',
    '[class.is-selecting]': 'selecting',
    '[style.--hue]': 'hue',
  },
  template: `
    <mat-checkbox
      *ngIf="selectable"
      class="card-check"
      [checked]="selected"
      [aria-label]="'Select ' + name"
      (change)="selectedChange.emit($event.checked)"
    ></mat-checkbox>

    <a class="card-main" [routerLink]="link">
      <span class="card-head">
        <app-agent-mark [name]="name" [icon]="icon"></app-agent-mark>
        <span class="card-title">
          <span class="card-name">{{ name }}</span>
          <span class="card-version" *ngIf="version">{{ version }}</span>
        </span>
        <span class="chip card-chip" *ngIf="chip" [ngClass]="chip.tone">{{ chip.word }}</span>
      </span>

      <span class="card-description" *ngIf="description">{{ description }}</span>

      <span class="card-stats" *ngIf="stats.length">
        <span class="card-stat" *ngFor="let stat of stats" [matTooltip]="stat.title || ''" [matTooltipDisabled]="!stat.title">
          <lucide-icon [name]="stat.icon" [size]="13" aria-hidden="true"></lucide-icon>{{ stat.text }}
        </span>
      </span>
      <span class="card-facts" *ngIf="!stats.length && facts.length">{{ facts.join(' · ') }}</span>

      <span class="card-levels" *ngIf="levels.length" [matTooltip]="levelWords" role="img" [attr.aria-label]="levelWords">
        <span class="lvl-bar">
          <span class="lvl-bar-part" *ngFor="let level of levels" [attr.data-index]="level.index" [style.flex-grow]="level.count"></span>
        </span>
      </span>
    </a>

    <!-- What went wrong with it, in the words it was reported in. -->
    <p class="card-error" *ngFor="let problem of problems">{{ problem }}</p>

    <div class="card-foot"><ng-content select="[cardFoot]"></ng-content></div>
  `,
})
export class AgentCardComponent implements OnChanges {
  @Input({ required: true }) name = '';
  /** The icon for the mark, when there is one for it. */
  @Input() icon: string | null | undefined = '';
  /** "v2.0.9", said once beside the name. */
  @Input() version = '';
  @Input() chip: CardChip | null = null;
  @Input() description = '';
  /** What a person compares, as pills: how many functions, what it
   *  needs, where it connects. */
  @Input() stats: AgentStat[] = [];
  /** The same as a line of words, where no stats are given. */
  @Input() facts: string[] = [];
  /** Its functions by level, as the parts of a thin bar. */
  @Input() levels: CardLevel[] = [];
  @Input() problems: string[] = [];
  /** Where the card goes: the agent's page, or its review. */
  @Input({ required: true }) link: any[] | string = [];

  @Input() selectable = false;
  @Input() selected = false;
  /** Something on the page is ticked, so every box shows. */
  @Input() selecting = false;
  @Output() selectedChange = new EventEmitter<boolean>();

  hue = hueOf('');
  levelWords = '';

  ngOnChanges(): void {
    this.hue = hueOf(this.name);
    this.levelWords = this.levels.map((level) => `${level.count} ${level.name.toLowerCase()}`).join(' · ');
  }
}
