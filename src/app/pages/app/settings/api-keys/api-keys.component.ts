import { Component, OnInit } from '@angular/core';
import { Refused } from 'src/app/services/request.service';
import { MatDialog } from '@angular/material/dialog';
import { firstValueFrom } from 'rxjs';

import { dayDate, fullDate, relativeDate } from 'src/app/components/ui/dates';
import { ApiKey, ApiKeysService } from 'src/app/services/api-keys.service';
import { AuthService } from 'src/app/services/auth.service';
import { ConfirmService } from 'src/app/services/confirm.service';
import { CreateKeyDialogComponent } from './create-key-dialog.component';

/**
 * Settings › API keys: a person's own keys for scripts.
 *
 * A key is the person — the same permissions, checked on every call —
 * so the page says so plainly and treats the secret the way a secret
 * deserves: shown once, when it is made (the create dialog), and never
 * again. Afterwards a row is a name, a prefix and its dates. A key ends
 * when it expires or is revoked.
 */
@Component({
  selector: 'app-api-keys',
  standalone: false,
  templateUrl: './api-keys.component.html',
  styleUrls: ['./api-keys.component.css'],
})
export class ApiKeysComponent implements OnInit {
  readonly limit = ApiKeysService.MOST;
  loading = true;
  /** Why the keys could not be read. */
  loadError = '';
  keys: ApiKey[] = [];
  busyId = '';
  /** Why a key could not be revoked. */
  revokeError = '';

  constructor(
    private service: ApiKeysService,
    public auth: AuthService,
    private dialog: MatDialog,
    private confirm: ConfirmService,
  ) {}

  ngOnInit(): Promise<void> {
    return this.load();
  }

  async load(): Promise<void> {
    this.loading = true;
    this.loadError = '';
    try {
      this.keys = await this.service.list();
    } catch (failed) {
      this.loadError = Refused.words(failed);
    } finally {
      this.loading = false;
    }
  }

  get canCreate(): boolean { return this.auth.can('settings:apikey:create'); }
  get canRevoke(): boolean { return this.auth.can('settings:apikey:revoke'); }

  get atLimit(): boolean { return this.keys.length >= this.limit; }

  /** The counts under the list. */
  get foot(): string {
    return `${this.keys.length} active · ${Math.max(0, this.limit - this.keys.length)} available`;
  }

  /** Opens the create dialog, which makes the key and shows it once. */
  async create(): Promise<void> {
    const made = await firstValueFrom(this.dialog.open(CreateKeyDialogComponent).afterClosed());
    if (made) this.keys = await this.service.list();
  }

  async revoke(key: ApiKey): Promise<void> {
    const sure = await this.confirm.ask({
      title: `Revoke “${key.name}”?`,
      body: 'Scripts using it stop on their next call. It cannot be turned back on.',
      confirm: 'Revoke',
      danger: true,
    });
    if (!sure) return;
    this.busyId = key.key_id;
    this.revokeError = '';
    try {
      const result = await this.service.revoke(key.key_id);
      if (result.error) {
        this.revokeError = result.error;
        return;
      }
      this.keys = this.keys.filter((each) => each.key_id !== key.key_id);
    } finally {
      this.busyId = '';
    }
  }

  // ── Words ───────────────────────────────────────────────────────────

  created(key: ApiKey): string {
    return `Created ${relativeDate(key.created_at)}`.trim();
  }

  used(key: ApiKey): string {
    return key.last_used_at ? `Last used ${relativeDate(key.last_used_at)}` : 'Never used';
  }

  expires(key: ApiKey): string {
    return `Ends ${dayDate(key.expires_at)}`;
  }

  /** The whole dates, for the row's tooltip. */
  datesInFull(key: ApiKey): string {
    return [fullDate(key.created_at), key.last_used_at ? fullDate(key.last_used_at) : ''].filter(Boolean).join(' · ');
  }
}
