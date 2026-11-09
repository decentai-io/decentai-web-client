import { Component, Inject, OnInit } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';

import { Skill, SkillsService } from 'src/app/services/skills.service';
import { ListChoice } from '../chat-defaults';

/**
 * Which skills this chat puts in front of the assistant.
 *
 * Not narrowing a set the platform approved: a skill is text the person
 * can already read. What the choice buys is attention: a conversation
 * that carries only what it is about gets better answers than one
 * carrying everything ever written.
 *
 * "All" keeps no list, so skills written later join the chat; otherwise
 * the chat keeps to those ticked, none included.
 */
@Component({
  selector: 'app-chat-skills-dialog',
  standalone: false,
  templateUrl: './chat-skills-dialog.component.html',
  styleUrls: ['./chat-skills-dialog.component.css'],
})
export class ChatSkillsDialogComponent implements OnInit {
  skills: Skill[] = [];
  readonly choice = new ListChoice();
  isLoading = true;
  query = '';

  constructor(
    @Inject(MAT_DIALOG_DATA) public data: { skills: string[] | null; defaults: string[] | null },
    private dialogRef: MatDialogRef<ChatSkillsDialogComponent>,
    private service: SkillsService,
  ) {}

  async ngOnInit(): Promise<void> {
    this.skills = (await this.service.list()).items;
    this.choice.take(this.data.skills);
    this.isLoading = false;
  }

  get visibleSkills(): Skill[] {
    const query = this.query.trim().toLowerCase();
    if (!query) return this.skills;
    return this.skills.filter((skill) => `${skill.name} ${skill.description}`.toLowerCase().includes(query));
  }

  get selectedCount(): number {
    return this.skills.filter((skill) => this.choice.has(skill.id)).length;
  }

  all(all: boolean): void {
    this.choice.setAll(all, this.skills.map((skill) => skill.id));
  }

  save(): void {
    this.dialogRef.close({ skills: this.choice.value });
  }

  reset(): void {
    this.choice.take(this.data.defaults);
  }

  close(): void {
    this.dialogRef.close(null);
  }
}
