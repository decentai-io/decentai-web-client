import { Component, EventEmitter, Input, Output } from '@angular/core';
import { MarkdownService } from 'ngx-markdown';

import { fullDate } from 'src/app/components/ui/dates';
import { headingsDown } from 'src/app/components/ui/markdown-levels';
import { Skill } from 'src/app/services/skills.service';
import { ChatMarkdownService } from '../../ai/chat/chat-message/chat-markdown.service';

/**
 * One skill, read: its name, when it applies, who wrote it and who can
 * use it, and the skill itself as the assistant reads it once it decides
 * the skill applies. Reading is its own view so that seeing a skill
 * never means opening it for change.
 *
 * The text is shown as the chat's own markdown, with what it would load
 * from elsewhere taken out. The page hands the actions in as
 * `skillActions`.
 */
@Component({
  selector: 'app-skill-view',
  standalone: false,
  templateUrl: './skill-view.component.html',
  styleUrl: './skill-view.component.css',
  providers: [{ provide: MarkdownService, useClass: ChatMarkdownService }],
})
export class SkillViewComponent {
  @Input({ required: true }) skill!: Skill;
  /** Who wrote it, in the words the list uses. */
  @Input() author = '';
  /** Who can use it, in the words the list uses. */
  @Input() sharing = '';

  @Output() closed = new EventEmitter<void>();

  /** The skill itself, with its headings under the panel's own. */
  get body(): string {
    return headingsDown(this.skill.text || '', 2);
  }

  get written(): string {
    return fullDate(this.skill.updated_at);
  }
}
