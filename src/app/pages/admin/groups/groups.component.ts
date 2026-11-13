import { Component, OnDestroy, OnInit, TemplateRef, ViewChild } from '@angular/core';
import { MatDialog, MatDialogRef } from '@angular/material/dialog';

import { AuthService, Person } from 'src/app/services/auth.service';
import { Group, GroupCounts, GroupService, PolicyName } from 'src/app/services/group.service';
import { PolicyService } from 'src/app/services/policy.service';
import { ConfirmService } from 'src/app/services/confirm.service';
import { DataPageBase } from '../../app/data-page-base';
import { ServerList, ServerPage, ServerPages } from 'src/app/components/ui/paging';
import { Pick } from 'src/app/components/ui/search-picks.component';

/**
 * Admin → Groups: groups of people, each giving them its policies.
 *
 * Membership lives on the person (their `groups`), so people are placed
 * in groups on the Users page — here a group's people are shown, not
 * changed. What this page manages is the group itself and the policies it
 * gives; giving a policy is bounded by what the administrator holds.
 * Everyone holds every person, and it and Administrators stay, under
 * their names.
 *
 * The groups, a group's people and the policies to give are each paged
 * and searched on the API server: an organization of thousands of them
 * is never read whole.
 */
@Component({
  selector: 'app-groups',
  standalone: false,
  templateUrl: './groups.component.html',
  styleUrl: '../admin-shared.css',
})
export class GroupsComponent extends DataPageBase implements OnInit, OnDestroy {
  loading = true;

  /** The groups, twenty to a page. */
  readonly pages = new ServerPages<Group>(20, (after, limit) => this.readGroups(after, limit));
  /** The organization's groups in numbers, whatever the search. */
  counts: GroupCounts = { groups: 0, own: 0 };
  /** How many policies there are to give. */
  policyCount = 0;
  /** The policies the groups read give, by id, to name them. */
  private policyNames = new Map<string, PolicyName>();

  /** null = the editor is closed; '' = creating; otherwise the group id. */
  editingId: string | null = null;
  formName = '';
  selected = new Set<string>();
  /** The chosen policies by name, as the editor opens, for its picker. */
  chosenPolicies: Pick[] = [];
  /** The people of the group open in the editor, twenty at a time. */
  people: ServerList<Person> | null = null;

  saving = false;
  busy = new Set<string>();

  query = '';
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
      const [, policies] = await Promise.all([this.pages.first(), this.policyService.page('', 1)]);
      if (!policies.error) this.policyCount = policies.total;
      if (this.pages.error) this.fail(this.pages.error);
    } finally {
      this.loading = false;
    }
  }

  ngOnDestroy(): void {
    this.pages.cancel();
  }

  private async readGroups(after: string, limit: number): Promise<ServerPage<Group>> {
    const page = await this.groupService.page(after, limit, this.query);
    if (!page.error) {
      this.counts = page.counts;
      for (const policy of page.policies) this.policyNames.set(policy.policy_id, policy);
    }
    return page;
  }

  private async reload(): Promise<void> {
    await this.pages.reload();
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

  get groups(): Group[] {
    return this.pages.rows;
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
    return this.policyNames.get(policyId)?.name ?? policyId;
  }

  /** The groups made here: neither Everyone nor Administrators. */
  get ownCount(): number {
    return this.counts.own;
  }

  /** Who is in a group, in a word or two, for its pill. */
  peopleWord(group: Group): string {
    return group.everyone ? 'Every person' : `${group.members ?? 0} ${group.members === 1 ? 'person' : 'people'}`;
  }

  /** The policies a group gives, by name: its row shows the first few. */
  policyNamesOf(group: Group): string[] {
    return group.policies.map((id) => this.policyName(id));
  }

  summarise(group: Group): string {
    const people = this.peopleWord(group);
    if (!group.policies.length) return `${people} · No policies`;
    const names = this.policyNamesOf(group);
    const shown = names.slice(0, 3).join(', ');
    return `${people} · ${names.length > 3 ? `${shown} +${names.length - 3} more` : shown}`;
  }

  /** The policies there are to give, searched on the server. */
  readonly searchPolicies = async (q: string, after: string, limit: number): Promise<ServerPage<Pick>> => {
    const page = await this.policyService.page(after, limit, q);
    for (const policy of page.rows) {
      this.policyNames.set(policy.policy_id, { policy_id: policy.policy_id, name: policy.name, built_in: policy.built_in });
    }
    return {
      rows: page.rows.map((policy) => ({ id: policy.policy_id, name: policy.name, hint: policy.built_in ? 'Built in' : '' })),
      next: page.next, total: page.total, error: page.error,
    };
  };

  // ── Editor ──────────────────────────────────────────────────────────

  startCreate(): void {
    this.editingId = '';
    this.formName = '';
    this.selected = new Set<string>();
    this.chosenPolicies = [];
    this.people = null;
    this.error = '';
    this.openEditor();
  }

  async startEdit(group: Group): Promise<void> {
    this.editingId = group.group_id;
    this.formName = group.name;
    this.selected = new Set(group.policies);
    this.chosenPolicies = group.policies.map((id) => ({ id, name: this.policyName(id) }));
    this.error = '';
    this.openEditor();

    // Shown so an administrator can see who a change reaches.
    const groupId = group.group_id;
    this.people = new ServerList<Person>(20, (after, limit) => this.groupService.get(groupId, after, limit));
    await this.people.first();
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
      this.people = null;
    });
  }

  /** The editor is open: what goes wrong is said in it, not behind it. */
  get editorOpen(): boolean {
    return this.dialogRef !== null;
  }

  /** The groups of the page shown: the search is the server's. */
  get shown(): Group[] {
    return this.groups;
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
