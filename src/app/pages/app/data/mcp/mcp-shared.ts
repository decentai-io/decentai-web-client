import { relativeDate } from 'src/app/components/ui/dates';
import { Choice } from 'src/app/components/ui/radio-keys';
import { McpHeaders, McpServer } from 'src/app/services/mcp.service';

/** What the list and a server's own page both say about a server, so
 *  that they cannot say two things. */

/** Its host, out of its address: what a row shows. */
export function hostOf(server: McpServer): string {
  try {
    return new URL(server.address).host;
  } catch {
    return server.address;
  }
}

/** "3 tools, 1 on"; "Not read yet" before a runtime has read it. */
export function toolsWord(server: McpServer): string {
  if (!server.read_at) return 'Not read yet';
  const on = server.tools.filter((tool) => tool.on).length;
  return `${server.tools.length} ${server.tools.length === 1 ? 'tool' : 'tools'}, ${on} on`;
}

/** When its tools were last read, mid-sentence: "2 h ago", "just now". */
export function lastRead(server: McpServer): string {
  return relativeDate(server.read_at).replace(/^J/, 'j');
}

export type CredentialKind = 'none' | 'token' | 'header';

/** A credential as it is typed, when a server is added and when its
 *  credential is replaced: one of three kinds, and what each needs. */
export class CredentialDraft {
  kind: CredentialKind = 'none';
  token = '';
  header = '';
  value = '';

  readonly kinds: Choice<CredentialKind>[] = [
    { value: 'none', name: 'None' },
    { value: 'token', name: 'A token' },
    { value: 'header', name: 'A header' },
  ];

  reset(kind: CredentialKind = 'none'): void {
    this.kind = kind;
    this.token = this.header = this.value = '';
  }

  /** What is missing from a part of it; '' when nothing is. */
  missing(part: 'token' | 'header' | 'value'): string {
    if (part === 'token') return this.kind === 'token' && !this.token.trim() ? 'Enter the token.' : '';
    if (this.kind !== 'header') return '';
    if (part === 'header') return this.header.trim() ? '' : 'Enter the header\'s name.';
    return this.value.trim() ? '' : 'Enter the header\'s value.';
  }

  get ready(): boolean {
    return !this.missing('token') && !this.missing('header') && !this.missing('value');
  }

  /** As a server is reached with it: the headers themselves. */
  headers(): McpHeaders {
    if (this.kind === 'token') return { Authorization: `Bearer ${this.token.trim()}` };
    if (this.kind === 'header') return { [this.header.trim()]: this.value.trim() };
    return {};
  }
}
