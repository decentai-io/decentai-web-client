import { Component, ElementRef, HostListener, OnInit, ViewChild } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { MarkdownService } from 'ngx-markdown';

import { Draft } from 'src/app/components/ui/draft';
import { headingsDown } from 'src/app/components/ui/markdown-levels';
import { Choice } from 'src/app/components/ui/radio-keys';
import { HasUnsavedChanges } from 'src/app/guards/unsaved-changes.guard';
import { AuthService } from 'src/app/services/auth.service';
import { ConfirmService } from 'src/app/services/confirm.service';
import { ProfileService } from 'src/app/services/profile.service';
import { Skill, SkillFields, SkillsService } from 'src/app/services/skills.service';
import { ChatMarkdownService } from '../../ai/chat/chat-message/chat-markdown.service';
import { ShareEditor } from '../../share-editor';

/** What the writing area's toolbar can do to the selection. */
type Mark = 'bold' | 'italic' | 'heading' | 'list' | 'numbered' | 'code' | 'link';

/** The same limits the API server holds a skill to. */
export const SKILL_LIMITS = { name: 100, description: 500, text: 20000 };

const EXAMPLE: SkillFields = {
  name: 'Clear, useful writing',
  description: 'Use when drafting or revising professional messages, explanations, and updates',
  text: `Write in plain, direct language.

- Lead with the main point or requested action.
- Keep each paragraph focused on one idea.
- Prefer concrete verbs and familiar words.
- Include only context the reader needs to decide or act.
- Put steps in the order they should happen.
- Match the reader's level of technical knowledge.
- End with the next action, owner, or decision when needed.

Before sending, remove repetition and vague filler. Preserve important facts, constraints, dates, and names.`,
};

/**
 * Writing a skill, or changing one: a page of its own, at
 * /data/skills/new and /data/skills/<id>/edit, so that what is being
 * written is not lost to a click outside a dialog.
 *
 * A skill is a name, a description saying when it applies, and the
 * skill itself. The assistant sees the first two for every skill and
 * reads the third only once it decides the skill applies, which is why
 * the description matters and the page says so. The skill itself is
 * written as markdown, with a preview of how it reads.
 *
 * Nothing is saved until Save. Leaving with changes asks first (the
 * route names the guard), and so does reloading the tab. Who can use it
 * is saved after the skill, by a call of its own.
 */
@Component({
  selector: 'app-skill-editor',
  standalone: false,
  templateUrl: './skill-editor.component.html',
  styleUrl: './skill-editor.component.css',
  // The preview is the chat's markdown, as the reading view's is.
  providers: [{ provide: MarkdownService, useClass: ChatMarkdownService }],
})
export class SkillEditorComponent implements OnInit, HasUnsavedChanges {
  /** The skill being changed; '' while one is being written. */
  ref = '';
  loading = true;
  /** Why the skill to change could not be opened. */
  problem = '';

  readonly limits = SKILL_LIMITS;
  readonly draft = new Draft<SkillFields>({ name: '', description: '', text: '' });
  /** Who can use it, and what that was when the page opened. */
  readonly share = new ShareEditor(() => this.auth.user?.user_id ?? '');
  private sharedAtFirst = '';

  tab: 'write' | 'preview' = 'write';
  readonly tabs: Choice<'write' | 'preview'>[] = [
    { value: 'write', name: 'Write' },
    { value: 'preview', name: 'Preview' },
  ];
  readonly marks: { mark: Mark; icon: string; name: string }[] = [
    { mark: 'bold', icon: 'bold', name: 'Bold' },
    { mark: 'italic', icon: 'italic', name: 'Italic' },
    { mark: 'heading', icon: 'heading', name: 'Heading' },
    { mark: 'list', icon: 'list', name: 'List' },
    { mark: 'numbered', icon: 'list-ordered', name: 'Numbered list' },
    { mark: 'code', icon: 'code', name: 'Code' },
    { mark: 'link', icon: 'link', name: 'Link' },
  ];

  /** Save was pressed: what is missing is said under its field. */
  tried = false;
  saving = false;
  saveError = '';

  /** The other skills' names: two skills may not share one. */
  private names: string[] = [];
  /** Escape was the last key in the writing area: the next Tab leaves
   *  it, where a Tab otherwise indents. */
  private leaving = false;

  @ViewChild('area') private area?: ElementRef<HTMLTextAreaElement>;

  constructor(
    private service: SkillsService,
    private profiles: ProfileService,
    public auth: AuthService,
    private router: Router,
    private route: ActivatedRoute,
    private confirm: ConfirmService,
  ) {}

  async ngOnInit(): Promise<void> {
    this.ref = this.route.snapshot.paramMap.get('ref') || '';
    const [skills, peers] = await Promise.all([
      this.service.list(),
      this.profiles.peers().catch(() => null),
    ]);
    if (peers) this.share.peers = peers;
    this.names = skills.items.filter((skill) => skill.id !== this.ref).map((skill) => skill.name);

    if (this.ref) this.open(skills.items.find((skill) => skill.id === this.ref));
    else {
      this.share.open('new', undefined);
      // The example is written into the form, not taken as saved:
      // nothing is saved yet, so the save bar is there from the start.
      if (this.route.snapshot.queryParamMap.get('example')) Object.assign(this.draft.value, EXAMPLE);
    }
    this.sharedAtFirst = this.sharedNow;
    this.loading = false;
  }

  /** The skill to change, as the list holds it, text and all. */
  private open(skill: Skill | undefined): void {
    if (!skill || skill.created_by !== this.share.myUserId) {
      this.problem = 'That skill could not be opened. It may have been deleted, or is not yours to change.';
      return;
    }
    this.draft.take({ name: skill.name, description: skill.description, text: skill.text });
    this.share.open(skill.id, skill.owner);
  }

  // ── What changed ────────────────────────────────────────────────────

  private get sharedNow(): string {
    return JSON.stringify([this.share.mode, [...this.share.groups].sort(), [...this.share.users].sort()]);
  }

  get dirty(): boolean {
    return this.draft.dirty || this.sharedNow !== this.sharedAtFirst;
  }

  /** For the guard on the way out of the page. */
  unsavedChangesTo(): string {
    return this.dirty && !this.saving ? 'this skill' : '';
  }

  /** Reloading or closing the tab asks too, in the browser's own words. */
  @HostListener('window:beforeunload', ['$event'])
  onUnload(event: BeforeUnloadEvent): void {
    if (this.dirty) event.preventDefault();
  }

  // ── What is wrong ───────────────────────────────────────────────────

  /** Told as it is typed: a name another skill has. */
  get duplicateName(): boolean {
    const normal = (value: string) => value.trim().replace(/\s+/g, ' ').toLowerCase();
    const mine = normal(this.draft.value.name);
    return !!mine && this.names.some((name) => normal(name) === mine);
  }

  get nameError(): string {
    if (this.duplicateName) return 'Another skill has this name. Choose a different one.';
    return this.tried && !this.draft.value.name.trim() ? 'Give the skill a name.' : '';
  }

  get descriptionError(): string {
    return this.tried && !this.draft.value.description.trim() ? 'Say when this skill applies.' : '';
  }

  get textError(): string {
    return this.tried && !this.draft.value.text.trim() ? 'Write the skill itself.' : '';
  }

  get shareError(): string {
    if (!this.tried || this.share.ready) return '';
    return this.share.mode === 'groups' ? 'Tick at least one group.' : 'Tick at least one person.';
  }

  /** The last tenth of a limit: the counter says so. */
  near(length: number, limit: number): boolean {
    return length >= limit * 0.9;
  }

  // ── The writing area ────────────────────────────────────────────────

  get preview(): string {
    return headingsDown(this.draft.value.text, 2);
  }

  /** Tab indents by two spaces. Escape, then Tab, leaves the area: a
   *  keyboard has to be able to get out. */
  onAreaKey(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      this.leaving = true;
      return;
    }
    if (event.key === 'Tab' && !event.shiftKey && !this.leaving) {
      event.preventDefault();
      this.replaceSelection((chosen) => ({ text: '  ' + chosen, select: [2, 2 + chosen.length] }));
    }
    this.leaving = false;
  }

  /** Puts the toolbar's mark around the selection, or at the start of
   *  its line, and leaves the selection on what was marked. */
  apply(mark: Mark): void {
    const line = (prefix: string) => this.prefixLines(prefix);
    switch (mark) {
      case 'bold': return this.wrap('**', '**', 'bold text');
      case 'italic': return this.wrap('*', '*', 'italic text');
      case 'link': return this.wrap('[', '](https://)', 'link text');
      case 'code': {
        const chosen = this.selected();
        return chosen.includes('\n') ? this.wrap('```\n', '\n```', 'code') : this.wrap('`', '`', 'code');
      }
      case 'heading': return line('## ');
      case 'list': return line('- ');
      default: return line('1. ');
    }
  }

  private selected(): string {
    const box = this.area?.nativeElement;
    return box ? box.value.slice(box.selectionStart, box.selectionEnd) : '';
  }

  private wrap(before: string, after: string, placeholder: string): void {
    this.replaceSelection((chosen) => {
      const inner = chosen || placeholder;
      return { text: before + inner + after, select: [before.length, before.length + inner.length] };
    });
  }

  /** Puts `prefix` at the start of every line the selection touches. */
  private prefixLines(prefix: string): void {
    const box = this.area?.nativeElement;
    if (!box) return;
    const from = box.value.lastIndexOf('\n', box.selectionStart - 1) + 1;
    box.setSelectionRange(from, box.selectionEnd);
    this.replaceSelection((chosen) => {
      const text = chosen.split('\n').map((each) => prefix + each).join('\n');
      return { text, select: [0, text.length] };
    });
  }

  /** Replaces the selection with what `change` makes of it, keeps the
   *  draft in step, and selects the part `change` names. */
  private replaceSelection(change: (chosen: string) => { text: string; select: [number, number] }): void {
    const box = this.area?.nativeElement;
    if (!box) return;
    const start = box.selectionStart;
    const made = change(box.value.slice(start, box.selectionEnd));
    const text = box.value.slice(0, start) + made.text + box.value.slice(box.selectionEnd);
    if (text.length > this.limits.text) return;
    this.draft.value.text = text;
    box.value = text;
    box.focus();
    box.setSelectionRange(start + made.select[0], start + made.select[1]);
  }

  /** The example replaces what is written, so it asks when something is. */
  async insertExample(): Promise<void> {
    if (this.draft.value.text.trim()) {
      const sure = await this.confirm.ask({
        title: 'Replace what you wrote with the example?',
        body: 'The skill itself is replaced. The name and when it applies are filled in only where they are empty.',
        confirm: 'Replace',
        danger: true,
      });
      if (!sure) return;
    }
    const value = this.draft.value;
    value.name = value.name.trim() ? value.name : EXAMPLE.name;
    value.description = value.description.trim() ? value.description : EXAMPLE.description;
    value.text = EXAMPLE.text;
    this.tab = 'write';
  }

  // ── Saving and leaving ──────────────────────────────────────────────

  async save(): Promise<void> {
    if (this.saving) return;
    this.tried = true;
    this.saveError = '';
    if (this.nameError || this.descriptionError || this.textError || this.shareError) {
      this.saveError = 'Something is missing above.';
      return;
    }

    this.saving = true;
    try {
      const fields: SkillFields = {
        name: this.draft.value.name.trim(),
        description: this.draft.value.description.trim(),
        text: this.draft.value.text.trim(),
      };
      const result = this.ref
        ? await this.service.update(this.ref, fields)
        : await this.service.create(fields);
      if (result.error || !result.item) {
        this.saveError = result.error || 'The skill could not be saved.';
        return;
      }
      const id = result.item.id;
      // Saved: nothing is unsaved, so the way out asks nothing.
      this.draft.take(fields);
      this.ref = id;
      if (this.sharedNow !== this.sharedAtFirst) {
        const shared = await this.service.share(id, this.share.owner());
        if (shared.error) {
          this.saveError = `The skill was saved, but not who can use it: ${shared.error}`;
          return;
        }
      }
      this.sharedAtFirst = this.sharedNow;
      await this.router.navigate(['/data/skills', id], { state: { skillSaved: this.creating ? 'created' : 'updated' } });
    } finally {
      this.saving = false;
    }
  }

  /** Whether the page opened to write a new skill. */
  private get creating(): boolean {
    return !this.route.snapshot.paramMap.get('ref');
  }

  /** Back to what was there when the page opened. */
  discard(): void {
    this.draft.discard();
    const [mode, groups, users] = JSON.parse(this.sharedAtFirst);
    this.share.mode = mode;
    this.share.groups = new Set(groups);
    this.share.users = new Set(users);
    this.tried = false;
    this.saveError = '';
  }

  /** Where Back goes: the skill being changed, or the list. */
  get back(): string[] {
    return this.ref ? ['/data/skills', this.ref] : ['/data/skills'];
  }
}
