import { Component, OnInit, TemplateRef, ViewChild } from '@angular/core';
import { Refused } from 'src/app/services/request.service';
import { MatDialog, MatDialogRef } from '@angular/material/dialog';

import { AuthService, Person } from 'src/app/services/auth.service';
import { Group, GroupService } from 'src/app/services/group.service';
import { Policy, PolicyService } from 'src/app/services/policy.service';
import { ConfirmService } from 'src/app/services/confirm.service';
import { DataPageBase } from '../../app/data-page-base';
import { Paging, Shown } from 'src/app/components/ui/paging';

/**
 * Admin → Groups: groups of people, each giving them its policies.
 *
 * Membership lives on the person (their `groups`), so people are placed
 * in groups on the Users page — here a group's people are shown, not
 * changed. What this page manages is the group itself and the policies it
 * gives; giving a policy is bounded by what the administrator holds.
 * Everyone holds every person, and it and Administrators stay, under
 * their names.
 */
@Component({
  selector: 'app-groups',
  standalone: false,
  templateUrl: './groups.component.html',
  styleUrl: '../admin-shared.css',
})
export class GroupsComponent extends DataPageBase implements OnInit {
  loading = true;

  groups: Group[] = [];
  policies: Policy[] = [];

  /** null = the editor is closed; '' = creating; otherwise the group id. */
  editingId: string | null = null;
  formName = '';
  selected = new Set<string>();
  editingPeople: Person[] = [];

  saving = false;
  busy = new Set<string>();

  query = '';
  /** The groups a page at a time; a group's people ten at a time. */
  readonly paging = new Paging(20);
  readonly people = new Shown(10);
  /** Save was pressed: what the name still needs is said under it. */
  tried = false;
  /** The editor, on the dialog shell. */
  @ViewChild('editor') private editor!: TemplateRef<unknown>;
  private dialogRef: MatDialogRef<unknown> | null = null;

  constructor(
    private groupService: GroupService,
    private policyService: PolicyService,
    public auth: AuthService,
    private dialog: MatDialog,
    private confirm: ConfirmService,
  ) {
    super();
  }

  async ngOnInit(): Promise<void> {
    try {
      [this.groups, this.policies] = await Promise.all([this.groupService.list(), this.policyService.list()]);
    } catch (failed) {
      this.fail(Refused.words(failed));
    } finally {
      this.loading = false;
    }
  }

  private async reload(): Promise<void> {
    this.groups = await this.groupService.list();
  }

  // ── What the current person may do ──────────────────────────────────

  get canCreate(): boolean {
    return this.auth.can('iam:group:create');
  }

  get canUpdate(): boolean {
    return this.auth.can('iam:group:rename');
  }

  get canAssign(): boolean {
    return this.auth.can('iam:group:set_policies');
  }

  get canDelete(): boolean {
    return this.auth.can('iam:group:delete');
  }

  isBusy(groupId: string): boolean {
    return this.busy.has(groupId);
  }

  /** Everyone and Administrators stay, under their names. */
  stays(group: Group | undefined): boolean {
    return !!group && (group.everyone || group.administrators);
  }

  // ── Reading a group ─────────────────────────────────────────────────

  policyName(policyId: string): string {
    return this.policies.find((p) => p.policy_id === policyId)?.name ?? policyId;
  }

  /** The groups made here: neither Everyone nor Administrators. */
  get ownCount(): number {
    return this.groups.filter((group) => !this.stays(group)).length;
  }

  /** Who is in a group, in a word or two, for its pill. */
  peopleWord(group: Group): string {
    return group.everyone ? 'Every person' : `${group.members ?? 0} ${group.members === 1 ? 'person' : 'people'}`;
  }

  /** The policies a group gives, by name: its row shows the first few. */
  policyNames(group: Group): string[] {
    return group.policies.map((id) => this.policyName(id));
  }

  summarise(group: Group): string {
    const people = group.everyone ? 'Every person' : `${group.members ?? 0} ${group.members === 1 ? 'person' : 'people'}`;
    if (!group.policies.length) return `${people} · No policies`;
    const names = group.policies.map((id) => this.policyName(id));
    const shown = names.slice(0, 3).join(', ');
    return `${people} · ${names.length > 3 ? `${shown} +${names.length - 3} more` : shown}`;
  }

  // ── Editor ──────────────────────────────────────────────────────────

  startCreate(): void {
    this.editingId = '';
    this.formName = '';
    this.selected = new Set<string>();
    this.editingPeople = [];
    this.error = '';
    this.openEditor();
  }

  async startEdit(group: Group): Promise<void> {
    this.editingId = group.group_id;
    this.formName = group.name;
    this.selected = new Set(group.policies);
    this.error = '';
    this.openEditor();

    // Shown so an administrator can see who a change reaches.
    this.people.reset();
    this.editingPeople = (await this.groupService.get(group.group_id))?.users ?? [];
  }

  cancelEdit(): void {
    if (!this.saving) this.dialogRef?.close();
  }

  get isCreating(): boolean {
    return this.editingId === '';
  }

  get editing(): Group | undefined {
    return this.groups.find((group) => group.group_id === this.editingId);
  }

  get editorTitle(): string {
    return this.isCreating ? 'New group' : `Edit ${this.formName}`;
  }

  togglePolicy(policyId: string): void {
    if (!this.selected.delete(policyId)) this.selected.add(policyId);
  }

  /** Opens the editor on the dialog shell; closing it, however it is
   *  closed, ends the edit. */
  private openEditor(): void {
    if (this.dialogRef) return;
    this.tried = false;
    this.dialogRef = this.dialog.open(this.editor, { width: '560px', maxWidth: '100vw' });
    this.dialogRef.afterClosed().subscribe(() => {
      this.dialogRef = null;
      this.editingId = null;
      this.error = '';
      this.editingPeople = [];
    });
  }

  /** The editor is open: what goes wrong is said in it, not behind it. */
  get editorOpen(): boolean {
    return this.dialogRef !== null;
  }

  /** The groups the search leaves. */
  get shown(): Group[] {
    const query = this.query.trim().toLowerCase();
    return this.groups.filter((group) => !query
      || `${group.name} ${this.summarise(group)}`.toLowerCase().includes(query));
  }

  // ── Saving ──────────────────────────────────────────────────────────

  async save(): Promise<void> {
    this.tried = true;
    this.error = '';
    const name = this.formName.trim();
    if (!name) return;

    const policyIds = [...this.selected];

    this.saving = true;
    try {
      // Naming and giving policies are two actions, held separately: each
      // is asked only where it changed something and the person may do
      // it, so one of them refused never follows the other half-saved.
      let groupId = this.editingId as string;
      const before = this.editing;
      if (this.isCreating) {
        const made = await this.groupService.create(name);
        if (made.error) return this.fail(made.error);
        groupId = made.group.group_id;
      } else if (this.canUpdate && name !== before?.name) {
        const renamed = await this.groupService.rename(groupId, name);
        if (renamed.error) return this.fail(renamed.error);
      }
      if (this.canAssign && !this.sameIds(policyIds, before?.policies ?? [])) {
        const given = await this.groupService.setPolicies(groupId, policyIds);
        if (given.error) {
          // A new group stays made: it is there to try again on.
          await this.reload();
          this.editingId = groupId;
          return this.fail(given.error);
        }
      }

      await this.reload();
      this.flash(this.isCreating ? `Group “${name}” created.` : 'Group saved.');
      this.dialogRef?.close();
      // Their own permissions may have just changed.
      await this.auth.refresh();
    } finally {
      this.saving = false;
    }
  }

  private sameIds(a: string[], b: string[]): boolean {
    return a.length === b.length && a.every((id) => b.includes(id));
  }

  async remove(group: Group): Promise<void> {
    const sure = await this.confirm.ask({
      title: `Delete the group “${group.name}”?`,
      body: 'Everyone in it loses whatever its policies gave.',
      confirm: 'Delete',
      danger: true,
    });
    if (!sure) return;

    this.busy.add(group.group_id);
    try {
      const result = await this.groupService.remove(group.group_id);
      if (result.error) return this.fail(result.error);
      await this.reload();
      this.flash(`Group “${group.name}” deleted.`);
      await this.auth.refresh();
    } finally {
      this.busy.delete(group.group_id);
    }
  }
}
