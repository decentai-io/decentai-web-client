import { Component, OnDestroy, OnInit, TemplateRef, ViewChild } from '@angular/core';
import { MatDialog, MatDialogRef } from '@angular/material/dialog';
import { ActivatedRoute, Router } from '@angular/router';

import { fullDate } from 'src/app/components/ui/dates';
import { AuthService } from 'src/app/services/auth.service';
import { ConfirmService } from 'src/app/services/confirm.service';
import { McpServer, McpService, McpTool } from 'src/app/services/mcp.service';
import { LEVEL_MEANINGS, PERMISSION_LEVELS } from 'src/app/pages/app/agents/agent-shared';
import { CredentialDraft, lastRead } from './mcp-shared';

/** A number over the page: its icon, the number and its word. */
interface Tile {
  icon: string;
  value: string | number;
  label: string;
  warn?: boolean;
}

/** How long "Saved" stays beside a tool. */
const SAVED_FOR_MS = 2000;

/**
 * One MCP server, looked over: where it is, when a runtime last read its
 * tools, and every tool it offers with its switch and its level. This is
 * where a person decides what chats may call, and what they ask first, so
 * each tool saves itself and says so on its own row, and nothing else on
 * the page waits for it.
 *
 * A tool a server offers for the first time is off until it is switched
 * on. Someone it was shared with sees it as its owner left it.
 */
@Component({
  selector: 'app-mcp-server',
  standalone: false,
  templateUrl: './mcp-server.component.html',
  styleUrl: './mcp-server.component.css',
})
export class McpServerComponent implements OnInit, OnDestroy {
  loading = true;
  /** Why the server could not be opened. */
  problem = '';
  server: McpServer | null = null;

  /** Said once at the top: what was done. */
  notice = '';
  /** Why the last read, or the last change of the server itself, failed. */
  error = '';
  /** 'read' while it is read again; 'all' while every tool is switched. */
  busy: '' | 'read' | 'all' = '';

  query = '';
  /** A tool's level by its index, in the words every page uses. */
  readonly levels = PERMISSION_LEVELS;
  /** How each tool's last save went, by name: on its way, done, or why not. */
  private saves = new Map<string, string>();

  // Changing the name, the address or the credential: one dialog.
  @ViewChild('changeDialog') private changeDialog?: TemplateRef<unknown>;
  private dialogRef: MatDialogRef<unknown> | null = null;
  changing: 'name' | 'url' | 'credential' = 'name';
  changeValue = '';
  changeProblem = '';
  readonly credential = new CredentialDraft();
  tried = false;
  saving = false;

  constructor(
    private service: McpService,
    private auth: AuthService,
    private route: ActivatedRoute,
    private router: Router,
    private dialog: MatDialog,
    private confirm: ConfirmService,
  ) {}

  async ngOnInit(): Promise<void> {
    const id = this.route.snapshot.paramMap.get('ref') || '';
    this.server = await this.service.get(id);
    this.loading = false;
    if (!this.server) {
      this.problem = 'That server could not be opened. It may have been removed, or is not shared with you.';
      return;
    }
    // Just added: its tools are read now, by a runtime.
    if ((history.state as { mcpAdded?: boolean } | null)?.mcpAdded) {
      history.replaceState({ ...history.state, mcpAdded: undefined }, '');
      await this.readAgain();
      if (!this.error) this.notice = 'Added. Its tools are off: switch on the ones your chats may call.';
    }
    // The list's menu leads here to change one thing.
    const change = this.route.snapshot.queryParamMap.get('change');
    if ((change === 'name' || change === 'url' || change === 'credential') && this.mine) {
      void this.router.navigate([], { relativeTo: this.route, queryParams: {}, replaceUrl: true });
      setTimeout(() => this.startChange(change));
    }
  }

  ngOnDestroy(): void {
    this.dialogRef?.close();
  }

  /** Only its owner changes it. */
  get mine(): boolean {
    return this.server?.created_by === this.auth.user?.user_id;
  }

  get lastRead(): string {
    return lastRead(this.server!);
  }

  get lastReadInFull(): string {
    return fullDate(this.server?.read_at);
  }

  // ── The tools ───────────────────────────────────────────────────────

  get tools(): McpTool[] {
    return this.server?.tools || [];
  }

  get shownTools(): McpTool[] {
    const query = this.query.trim().toLowerCase();
    if (!query) return this.tools;
    return this.tools.filter((tool) => `${tool.name} ${tool.description}`.toLowerCase().includes(query));
  }

  get onCount(): number {
    return this.tools.filter((tool) => tool.on).length;
  }

  byName(_: number, tool: McpTool): string { return tool.name; }

  /** What it offers, what is on and off, and when it was read. */
  get tiles(): Tile[] {
    const count = this.tools.length;
    return [
      { icon: 'square-terminal', value: count, label: count === 1 ? 'Tool offered' : 'Tools offered' },
      { icon: 'zap', value: this.onCount, label: 'On' },
      { icon: 'circle-dashed', value: count - this.onCount, label: 'Off' },
      { icon: 'history', value: this.lastRead || 'Not yet', label: 'Last read', warn: !this.server?.read_at },
    ];
  }

  /** A tile is known by its icon, so the row is not drawn again. */
  byIcon(_: number, tile: Tile): string { return tile.icon; }

  /** How a tool's last save went: 'Saving…', 'Saved', or the refusal. */
  saveOf(tool: McpTool): string {
    return this.saves.get(tool.name) || '';
  }

  saveFailed(tool: McpTool): boolean {
    const said = this.saveOf(tool);
    return !!said && said !== 'Saving…' && said !== 'Saved';
  }

  levelOf(tool: McpTool): number {
    return tool.level ?? 2;
  }

  levelMeaning(tool: McpTool): string {
    return LEVEL_MEANINGS[this.levels[this.levelOf(tool)]] || '';
  }

  setTool(tool: McpTool, on: boolean): Promise<void> {
    return this.saveTool(tool, { tools: { [tool.name]: on } });
  }

  setLevel(tool: McpTool, level: number): Promise<void> {
    return this.saveTool(tool, { levels: { [tool.name]: level } });
  }

  /** One tool's switch or level. Only its row waits and says how it went;
   *  a refusal leaves the tool as it was, with the reason. */
  private async saveTool(tool: McpTool, change: Parameters<McpService['update']>[1]): Promise<void> {
    const server = this.server;
    if (!server || !this.mine) return;
    this.saves.set(tool.name, 'Saving…');
    const result = await this.service.update(server.id, change);
    if (result.error || !result.item) {
      this.saves.set(tool.name, result.error || 'That could not be saved.');
      // The switch goes back to what the tool is.
      this.server = { ...server };
      return;
    }
    this.server = result.item;
    this.saves.set(tool.name, 'Saved');
    setTimeout(() => {
      if (this.saves.get(tool.name) === 'Saved') this.saves.delete(tool.name);
    }, SAVED_FOR_MS);
  }

  /** Every tool on, or every tool off, in one save. */
  async setAll(on: boolean): Promise<void> {
    const server = this.server;
    if (!server || this.busy || !this.mine) return;
    this.busy = 'all';
    this.error = '';
    const result = await this.service.update(server.id, {
      tools: Object.fromEntries(this.tools.map((tool) => [tool.name, on])),
    });
    this.busy = '';
    if (result.error || !result.item) {
      this.error = result.error || 'That could not be saved.';
      return;
    }
    this.server = result.item;
    this.notice = on ? 'Every tool is on.' : 'Every tool is off.';
  }

  // ── The server itself ───────────────────────────────────────────────

  /** Asks a runtime to read what the server offers. A read that fails
   *  leaves the tools as they were, and says why. */
  async readAgain(): Promise<void> {
    const server = this.server;
    if (!server || this.busy || !this.mine) return;
    this.busy = 'read';
    this.error = '';
    this.notice = '';
    const result = await this.service.refresh(server.id);
    this.busy = '';
    if (result.error || !result.item) {
      this.error = result.error || 'The server could not be read.';
      return;
    }
    const before = new Set(server.tools.map((tool) => tool.name));
    this.server = result.item;
    const fresh = this.tools.filter((tool) => !before.has(tool.name)).length;
    this.notice = fresh && before.size
      ? `Read again. ${fresh} ${fresh === 1 ? 'tool is' : 'tools are'} new, and off until you switch them on.`
      : 'Read again.';
  }

  // ── A new name, address or credential ───────────────────────────────

  startChange(what: 'name' | 'url' | 'credential'): void {
    const server = this.server;
    if (!server || !this.changeDialog || this.dialogRef) return;
    this.changing = what;
    this.changeValue = what === 'name' ? server.name : what === 'url' ? server.address : '';
    this.credential.reset('token');
    this.changeProblem = '';
    this.tried = false;
    this.dialogRef = this.dialog.open(this.changeDialog, { width: '480px', maxWidth: '100vw' });
    this.dialogRef.afterClosed().subscribe(() => (this.dialogRef = null));
  }

  closeDialog(): void {
    if (!this.saving) this.dialogRef?.close();
  }

  get changeTitle(): string {
    const name = this.server?.name || '';
    return this.changing === 'name' ? `Rename ${name}`
      : this.changing === 'url' ? `Change the address of ${name}` : `Replace the credential of ${name}`;
  }

  /** What is missing from the name or the address; '' when nothing is. */
  get valueMissing(): string {
    if (this.changing === 'credential' || this.changeValue.trim()) return '';
    return this.changing === 'name' ? 'Give the server a name.' : 'Enter the server\'s address.';
  }

  /** A new address goes with its credential, typed again: a credential
   *  is never sent to a host it was not given for. The tools are read
   *  again there. */
  async saveChange(): Promise<void> {
    const server = this.server;
    if (!server || this.saving) return;
    this.tried = true;
    this.changeProblem = '';
    if (this.valueMissing || (this.changing !== 'name' && !this.credential.ready)) return;

    this.saving = true;
    if (this.dialogRef) this.dialogRef.disableClose = true;
    const result = await this.service.update(server.id,
      this.changing === 'name' ? { name: this.changeValue.trim() }
        : this.changing === 'url' ? { address: this.changeValue.trim(), headers: this.credential.headers() }
          : { headers: this.credential.headers() });
    this.saving = false;
    if (this.dialogRef) this.dialogRef.disableClose = false;
    if (result.error || !result.item) {
      this.changeProblem = result.error || 'That could not be saved.';
      return;
    }
    this.server = result.item;
    this.error = '';
    this.closeDialog();
    if (this.changing === 'url') {
      await this.readAgain();
      if (!this.error) this.notice = 'Address changed, and its tools read there. Each starts off.';
      return;
    }
    this.notice = this.changing === 'name' ? 'Renamed.' : 'Credential replaced.';
  }

  // ── Removing ────────────────────────────────────────────────────────

  async askRemove(): Promise<void> {
    const server = this.server;
    if (!server) return;
    const sure = await this.confirm.ask({
      title: `Remove ${server.name}?`,
      body: 'Chats stop being able to call its tools at once, and its credential is deleted.',
      confirm: 'Remove',
      danger: true,
    });
    if (!sure) return;
    const result = await this.service.remove(server.id);
    if (result.error) {
      this.error = result.error;
      return;
    }
    await this.router.navigate(['/data/mcp'], { state: { mcpNotice: `${server.name} removed.` } });
  }
}
