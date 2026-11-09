import { Component, OnDestroy, OnInit } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { ActivatedRoute, NavigationEnd, Router } from '@angular/router';
import { firstValueFrom, Subscription } from 'rxjs';

import { fullDate, relativeDate } from 'src/app/components/ui/dates';
import { FilterGroup, FilterItem } from 'src/app/components/ui/filter-column.component';
import { AuthService } from 'src/app/services/auth.service';
import { ConfirmService } from 'src/app/services/confirm.service';
import { OauthConnectService } from 'src/app/services/oauth.service';
import { ProfileService } from 'src/app/services/profile.service';
import { AppRecord, RecordsService } from 'src/app/services/records.service';
import { RecordPage } from '../data/record-page';
import { SecretFormComponent, SecretFormData, SecretFormResult } from './secret-form.component';
import { connects, identifier, isConnected, secretTitle } from './secret-shared';

type Show = 'mine' | 'shared';

/**
 * Secrets: what a person stores for agents to act with. Each is a record
 * of a resource an installed agent declares: typed in here, or an account
 * connected through its provider. Its encrypted values are never shown
 * back.
 *
 * One list, with a column at its left that narrows it: whose, and which
 * agent uses it. A secret opens at /secrets/<id>, beside the list on a
 * wide screen: its fields, the agents that may use it, and who can see
 * it. Adding and changing are one dialog (secret-form.component); what
 * is chosen and the search are in the address.
 */
@Component({
  selector: 'app-secrets',
  standalone: false,
  templateUrl: './secrets.component.html',
  styleUrl: './secrets.component.css',
})
export class SecretsComponent extends RecordPage implements OnInit, OnDestroy {
  protected override readonly nouns: [string, string] = ['secret', 'secrets'];

  // ── What the address says ───────────────────────────────────────────
  show: Show = 'mine';
  /** An agent's id, or ''. */
  agent = '';
  query = '';
  /** The secret opened beside the list; '' for none. */
  openId = '';
  private address = new Subscription();

  constructor(
    service: RecordsService,
    profiles: ProfileService,
    auth: AuthService,
    confirm: ConfirmService,
    private oauth: OauthConnectService,
    private router: Router,
    private route: ActivatedRoute,
    private dialog: MatDialog,
  ) {
    super('secret', service, profiles, auth, confirm);
  }

  async ngOnInit(): Promise<void> {
    this.address.add(this.route.queryParamMap.subscribe((params) => {
      this.show = params.get('show') === 'shared' ? 'shared' : 'mine';
      this.agent = params.get('agent') ?? '';
      this.query = params.get('q') ?? '';
    }));
    this.address.add(this.router.events.subscribe((event) => {
      if (event instanceof NavigationEnd) this.readOpened();
    }));
    await this.load();
    this.readOpened();
  }

  ngOnDestroy(): void {
    this.address.unsubscribe();
  }

  // ── The address ─────────────────────────────────────────────────────

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

  /** The column chose something: whose, or an agent. */
  filter(key: string, value: string): void {
    this.go(key === 'show' ? { show: value === 'mine' ? '' : value } : { agent: value });
  }

  private readOpened(): void {
    this.openId = this.route.snapshot.firstChild?.paramMap.get('ref') || '';
    if (this.openId && !this.loading && !this.opened) {
      this.fail('That secret is not one you can see any more.');
      this.closeOpened();
    }
  }

  get opened(): AppRecord | null {
    return this.records.find((secret) => secret.record_id === this.openId) || null;
  }

  closeOpened(): void {
    void this.router.navigate(['/secrets'], { queryParamsHandling: 'preserve' });
  }

  protected override deleted(secret: AppRecord): void {
    if (secret.record_id === this.openId) this.closeOpened();
  }

  // ── The list ────────────────────────────────────────────────────────

  /** The secrets of the chosen "whose": what the agents are counted in. */
  private get pool(): AppRecord[] {
    return this.records.filter((secret) => this.isMine(secret) === (this.show === 'mine'));
  }

  get chosen(): Record<string, string> {
    return { show: this.show, agent: this.agent };
  }

  get filters(): FilterGroup[] {
    const mine = this.records.filter((secret) => this.isMine(secret)).length;
    const byAgent = new Map<string, FilterItem>();
    for (const secret of this.pool) {
      for (const id of new Set(secret.agents.map((entry) => entry.agent))) {
        const name = this.agentName(id);
        const item = byAgent.get(id) ?? { value: id, name, agent: { name }, count: 0 };
        item.count = (item.count ?? 0) + 1;
        byAgent.set(id, item);
      }
    }
    const groups: FilterGroup[] = [{
      key: 'show',
      required: true,
      items: [
        { value: 'mine', name: 'Mine', count: mine },
        { value: 'shared', name: 'Shared with me', count: this.records.length - mine },
      ],
    }];
    if (byAgent.size) {
      groups.push({ key: 'agent', label: 'By agent', items: [...byAgent.values()].sort((a, b) => a.name.localeCompare(b.name)) });
    }
    return groups;
  }

  /** The secrets the column and the search leave, newest change first. */
  get shown(): AppRecord[] {
    const query = this.query.trim().toLowerCase();
    const changed = (secret: AppRecord) => secret.updated_at || secret.created_at || '';
    return this.pool.filter((secret) =>
      (!this.agent || secret.agents.some((entry) => entry.agent === this.agent))
      && (!query || [this.nameOf(secret), this.kindOf(secret), ...this.servedBy(secret)]
        .join(' ').toLowerCase().includes(query)))
      .sort((a, b) => changed(b).localeCompare(changed(a)));
  }

  get filtered(): boolean {
    return !!(this.query || this.agent);
  }

  nameOf(secret: AppRecord): string {
    return secretTitle(secret, this.shapeOf(secret.of));
  }

  /** What kind of thing it is: its resource's label, and the agent's. */
  kindOf(secret: AppRecord): string {
    return secret.of ? `${this.resourceLabel(secret.of)} · ${this.agentName(secret.of.agent)}` : 'Secret';
  }

  /** The plain value that says what it is for, when the title is not it. */
  identifierOf(secret: AppRecord): string {
    const found = identifier(secret);
    return found && found !== this.nameOf(secret) ? found : '';
  }

  /** The agent whose mark stands for it in the list. */
  markOf(secret: AppRecord): string {
    return secret.of ? this.agentName(secret.of.agent) : '';
  }

  /** Its resource connects an account through its provider. */
  connectsAccount(secret: AppRecord): boolean {
    return connects(this.shapeOf(secret.of));
  }

  /** Its resource connects an account, and none is connected yet. */
  notConnected(secret: AppRecord): boolean {
    return this.connectsAccount(secret) && !isConnected(secret);
  }

  updated(secret: AppRecord): string {
    return relativeDate(secret.updated_at || secret.created_at || '').replace(/^J/, 'j');
  }

  updatedInFull(secret: AppRecord): string {
    return fullDate(secret.updated_at || secret.created_at || '');
  }

  // ── Adding and changing: the one dialog ─────────────────────────────

  private async openForm(more: Partial<SecretFormData>): Promise<void> {
    const ref = this.dialog.open<SecretFormComponent, SecretFormData, SecretFormResult | null>(
      SecretFormComponent, { width: '560px', maxWidth: '100vw', data: { shapes: this.shapes, ...more } });
    const done = await firstValueFrom(ref.afterClosed());
    if (!done) return;
    await this.reload();
    this.flash(done.notice);
    // A secret just made is the one to look at.
    if (!more.secret) void this.router.navigate(['/secrets', done.id]);
  }

  add(): Promise<void> { return this.openForm({}); }
  edit(secret: AppRecord): Promise<void> { return this.openForm({ secret }); }

  /** Connects the account its resource declares, again or for the first
   *  time: the provider's sign-in opens on this click. */
  async connect(secret: AppRecord): Promise<void> {
    await this.act(secret, () => this.oauth.connect(secret.record_id), 'Account connected.');
  }
}
