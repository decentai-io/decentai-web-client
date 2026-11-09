import { Component, EventEmitter, Input, OnChanges, Output, SimpleChanges } from '@angular/core';

import { Choice } from 'src/app/components/ui/radio-keys';
import { AgentSource, SourceCredential } from 'src/app/services/agents.service';

export interface SourceDraft {
  url: string;
  /** undefined leaves the kept credential alone, null removes it, a
   *  value replaces it. */
  credential?: SourceCredential | null;
}

type CredentialKind = 'none' | 'token' | 'header';

/**
 * Saving a source: a catalog's address, and the credential a private one
 * is read with — a token, or a header and its value. The credential is
 * kept encrypted, sent only to the source's own host, and never shown
 * again; a new address needs it again. An address nobody needs a
 * credential for is the normal case and the default.
 *
 * It is the inside of a dialog: the page opens the shell around it.
 */
@Component({
  selector: 'app-source-form',
  standalone: false,
  templateUrl: './source-form.component.html',
  styleUrl: './source-form.component.css',
})
export class SourceFormComponent implements OnChanges {
  /** The source being edited, or null when adding a new one. */
  @Input() source: AgentSource | null = null;
  @Input() busy = false;
  /** An address this deployment suggests. A hint, never a default:
   *  a platform that shipped pointing at its vendor would be making that
   *  choice for every deployment. */
  @Input() suggestedUrl = '';
  /** Why the last save was refused, said under the address. */
  @Input() error = '';

  @Output() save = new EventEmitter<SourceDraft>();
  @Output() cancel = new EventEmitter<void>();

  url = '';
  kind: CredentialKind = 'none';
  token = '';
  header = '';
  value = '';
  /** A kept credential stays unless the person says otherwise. */
  changeCredential = false;
  /** Save was pressed: what is missing is said under its field. */
  tried = false;

  readonly kinds: Choice<CredentialKind>[] = [
    { value: 'none', name: 'None' },
    { value: 'token', name: 'A token' },
    { value: 'header', name: 'A header' },
  ];

  ngOnChanges(changes: SimpleChanges): void {
    if (!changes['source']) return;
    this.tried = false;
    this.url = this.source?.url || '';
    this.changeCredential = false;
    this.kind = this.source?.credential ? 'token' : 'none';
    this.token = this.header = this.value = '';
  }

  get editing(): boolean {
    return !!this.source;
  }

  /** Whether the credential is being given: always on a new source or
   *  one read with none; on one that has a credential only when asked
   *  to change it, or when its address changes, which needs it again. */
  get asksCredential(): boolean {
    return !this.source?.credential || this.changeCredential || this.url.trim() !== this.source.url;
  }

  /** What is wrong with the address as typed. Whether it is allowed is
   *  the API server's to say. */
  get urlProblem(): string {
    const typed = this.url.trim();
    if (!typed) return 'Enter the catalog\'s address.';
    try {
      return /^https?:$/.test(new URL(typed).protocol) ? '' : 'A catalog\'s address begins with https://.';
    } catch {
      return 'A catalog\'s address begins with https://.';
    }
  }

  /** What is missing from the credential; '' when nothing is. */
  missing(part: 'token' | 'header' | 'value'): string {
    if (!this.asksCredential) return '';
    if (part === 'token') return this.kind === 'token' && !this.token.trim() ? 'Enter the token.' : '';
    if (this.kind !== 'header') return '';
    if (part === 'header') return this.header.trim() ? '' : 'Enter the header\'s name.';
    return this.value.trim() ? '' : 'Enter the header\'s value.';
  }

  useSuggested(): void {
    this.url = this.suggestedUrl;
    this.kind = 'none';
  }

  /** What Save says of the credential: nothing unless one was typed, or
   *  the kept one is taken away. */
  private credentialGiven(): SourceCredential | null | undefined {
    if (!this.asksCredential) return undefined;
    if (this.kind === 'token') return { token: this.token.trim() };
    if (this.kind === 'header') return { header: this.header.trim(), value: this.value.trim() };
    return this.source?.credential ? null : undefined;
  }

  submit(): void {
    this.tried = true;
    if (this.busy || this.urlProblem || this.missing('token') || this.missing('header') || this.missing('value')) return;
    this.save.emit({ url: this.url.trim(), credential: this.credentialGiven() });
  }
}
