import { Component, OnDestroy, OnInit, TemplateRef, ViewChild } from '@angular/core';
import { MatDialog, MatDialogRef } from '@angular/material/dialog';
import { Router } from '@angular/router';

import { Candidate } from 'src/app/components/transfer-dialog/transfer-dialog.component';
import { fullDate } from 'src/app/components/ui/dates';
import { AuthService } from 'src/app/services/auth.service';
import { ConfirmService } from 'src/app/services/confirm.service';
import { McpServer, McpService } from 'src/app/services/mcp.service';
import { ProfileService } from 'src/app/services/profile.service';
import { DataPageBase } from '../../data-page-base';
import { ShareEditor, SharingChip } from '../../share-editor';
import { CredentialDraft, hostOf, lastRead, toolsWord } from './mcp-shared';

/**
 * MCP servers: remote tool servers a person adds for their chats, and
 * those colleagues shared with them. A runtime reads a server's tools
 * when asked; the person switches each one on before any chat may call
 * it.
 *
 * This is the list. A row says where a server is, what it offers and
 * when it was read; its menu holds what can be done from here, and
 * leads to the server's own page (mcp-server.component) for the rest.
 * Servers handed to the person wait at the top, to be accepted or
 * declined.
 */
@Component({
  selector: 'app-mcp',
  standalone: false,
  templateUrl: './mcp.component.html',
  styleUrl: './mcp-list.css',
})
export class McpComponent extends DataPageBase implements OnInit, OnDestroy {
  loading = true;
  /** Why the list could not be read; '' when it was. */
  loadProblem = '';
  servers: McpServer[] = [];
  /** Servers another member handed to the person, not yet accepted. */
  handed: McpServer[] = [];
  query = '';

  /** The server a row's action is on its way for. */
  busy = '';

  readonly share = new ShareEditor(() => this.myUserId);
  shareProblem = '';
  transferTarget: McpServer | null = null;
  transferring = false;

  // Adding one: a dialog.
  @ViewChild('addDialog') private addDialog?: TemplateRef<unknown>;
  private dialogRef: MatDialogRef<unknown> | null = null;
  formName = '';
  formUrl = '';
  readonly credential = new CredentialDraft();
  /** Save was pressed: what is missing is said under its field. */
  tried = false;
  /** What the API server said about the address. */
  addProblem = '';
  saving = false;

  constructor(
    private service: McpService,
    private profiles: ProfileService,
    public auth: AuthService,
    private router: Router,
    private dialog: MatDialog,
    private confirm: ConfirmService,
  ) {
    super();
  }

  async ngOnInit(): Promise<void> {
    const [, peers] = await Promise.all([this.load(), this.profiles.peers().catch(() => null)]);
    if (peers) this.share.peers = peers;
    // Arriving from a server's page after it was removed there.
    const said = (history.state as { mcpNotice?: string } | null)?.mcpNotice;
    if (said) {
      history.replaceState({ ...history.state, mcpNotice: undefined }, '');
      this.flash(said);
    }
  }

  ngOnDestroy(): void {
    this.dialogRef?.close();
  }

  async load(): Promise<void> {
    this.loading = true;
    const page = await this.service.list();
    this.servers = page.items;
    this.handed = page.handed;
    this.loadProblem = page.error || '';
    this.loading = false;
  }

  get mayAdd(): boolean {
    return this.auth.can('mcp:server:create');
  }

  get myUserId(): string {
    return this.auth.user?.user_id ?? '';
  }

  /** Only its owner changes, shares, hands on or removes a server. */
  mine(server: McpServer): boolean {
    return server.created_by === this.myUserId;
  }

  // ── The list ──────────────────────────────────────────────────────

  get shownServers(): McpServer[] {
    const query = this.query.trim().toLowerCase();
    if (!query) return this.servers;
    return this.servers.filter((server) => `${server.name} ${server.address}`.toLowerCase().includes(query));
  }

  host(server: McpServer): string { return hostOf(server); }
  tools(server: McpServer): string { return toolsWord(server); }
  lastRead(server: McpServer): string { return lastRead(server); }
  lastReadInFull(server: McpServer): string { return fullDate(server.read_at); }
  sharing(server: McpServer): SharingChip { return this.share.chip(server.owner, server.created_by); }

  get foot(): string {
    return this.servers.length ? 'A chat calls only the tools switched on, and only of the servers it uses.' : '';
  }

  /** Takes the server an answer carries into the list. */
  private take(server: McpServer): void {
    this.servers = this.servers.map((one) => one.id === server.id ? server : one);
  }

  // ── Adding ────────────────────────────────────────────────────────

  startAdd(): void {
    this.formName = this.formUrl = '';
    this.credential.reset();
    this.tried = false;
    this.addProblem = '';
    if (!this.addDialog || this.dialogRef) return;
    this.dialogRef = this.dialog.open(this.addDialog, { width: '480px', maxWidth: '100vw' });
    this.dialogRef.afterClosed().subscribe(() => (this.dialogRef = null));
  }

  closeDialog(): void {
    if (!this.saving) this.dialogRef?.close();
  }

  async add(): Promise<void> {
    if (this.saving) return;
    this.tried = true;
    this.addProblem = '';
    if (!this.formName.trim() || !this.formUrl.trim() || !this.credential.ready) return;
    this.saving = true;
    if (this.dialogRef) this.dialogRef.disableClose = true;
    const result = await this.service.create({
      name: this.formName.trim(), address: this.formUrl.trim(), headers: this.credential.headers(),
    });
    this.saving = false;
    if (this.dialogRef) this.dialogRef.disableClose = false;
    if (result.error || !result.item) {
      // The API server's sentence is about the address, or says the
      // organization allows no MCP servers: said in the dialog.
      this.addProblem = result.error || 'The server could not be added.';
      return;
    }
    this.closeDialog();
    // Its own page reads its tools, and is where they are switched on.
    void this.router.navigate(['/data/mcp', result.item.id], { state: { mcpAdded: true } });
  }

  // ── What a row's menu does here ───────────────────────────────────

  /** Ask a runtime to read the server's tools again. */
  async readAgain(server: McpServer): Promise<void> {
    this.busy = server.id;
    const result = await this.service.refresh(server.id);
    this.busy = '';
    if (result.error || !result.item) return this.fail(`${server.name}: ${result.error || 'it could not be read.'}`);
    this.take(result.item);
    this.flash(`${server.name} read again. A tool it offers for the first time is off until you switch it on.`);
  }

  /** Asked first: its tools are gone from every chat at once. */
  async askRemove(server: McpServer): Promise<void> {
    const sure = await this.confirm.ask({
      title: `Remove ${server.name}?`,
      body: 'Chats stop being able to call its tools at once, and its credential is deleted.',
      confirm: 'Remove',
      danger: true,
    });
    if (!sure) return;
    this.busy = server.id;
    const result = await this.service.remove(server.id);
    this.busy = '';
    if (result.error) return this.fail(result.error);
    this.servers = this.servers.filter((one) => one.id !== server.id);
    this.flash(`${server.name} removed.`);
  }

  // ── Sharing and handing on ────────────────────────────────────────

  openShare(server: McpServer): void {
    this.shareProblem = '';
    this.share.open(server.id, server.owner);
  }

  async saveShare(): Promise<void> {
    this.share.saving = true;
    this.shareProblem = '';
    try {
      const result = await this.service.share(this.share.ref, this.share.owner());
      if (result.error || !result.item) {
        this.shareProblem = result.error || 'Sharing could not be saved.';
        return;
      }
      this.take(result.item);
      this.share.close();
      this.flash('Sharing updated.');
    } finally {
      this.share.saving = false;
    }
  }

  requestTransfer(server: McpServer): void {
    this.transferTarget = server;
  }

  closeTransfer(): void {
    if (!this.transferring) this.transferTarget = null;
  }

  async transfer(person: Candidate): Promise<void> {
    const server = this.transferTarget;
    if (!server) return;
    this.transferring = true;
    try {
      const result = await this.service.transfer(server.id, person.user_id);
      this.transferTarget = null;
      if (result.error) return this.fail(result.error);
      await this.load();
      this.flash(`Offered to ${person.name || person.email}. It is theirs once they accept.`);
    } finally {
      this.transferring = false;
    }
  }

  async accept(server: McpServer, accept: boolean): Promise<void> {
    this.busy = server.id;
    const result = await this.service.accept(server.id, accept);
    this.busy = '';
    if (result.error) return this.fail(result.error);
    await this.load();
    this.flash(accept ? `${server.name} is yours now.` : `${server.name} declined.`);
  }

  /** Take back a hand-over not yet accepted. */
  async withdraw(server: McpServer): Promise<void> {
    this.busy = server.id;
    const result = await this.service.withdraw(server.id);
    this.busy = '';
    if (result.error) return this.fail(result.error);
    await this.load();
    this.flash(`${server.name} is no longer being handed over.`);
  }

  /** Who handed a server over, by name. */
  handedBy(server: McpServer): string {
    return this.share.personName(server.handing?.by || '') || 'A colleague';
  }
}
