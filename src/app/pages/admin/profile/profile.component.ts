import { Component, OnInit } from '@angular/core';

import { dayDate } from 'src/app/components/ui/dates';
import { AuthService } from 'src/app/services/auth.service';
import { Profile, ProfileService } from 'src/app/services/profile.service';

/**
 * Admin → Account → Profile: your own name, your groups, and your
 * password.
 *
 * Nothing here is special-cased: the page is visible because
 * `account:profile:get` is allowed (by the built-in Member policy, which
 * Everyone gives), and an administrator can widen or withdraw that from
 * the Policies page like any other.
 */
@Component({
  selector: 'app-profile',
  standalone: false,
  templateUrl: './profile.component.html',
  styleUrl: '../admin-shared.css',
})
export class ProfileComponent implements OnInit {
  loading = true;
  profile: Profile | null = null;
  /** The names of the groups the person is in. */
  groups: string[] = [];

  name = '';
  /** Save was pressed: what the name still needs is said under it. */
  tried = false;
  saving = false;
  saveError = '';

  /** Changing the password: the one in use, and the one to use. */
  currentPassword = '';
  newPassword = '';
  triedPassword = false;
  changingPassword = false;
  passwordError = '';
  passwordChanged = false;

  constructor(
    private profiles: ProfileService,
    public auth: AuthService,
  ) {}

  async ngOnInit(): Promise<void> {
    const [profile, peers] = await Promise.all([this.profiles.get(), this.profiles.peers().catch(() => null)]);
    this.profile = profile;
    this.name = profile?.name ?? '';
    this.groups = (peers?.groups ?? []).filter((group) => profile?.groups.includes(group.group_id))
      .map((group) => group.name);
    this.loading = false;
  }

  get canRename(): boolean {
    return this.auth.can('account:profile:update');
  }

  get canChangePassword(): boolean {
    return this.auth.can('auth:password:change');
  }

  get dirty(): boolean {
    return this.name.trim() !== (this.profile?.name ?? '');
  }

  get lastSignIn(): string {
    return dayDate(this.profile?.last_login || '');
  }

  async save(): Promise<void> {
    this.tried = true;
    this.saveError = '';
    const name = this.name.trim();
    if (!name || !this.dirty || this.saving) return;

    this.saving = true;
    try {
      const result = await this.profiles.rename(name);
      if (result.error || !this.profile) {
        this.saveError = result.error ?? '';
        return;
      }
      this.profile = { ...this.profile, name: result.person?.name ?? name };
      this.name = this.profile.name;
      this.tried = false;
      // The shell shows the name too.
      await this.auth.refresh();
    } finally {
      this.saving = false;
    }
  }

  /** What the new password still needs, as the server checks it. */
  get newPasswordProblem(): string {
    if (this.newPassword.length < 10 || this.newPassword.length > 256) return 'A password is 10 to 256 characters.';
    return this.newPassword.trim() === this.newPassword ? '' : 'A password neither starts nor ends with a space.';
  }

  /** Every other session of the person ends; this one goes on. */
  async changePassword(): Promise<void> {
    this.triedPassword = true;
    this.passwordError = '';
    this.passwordChanged = false;
    if (!this.currentPassword || this.newPasswordProblem || this.changingPassword) return;

    this.changingPassword = true;
    try {
      const result = await this.auth.changePassword(this.currentPassword, this.newPassword);
      if (!result.ok) {
        this.passwordError = result.error || 'Your password was not changed.';
        return;
      }
      this.currentPassword = '';
      this.newPassword = '';
      this.triedPassword = false;
      this.passwordChanged = true;
    } finally {
      this.changingPassword = false;
    }
  }
}
