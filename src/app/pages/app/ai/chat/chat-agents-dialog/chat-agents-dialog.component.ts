import { Component, Inject, OnInit } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';

import { Shown } from 'src/app/components/ui/paging';
import { AgentsService, InstalledAgent } from 'src/app/services/agents.service';
import { McpServer, McpService } from 'src/app/services/mcp.service';
import { ListChoice } from '../chat-defaults';

/** Which agents and MCP servers a chat uses, by id: null for all the
 *  person may use, a list for those alone, `[]` for none. */
export interface ChatReach {
  agents: string[] | null;
  mcp_servers: string[] | null;
}

/**
 * Which of the agents the person may use, and of their MCP servers, this
 * chat uses. Narrowing only: leaving an agent out removes it from this
 * chat, it never grants anything their policies don't. "All" keeps no
 * list, so agents installed later join the chat; otherwise the chat keeps
 * to those ticked, none included.
 */
@Component({
  selector: 'app-chat-agents-dialog',
  standalone: false,
  templateUrl: './chat-agents-dialog.component.html',
})
export class ChatAgentsDialogComponent implements OnInit {
  agents: InstalledAgent[] = [];
  servers: McpServer[] = [];
  /** Twenty servers at a time. */
  readonly shownServers = new Shown(20);
  readonly agentChoice = new ListChoice();
  readonly serverChoice = new ListChoice();
  isLoading = true;

  constructor(
    @Inject(MAT_DIALOG_DATA) public data: ChatReach & { defaults: Partial<ChatReach> },
    private dialogRef: MatDialogRef<ChatAgentsDialogComponent>,
    private agentsService: AgentsService,
    private mcp: McpService,
  ) {}

  async ngOnInit(): Promise<void> {
    const [agents, servers] = await Promise.all([
      this.agentsService.installed().catch(() => []),
      this.mcp.list().catch(() => ({ items: [] as McpServer[] })),
    ]);
    this.agents = agents.filter((agent) => agent.state === 'ready');
    this.servers = servers.items;
    this.take(this.data);
    this.isLoading = false;
  }

  private take(reach: Partial<ChatReach>): void {
    this.agentChoice.take(reach.agents);
    this.serverChoice.take(reach.mcp_servers);
  }

  allAgents(all: boolean): void {
    this.agentChoice.setAll(all, this.agents.map((agent) => agent.agent_id));
  }

  allServers(all: boolean): void {
    this.serverChoice.setAll(all, this.servers.map((server) => server.id));
  }

  save(): void {
    this.dialogRef.close({ agents: this.agentChoice.value, mcp_servers: this.serverChoice.value } satisfies ChatReach);
  }

  reset(): void {
    this.take(this.data.defaults);
  }

  close(): void {
    this.dialogRef.close(null);
  }
}
