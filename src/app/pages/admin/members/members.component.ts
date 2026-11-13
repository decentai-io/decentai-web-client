import { Component, OnDestroy, OnInit, TemplateRef, ViewChild } from '@angular/core';
import { MatDialog, MatDialogRef } from '@angular/material/dialog';

import { dayDate } from 'src/app/components/ui/dates';
import { SEARCH_WAIT, ServerPage, ServerPages } from 'src/app/components/ui/paging';
import { Choice } from 'src/app/components/ui/radio-keys';
import { Pick } from 'src/app/components/ui/search-picks.component';

import { AuthService } from 'src/app/services/auth.service';
import { GroupService } from 'src/app/services/group.service';
import {
  GroupName, Invitation, Leaving, Member, MemberCounts, MembersService,
} from 'src/app/services/members.service';
import { ConfirmService } from 'src/app/services/confirm.service';
import { DataPageBase } from '../../app/data-page-base';

/**
 * Admin → Users: the organization's people, and who has been invited.
 *
 * Where the deployment sends email, everyone arrives by invitation.
 * Where no mail server is set it sends none: the administrator adds a
 * person here and hands them a temporary password, and resets a
 * forgotten one the same way. A person's access is exactly their groups,
 * so this page is where group membership is managed; what those groups
 * give is composed on the Groups and Policies pages.
 *
 * Guard rails the API server enforces and this page says plainly:
 * - you cannot disable or remove your own account;
 * - no change may leave nobody able to manage access;
 * - you cannot place anyone in groups giving more than you hold.
 */
@Component({
  selector: 'app-members',
  standalone: false,
  templateUrl: './members.component.html',
  styleUrl: '../admin-shared.css',
})
export class MembersComponent extends DataPageBase implements OnInit, OnDestroy {
  loading = true;

  /** The people, twenty to a page, and the invitations, ten: each paged
   *  and searched on the API server. */
  readonly pages = new ServerPages<Member>(20, (after, limit) => this.readPeople(after, limit));
  readonly invitationPages = new ServerPages<Invitation>(10, (after, limit) => this.readInvitations(after, limit));
  /** The organization in numbers, whatever the search. */
  counts: MemberCounts = { people: 0, administrators: 0, held: 0 };
  /** The groups the rows read are in, by id, to name them. */
  private groupNames = new Map<string, GroupName>();

  /** The person whose groups are being edited, or null. */
  editingId: string | null = null;
  selected = new Set<string>();

  /** Invite form — where no email is sent, the form a person is added with. */
  inviting = false;
  inviteName = '';
  inviteEmail = '';
  inviteGroupIds = new Set<string>();
  /** A temporary password just made, shown once: whose, and what. */
  handed: { email: string; password: string; reset: boolean } | null = null;

  saving = false;
  busy = new Set<string>();

  query = '';
  /** A dialog's button was pressed: what a field still needs is said under it. */
  tried = false;
  /** What is shown once was copied. */
  copied = false;

  /** The page's dialogs, one open at a time. */
  @ViewChild('inviteDialog') private inviteDialog!: TemplateRef<unknown>;
  @ViewChild('handedDialog') private handedDialog!: TemplateRef<unknown>;
  @ViewChild('groupsDialog') private groupsDialog!: TemplateRef<unknown>;
  @ViewChild('leavingDialog') private leavingDialog!: TemplateRef<unknown>;
  private dialogRef: MatDialogRef<unknown> | null = null;

  constructor(
    private members_: MembersService,
    private groupService: GroupService,
    public auth: AuthService,
    private dialog: MatDialog,
    private confirm: ConfirmService,
  ) {
    super();
  }

  async ngOnInit(): Promise<void> {
    try {
      // Whether people are invited or added is the deployment's mail.
      await Promise.all([
        this.pages.first(),
        this.canReadInvitations ? this.invitationPages.first() : Promise.resolve(),
        this.auth.setupStatus().catch(() => undefined),
      ]);
      const failed = this.pages.error || this.invitationPages.error;
      if (failed) this.fail(failed);
    } finally {
      this.loading = false;
    }
  }

  ngOnDestroy(): void {
    this.pages.cancel();
    if (this.successorTimer) clearTimeout(this.successorTimer);
  }

  private async readPeople(after: string, limit: number): Promise<ServerPage<Member>> {
    const page = await this.members_.page(after, limit, { q: this.query });
    if (!page.error) {
      this.counts = page.counts;
      this.learn(page.groups);
    }
    return page;
  }

  private async readInvitations(after: string, limit: number): Promise<ServerPage<Invitation>> {
    const page = await this.members_.invitations(after, limit);
    if (!page.error) this.learn(page.groups);
    return page;
  }

  private learn(groups: GroupName[]): void {
    for (const group of groups) this.groupNames.set(group.group_id, group);
  }

  /** The page shown, and the invitations, read again after a change. */
  private async reload(): Promise<void> {
    await Promise.all([this.pages.reload(), this.canReadInvitations ? this.invitationPages.reload() : Promise.resolve()]);
  }

  /** A new search: from the first page, once the typing stops. */
  onSearch(query: string): void {
    this.query = query;
    this.pages.search();
  }

  clearSearch(): void {
    this.query = '';
    void this.pages.first();
  }

  /** The groups a person may be placed in, searched on the server:
   *  Everyone holds them all already, so it is never offered. */
  readonly searchGroups = async (q: string, after: string, limit: number): Promise<ServerPage<Pick>> => {
    const page = await this.groupService.page(after, limit, q);
    const kept = page.rows.filter((group) => !group.everyone);
    if (!after) this.everyoneDropped = page.rows.length - kept.length;
    for (const group of page.rows) this.learn([group]);
    return {
      rows: kept.map((group) => ({ id: group.group_id, name: group.name })),
      next: page.next, total: Math.max(0, page.total - this.everyoneDropped), error: page.error,
    };
  };
  private everyoneDropped = 0;

  /** The chosen groups by name, as a dialog opens, for its picker: those
   *  not on the page it read are shown first. */
  chosenGroups: Pick[] = [];

  private picksOf(ids: Iterable<string>): Pick[] {
    return [...ids].map((id) => ({ id, name: this.groupNames.get(id)?.name ?? id }));
  }

  // ── What the current person may do ──────────────────────────────────

  get canInvite(): boolean {
    return this.adds ? this.auth.can('iam:user:create') : this.auth.can('iam:invitation:create');
  }

  /** People are added here, not invited: this install sends no
   *  email, and an invitation would reach nobody. */
  get adds(): boolean {
    return !this.auth.sendsEmail;
  }

  get canResetPassword(): boolean {
    return this.auth.can('iam:user:reset_password');
  }

  get canAssignGroups(): boolean {
    return this.auth.can('iam:user:set_groups');
  }

  get canDisable(): boolean {
    return this.auth.can('iam:user:set_status');
  }

  get canDelete(): boolean {
    return this.auth.can('iam:user:delete');
  }

  get canStop(): boolean {
    return this.auth.can('ai:switch:stop_person');
  }

  get canReadInvitations(): boolean {
    return this.auth.can('iam:invitation:list');
  }

  get canRevokeInvitations(): boolean {
    return this.auth.can('iam:invitation:revoke');
  }

  isSelf(member: Member): boolean {
    return member.user_id === this.auth.user?.user_id;
  }

  isBusy(id: string): boolean {
    return this.busy.has(id);
  }

  // ── The page's dialogs ──────────────────────────────────────────────

  /** Opens one of the page's dialogs in place of whichever is open.
   *  Closing it, however it is closed, ends what it was for. */
  private show(template: TemplateRef<unknown>, width = '520px'): void {
    const before = this.dialogRef;
    this.dialogRef = null;
    before?.close();
    this.tried = false;
    this.copied = false;
    const ref = this.dialog.open(template, { width, maxWidth: '100vw' });
    this.dialogRef = ref;
    ref.afterClosed().subscribe(() => {
      // Replaced by another dialog: that one's state is not this one's to clear.
      if (this.dialogRef !== ref) return;
      this.dialogRef = null;
      this.editingId = null;
      this.inviting = false;
      this.handed = null;
      this.removing = null;
      this.leaving = null;
      this.error = '';
    });
  }

  closeDialog(): void {
    if (!this.saving && !this.busy.size) this.dialogRef?.close();
  }

  /** A dialog is open: what goes wrong is said in it, not behind it. */
  get dialogOpen(): boolean {
    return this.dialogRef !== null;
  }

  // ── Reading a person ────────────────────────────────────────────────

  /** The people of the page shown: the search is the server's. */
  get shown(): Member[] {
    return this.pages.rows;
  }

  get invitations(): Invitation[] {
    return this.invitationPages.rows;
  }

  /** Whether the row's menu has anything in it for this person. */
  hasActions(member: Member): boolean {
    return this.canAssignGroups
      || (!this.isSelf(member) && (this.canResetPassword || this.canDelete || this.canStop))
      || (this.canDisable && (!this.isSelf(member) || member.status === 'disabled'));
  }

  day(when: string | null | undefined): string {
    return dayDate(when || '');
  }

  /** The person whose groups are open, by name. */
  get editingName(): string {
    const member = this.pages.rows.find((each) => each.user_id === this.editingId);
    return member?.name || member?.email || '';
  }

  /** The numbers over the list, the server's, whatever the search: the
   *  people, those in Administrators, and those held back (disabled, or
   *  everything of theirs stopped). */
  get peopleCount(): number {
    return this.counts.people;
  }

  get adminCount(): number {
    return this.counts.administrators;
  }

  get heldCount(): number {
    return this.counts.held;
  }

  /** Whether a person is in the Administrators group. */
  isAdmin(member: Member): boolean {
    return member.groups.some((id) => this.groupNames.get(id)?.administrators);
  }

  /** A person's initials, for their row's mark: of the name, else the email. */
  initials(member: Member): string {
    const words = (member.name || member.email.split('@')[0]).split(/[\s._-]+/).filter(Boolean);
    return words.slice(0, 2).map((word) => word[0]).join('').toUpperCase() || '?';
  }

  /** A person's groups, by name, each a pill. */
  groupList(groupIds: string[]): string[] {
    return groupIds.map((id) => this.groupNames.get(id)?.name ?? id);
  }

  // ── Group assignment ────────────────────────────────────────────────

  startEditGroups(member: Member): void {
    this.editingId = member.user_id;
    this.selected = new Set(member.groups);
    this.chosenGroups = this.picksOf(member.groups);
    this.error = '';
    this.show(this.groupsDialog);
  }

  toggleGroup(groupId: string): void {
    if (!this.selected.delete(groupId)) this.selected.add(groupId);
  }

  async saveGroups(): Promise<void> {
    if (this.editingId === null) return;

    this.saving = true;
    try {
      const result = await this.members_.setGroups(this.editingId, [...this.selected]);
      if (result.error) return this.fail(result.error);
      this.dialogRef?.close();
      await this.reload();
      this.flash('Groups updated.');
      // Their own permissions may have just changed.
      await this.auth.refresh();
    } finally {
      this.saving = false;
    }
  }

  // ── Status, stopping & removal ──────────────────────────────────────

  async setStatus(member: Member, status: 'active' | 'disabled'): Promise<void> {
    if (status === 'disabled') {
      const sure = await this.confirm.ask({
        title: `Disable ${member.email}?`,
        body: 'Their sessions end at once, and they cannot sign in until the account is enabled again. They keep everything.',
        confirm: 'Disable',
        danger: true,
      });
      if (!sure) return;
    }
    await this.act(member, () => this.members_.setStatus(member.user_id, status),
      status === 'disabled' ? 'Account disabled.' : 'Account enabled again.');
  }

  /** Stop everything of a person, every chat and schedule, until they
   *  are let resume; or let them. */
  async setStopped(member: Member, stop: boolean): Promise<void> {
    if (stop) {
      const sure = await this.confirm.ask({
        title: `Stop everything of ${member.name || member.email}?`,
        body: 'Every chat and schedule of theirs stops at once, and the questions waiting on them end. '
          + 'Nothing of theirs runs again until they, or you, resume.',
        confirm: 'Stop everything',
        danger: true,
      });
      if (!sure) return;
    }
    await this.act(member, () => this.members_.setStopped(member.user_id, stop),
      stop ? 'Everything of theirs is stopped.' : 'They may resume.');
  }

  private async act(member: Member, call: () => Promise<{ error?: string }>, done: string): Promise<void> {
    this.busy.add(member.user_id);
    try {
      const result = await call();
      if (result.error) return this.fail(result.error);
      await this.reload();
      this.flash(done);
    } finally {
      this.busy.delete(member.user_id);
    }
  }

  /** Removal is a hand-over: the dialog shows what will be deleted and
   *  what will pass to a successor. */
  removing: Member | null = null;
  leaving: Leaving | null = null;
  successorId = '';
  /** Who what they own can pass to: the remover first, then the rest. */
  successorChoices: Choice[] = [];

  /** The search for a successor: the active people it finds are offered,
   *  read from the server rather than every person at once. */
  successorQuery = '';
  private successorTimer: ReturnType<typeof setTimeout> | null = null;
  private successorAsked = 0;

  async requestRemove(member: Member): Promise<void> {
    this.removing = member;
    this.leaving = null;
    this.successorId = '';
    this.successorQuery = '';
    this.successorChoices = [{ value: '', name: 'Me' }];
    this.error = '';
    this.show(this.leavingDialog);
    const [preview] = await Promise.all([this.members_.leaving(member.user_id), this.findSuccessors()]);
    if (preview.error || !preview.counts) return this.fail(preview.error || 'Could not see what they own.');
    this.leaving = preview.counts;
  }

  /** A new search for a successor, once the typing stops. */
  onSuccessorSearch(query: string): void {
    this.successorQuery = query;
    if (this.successorTimer) clearTimeout(this.successorTimer);
    this.successorTimer = setTimeout(() => {
      this.successorTimer = null;
      void this.findSuccessors();
    }, SEARCH_WAIT);
  }

  /** The active people the search finds, the remover first as "Me"; the
   *  one chosen stays offered while the search changes. */
  private async findSuccessors(): Promise<void> {
    const member = this.removing;
    if (!member) return;
    const ask = ++this.successorAsked;
    const page = await this.members_.page('', 20, { status: 'active', q: this.successorQuery });
    if (ask !== this.successorAsked || this.removing !== member || page.error) return;
    const kept = this.successorChoices.find((choice) => choice.value && choice.value === this.successorId);
    const found: Choice[] = page.rows
      .filter((each) => each.user_id !== member.user_id && !this.isSelf(each))
      .map((each) => ({ value: each.user_id, name: each.name || each.email, hint: each.email }));
    this.successorChoices = [
      { value: '', name: 'Me' },
      ...(kept && !found.some((choice) => choice.value === kept.value) ? [kept] : []),
      ...found,
    ];
  }

  /** What goes with them, and what passes on, in words a person reads. */
  private lines(kinds: [keyof Leaving, string, string][]): string[] {
    return kinds.filter(([kind]) => this.leaving?.[kind])
      .map(([kind, one, many]) => `${this.leaving![kind]} ${this.leaving![kind] === 1 ? one : many}`);
  }

  get deletedLines(): string[] {
    return this.lines([
      ['chats', 'chat', 'chats'], ['schedules', 'schedule', 'schedules'], ['webhooks', 'webhook', 'webhooks'],
      ['secrets_deleted', 'secret kept to themselves', 'secrets kept to themselves'],
    ]);
  }

  get handedLines(): string[] {
    return this.lines([
      ['records_handed_on', 'record', 'records'], ['skills', 'skill', 'skills'],
      ['mcp_servers', 'MCP server', 'MCP servers'],
    ]);
  }

  async remove(member: Member): Promise<void> {
    this.busy.add(member.user_id);
    try {
      const result = await this.members_.remove(member.user_id, this.successorId);
      if (result.error) return this.fail(result.error);
      this.dialogRef?.close();
      const successor = this.successorChoices.find((each) => each.value && each.value === this.successorId);
      await this.reload();
      this.flash(`${member.email} removed.${successor ? ` What they shared is now ${successor.hint || successor.name}'s.` : ''}`);
    } finally {
      this.busy.delete(member.user_id);
    }
  }

  // ── Adding, and inviting ────────────────────────────────────────────

  startInvite(): void {
    this.inviting = true;
    this.show(this.inviteDialog);
    this.inviteName = '';
    this.inviteEmail = '';
    this.inviteGroupIds = new Set<string>();
    this.chosenGroups = [];
    this.error = '';
  }

  /** Add a person and show the password to hand them. */
  async addPerson(): Promise<void> {
    const email = this.inviteEmail.trim();
    const name = this.inviteName.trim();
    this.tried = true;
    this.error = '';
    if (!name || !email) return;

    this.saving = true;
    try {
      const result = await this.members_.create(email, name, [...this.inviteGroupIds]);
      if (result.error) return this.fail(result.error);
      await this.reload();
      this.inviting = false;
      this.handed = { email, password: result.password, reset: false };
      this.show(this.handedDialog);
    } finally {
      this.saving = false;
    }
  }

  /** A reset link mailed to them, or, where no mail is sent, a
   *  temporary password to hand them. */
  async resetPassword(member: Member): Promise<void> {
    const sure = await this.confirm.ask({
      title: `Reset the password of ${member.email}?`,
      body: this.adds
        ? 'They are signed out everywhere, and you are shown a temporary password to hand them.'
        : 'A link to choose a new password goes to them. It lasts an hour.',
      confirm: 'Reset password',
    });
    if (!sure) return;

    this.busy.add(member.user_id);
    try {
      const result = await this.members_.resetPassword(member.user_id);
      if (result.error) return this.fail(result.error);
      if (result.mailed) {
        this.flash(`A reset link went to ${member.email}.`);
        return;
      }
      await this.reload();
      this.handed = { email: member.email, password: result.password ?? '', reset: true };
      this.show(this.handedDialog);
    } finally {
      this.busy.delete(member.user_id);
    }
  }

  async copyPassword(): Promise<void> {
    if (!this.handed) return;
    try {
      await navigator.clipboard.writeText(this.handed.password);
      this.copied = true;
    } catch {
      this.fail('Could not copy — select the password and copy it yourself.');
    }
  }

  async sendInvite(): Promise<void> {
    this.tried = true;
    this.error = '';
    const email = this.inviteEmail.trim();
    if (!email) return;

    this.saving = true;
    try {
      const result = await this.members_.invite(email, [...this.inviteGroupIds]);
      if (result.error) return this.fail(result.error);
      this.dialogRef?.close();
      await this.reload();
      this.flash(`Invitation emailed to ${email}.`);
    } finally {
      this.saving = false;
    }
  }

  /** A new link to the same address; the one sent before stops working. */
  async resend(invitation: Invitation): Promise<void> {
    this.busy.add(invitation.invitation_id);
    try {
      const result = await this.members_.invite(invitation.email, invitation.groups);
      if (result.error) return this.fail(result.error);
      await this.reload();
      this.flash(`Invitation sent again to ${invitation.email}.`);
    } finally {
      this.busy.delete(invitation.invitation_id);
    }
  }

  async revoke(invitation: Invitation): Promise<void> {
    this.busy.add(invitation.invitation_id);
    try {
      const result = await this.members_.revoke(invitation.invitation_id);
      if (result.error) return this.fail(result.error);
      await this.reload();
      this.flash(`Invitation for ${invitation.email} withdrawn.`);
    } finally {
      this.busy.delete(invitation.invitation_id);
    }
  }
}
