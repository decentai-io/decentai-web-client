import { Component, OnDestroy, OnInit } from '@angular/core';
import { ActivatedRoute, NavigationEnd, Router } from '@angular/router';
import { Subscription } from 'rxjs';

import { Candidate } from 'src/app/components/transfer-dialog/transfer-dialog.component';
import { fullDate, relativeDate } from 'src/app/components/ui/dates';
import { FilterGroup } from 'src/app/components/ui/filter-column.component';
import { Paging } from 'src/app/components/ui/paging';
import { Choice } from 'src/app/components/ui/radio-keys';
import { AuthService } from 'src/app/services/auth.service';
import { ConfirmService } from 'src/app/services/confirm.service';
import { ProfileService } from 'src/app/services/profile.service';
import { Skill, SkillsService } from 'src/app/services/skills.service';
import { DataPageBase } from '../../data-page-base';
import { ShareEditor, SharingChip } from '../../share-editor';

/** Which skills are listed, and in what order. */
type Show = 'all' | 'mine' | 'shared';

/** A number over the list: its icon, the number, its word, and the
 *  "whose" it narrows the list to, when it is one. */
interface Tile {
  icon: string;
  value: number;
  label: string;
  show?: Show;
  warn?: boolean;
}
type SkillSort = 'written' | 'name' | 'author';

/**
 * Skills: knowledge people write for the assistant, or save from a card
 * it offered. The assistant sees every skill a chat uses as its name and
 * description, and reads the text only when it judges the skill relevant
 * — so the description is what it chooses by, and the page says so.
 * Which skills a chat uses is the chat's own setting.
 *
 * One list, with a column at its left that narrows it by whose a skill
 * is. A skill's name opens it to be read at /data/skills/<id>, beside
 * the list on a wide screen. What is chosen, the search and the sort are
 * in the address. Skills handed to the person wait at the top, to be
 * accepted or declined.
 *
 * Writing a skill and changing one are a page of their own
 * (skill-editor.component): this page only leads there.
 */
@Component({
  selector: 'app-skills',
  standalone: false,
  templateUrl: './skills.component.html',
  styleUrl: './skills.component.css',
})
export class SkillsComponent extends DataPageBase implements OnInit, OnDestroy {
  loading = true;
  skills: Skill[] = [];
  /** Skills another member handed to the person, not yet accepted. */
  handed: Skill[] = [];
  busyId = '';

  // ── What the address says ───────────────────────────────────────────
  show: Show = 'all';
  query = '';
  /** The list a page at a time; back to the first when what narrows it changes. */
  readonly paging = new Paging(20);
  readonly handedPaging = new Paging(5);
  sort: SkillSort = 'written';
  /** The skill opened to be read; '' for none. */
  openId = '';
  private address = new Subscription();

  readonly sortChoices: Choice[] = [
    { value: 'written', name: 'Written' },
    { value: 'name', name: 'Name' },
    { value: 'author', name: 'Author' },
  ];

  /** Who can use a skill, changed from its row without opening it. */
  readonly share = new ShareEditor(() => this.myUserId);
  shareProblem = '';

  transferTarget: Skill | null = null;
  transferring = false;

  constructor(
    private service: SkillsService,
    private profiles: ProfileService,
    public auth: AuthService,
    private router: Router,
    private route: ActivatedRoute,
    private confirm: ConfirmService,
  ) {
    super();
  }

  ngOnDestroy(): void {
    this.address.unsubscribe();
  }

  async ngOnInit(): Promise<void> {
    this.address.add(this.route.queryParamMap.subscribe((params) => {
      const show = params.get('show');
      this.show = show === 'mine' || show === 'shared' ? show : 'all';
      this.query = params.get('q') ?? '';
      const sort = params.get('sort');
      this.sort = sort === 'name' || sort === 'author' ? sort : 'written';
    }));
    this.address.add(this.router.events.subscribe((event) => {
      if (event instanceof NavigationEnd) this.readOpened();
    }));

    const [, peers] = await Promise.all([this.reload(), this.profiles.peers().catch(() => null)]);
    if (peers) this.share.peers = peers;
    this.loading = false;
    this.readOpened();
    this.sayWhatWasSaved();
  }

  /** Arriving from the editor after a save: said once, here. */
  private sayWhatWasSaved(): void {
    const from = history.state as { skillSaved?: string } | null;
    if (!from?.skillSaved) return;
    history.replaceState({ ...from, skillSaved: undefined }, '');
    this.flash(from.skillSaved === 'created'
      ? 'Skill written. Chats that use every skill can read it from now on.' : 'Skill updated.');
  }

  private async reload(): Promise<void> {
    const page = await this.service.list();
    if (page.error) return this.fail(page.error);
    this.skills = page.items;
    this.handed = page.handed;
  }

  // ── The address ─────────────────────────────────────────────────────

  /** Changes what the address says, and so what is listed. */
  go(changes: Record<string, string>): void {
    const queryParams: Record<string, string | null> = {};
    for (const [key, value] of Object.entries(changes)) queryParams[key] = value || null;
    void this.router.navigate([], {
      relativeTo: this.route.firstChild ?? this.route,
      queryParams,
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }

  /** Opens what the address names. An id that names no skill the person
   *  can see, once the list is read, goes back to the list and says so. */
  private readOpened(): void {
    this.openId = this.route.snapshot.firstChild?.paramMap.get('ref') || '';
    if (this.openId && !this.loading && !this.opened) {
      this.fail('That skill is not one you can see any more.');
      this.closeOpened();
    }
  }

  get opened(): Skill | null {
    return this.skills.find((skill) => skill.id === this.openId) || null;
  }

  closeOpened(): void {
    void this.router.navigate(['/data/skills'], { queryParamsHandling: 'preserve' });
  }

  // ── Access ──────────────────────────────────────────────────────────

  get canCreate(): boolean {
    return this.auth.can('skills:skill:create');
  }

  get myUserId(): string {
    return this.auth.user?.user_id ?? '';
  }

  /** Only its writer changes, shares, hands on or deletes a skill. */
  mayChange(skill: Skill): boolean {
    return skill.created_by === this.myUserId;
  }

  // ── The list ────────────────────────────────────────────────────────

  private matchesShow(skill: Skill, show: Show): boolean {
    if (show === 'mine') return skill.created_by === this.myUserId;
    if (show === 'shared') return skill.created_by !== this.myUserId;
    return true;
  }

  /** How many skills, whose, and how many of the person's are shared. */
  get tiles(): Tile[] {
    const mine = this.skills.filter((skill) => this.matchesShow(skill, 'mine'));
    return [
      { icon: 'sparkles', value: this.skills.length, label: this.skills.length === 1 ? 'Skill' : 'Skills', show: 'all' },
      { icon: 'user', value: mine.length, label: 'Yours', show: 'mine' },
      { icon: 'users', value: this.skills.length - mine.length, label: 'Shared with you', show: 'shared' },
      { icon: 'share', value: mine.filter((skill) => this.sharing(skill).word !== 'Private').length, label: 'You share' },
    ];
  }

  /** A tile is known by its icon, so the row is not drawn again. */
  byIcon(_: number, tile: Tile): string {
    return tile.icon;
  }

  get filters(): FilterGroup[] {
    const count = (show: Show) => this.skills.filter((skill) => this.matchesShow(skill, show)).length;
    return [{
      key: 'show',
      required: true,
      items: [
        { value: 'all', name: 'All', count: count('all') },
        { value: 'mine', name: 'Mine', count: count('mine') },
        { value: 'shared', name: 'Shared with me', count: count('shared') },
      ],
    }];
  }

  /** Who wrote a skill, by name; "You" for the person's own. */
  author(skill: Skill): string {
    return skill.created_by === this.myUserId ? 'You' : this.share.personName(skill.created_by);
  }

  /** The skills the filter and the search leave, in the chosen order. */
  get shownSkills(): Skill[] {
    const query = this.query.trim().toLowerCase();
    const by: Record<SkillSort, (a: Skill, b: Skill) => number> = {
      written: (a, b) => (b.updated_at || '').localeCompare(a.updated_at || ''),
      name: (a, b) => a.name.localeCompare(b.name),
      author: (a, b) => this.author(a).localeCompare(this.author(b)) || a.name.localeCompare(b.name),
    };
    return this.skills
      .filter((skill) => this.matchesShow(skill, this.show)
        && (!query || `${skill.name} ${skill.description} ${this.author(skill)}`.toLowerCase().includes(query)))
      .sort(by[this.sort]);
  }

  written(skill: Skill): string {
    // Mid-sentence: "written just now".
    return relativeDate(skill.updated_at).replace(/^J/, 'j');
  }

  writtenInFull(skill: Skill): string {
    return fullDate(skill.updated_at);
  }

  /** Who can use the skill, as its row's chip. */
  sharing(skill: Skill): SharingChip {
    return this.share.chip(skill.owner, skill.created_by);
  }

  get foot(): string {
    return this.skills.length ? 'The assistant reads a skill when its description says the skill applies.' : '';
  }

  // ── Writing and changing: the editor's page ─────────────────────────

  startCreate(fromExample = false): void {
    void this.router.navigate(['/data/skills/new'], { queryParams: fromExample ? { example: 1 } : {} });
  }

  startEdit(skill: Skill): void {
    void this.router.navigate(['/data/skills', skill.id, 'edit']);
  }

  // ── Sharing, from the row ───────────────────────────────────────────

  openShare(skill: Skill): void {
    this.shareProblem = '';
    this.share.open(skill.id, skill.owner);
  }

  async saveShare(): Promise<void> {
    this.share.saving = true;
    this.shareProblem = '';
    try {
      const result = await this.service.share(this.share.ref, this.share.owner());
      if (result.error) {
        this.shareProblem = result.error;
        return;
      }
      this.share.close();
      await this.reload();
      this.flash('Sharing updated.');
    } finally {
      this.share.saving = false;
    }
  }

  // ── Deleting ────────────────────────────────────────────────────────

  /** Asked first: chats stop being able to read it at once. */
  async askDelete(skill: Skill): Promise<void> {
    const sure = await this.confirm.ask({
      title: `Delete ${skill.name}?`,
      body: 'Chats stop being able to read it immediately. Anything already written using it '
        + 'is unaffected: this only changes what comes next.',
      confirm: 'Delete',
      danger: true,
    });
    if (sure) await this.remove(skill);
  }

  async remove(skill: Skill): Promise<void> {
    this.busyId = skill.id;
    try {
      const result = await this.service.remove(skill.id);
      if (result.error) return this.fail(result.error);
      if (skill.id === this.openId) this.closeOpened();
      await this.reload();
      this.flash('Skill deleted.');
    } finally {
      this.busyId = '';
    }
  }

  // ── Handing over, and taking one handed over ────────────────────────

  requestTransfer(item: Skill): void {
    this.transferTarget = item;
    this.error = '';
  }

  closeTransfer(): void {
    if (!this.transferring) this.transferTarget = null;
  }

  async transfer(person: Candidate): Promise<void> {
    const item = this.transferTarget;
    if (!item) return;
    this.transferring = true;
    try {
      const result = await this.service.transfer(item.id, person.user_id);
      // Closed either way: a refusal is said on the page, where it can
      // be read, not under the dialog.
      this.transferTarget = null;
      if (result.error) return this.fail(result.error);
      this.flash(`Offered to ${person.name || person.email}. It is theirs once they accept.`);
    } finally {
      this.transferring = false;
    }
  }

  /** Take back a hand-over not yet accepted. */
  async withdraw(skill: Skill): Promise<void> {
    this.busyId = skill.id;
    try {
      const result = await this.service.withdraw(skill.id);
      if (result.error) return this.fail(result.error);
      await this.reload();
      this.flash(`${skill.name} is no longer being handed over.`);
    } finally {
      this.busyId = '';
    }
  }

  /** Who handed a skill over, by name. */
  handedBy(skill: Skill): string {
    return this.share.personName(skill.handing?.by || '') || 'A colleague';
  }

  async accept(skill: Skill, accept: boolean): Promise<void> {
    this.busyId = skill.id;
    try {
      const result = await this.service.accept(skill.id, accept);
      if (result.error) return this.fail(result.error);
      await this.reload();
      this.flash(accept ? `${skill.name} is yours now.` : `${skill.name} declined.`);
    } finally {
      this.busyId = '';
    }
  }
}
