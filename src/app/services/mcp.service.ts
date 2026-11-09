import { Injectable } from '@angular/core';

import { Failure, RequestService } from './request.service';
import { Shared } from './skills.service';

/** One tool a server offers, as a runtime last read it, and whether the
 *  person's chats may call it. */
export interface McpTool {
  name: string;
  description: string;
  on: boolean;
}

/** A remote MCP server the person added. Its credential headers are kept
 *  encrypted and never shown again. */
export interface McpServer extends Shared {
  name: string;
  address: string;
  tools: McpTool[];
  /** When a runtime last read its tools. */
  read_at?: string;
}

/** A credential as a person gives it: the headers the server is reached
 *  with, such as `{Authorization: "Bearer …"}`. Empty for none. */
export type McpHeaders = Record<string, string>;

/**
 * Client for Mcp:Server: remote MCP servers a person adds for their own
 * chats, shared with people and groups. A runtime reads a server's tools
 * when asked (`refresh`); the person switches each tool on and off.
 */
@Injectable({ providedIn: 'root' })
export class McpService {
  constructor(private request: RequestService) {}

  async list(): Promise<{ items: McpServer[]; handed: McpServer[] } & Failure> {
    const r = await this.request.gateway('Mcp:Server:list', { limit: 100 });
    return { items: r.items ?? [], handed: r.handed ?? [], error: r.error };
  }

  async get(id: string): Promise<McpServer | null> {
    const r = await this.request.gateway('Mcp:Server:get', { id });
    return r.item ?? null;
  }

  create(fields: { name: string; address: string; headers: McpHeaders }) {
    return this.request.gateway<{ item: McpServer }>('Mcp:Server:create', fields);
  }

  /** `headers` left out keeps the credential; a new address needs it
   *  again. `tools` switches tools on and off, by name. */
  update(id: string, fields: Partial<{ name: string; address: string; headers: McpHeaders; tools: Record<string, boolean> }>) {
    return this.request.gateway<{ item: McpServer }>('Mcp:Server:update', { id, ...fields });
  }

  /** Ask a runtime to read the server's tools again. */
  refresh(id: string) {
    return this.request.gateway<{ item: McpServer }>('Mcp:Server:refresh', { id });
  }

  share(id: string, owner: { users: string[]; groups: string[] }) {
    return this.request.gateway<{ item: McpServer }>('Mcp:Server:share', { id, owner });
  }

  transfer(id: string, userId: string) {
    return this.request.gateway<object>('Mcp:Server:transfer', { id, user_id: userId });
  }

  /** Take back a hand-over not yet accepted. */
  withdraw(id: string) {
    return this.request.gateway<object>('Mcp:Server:withdraw', { id });
  }

  accept(id: string, accept: boolean) {
    return this.request.gateway<object>('Mcp:Server:accept', { id, accept });
  }

  remove(id: string) {
    return this.request.gateway<object>('Mcp:Server:delete', { id });
  }
}
