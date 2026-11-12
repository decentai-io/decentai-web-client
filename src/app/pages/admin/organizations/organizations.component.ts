import { Component, OnInit } from '@angular/core';
import { Refused } from 'src/app/services/request.service';

import { dayDate } from 'src/app/components/ui/dates';
import { AuthService } from 'src/app/services/auth.service';
import { Organization, OrganizationService } from 'src/app/services/organization.service';
import { settingsPageOpen, settingsPages } from 'src/app/website/config/config';

/** A page that lives inside the organization, as a card on its page. */
interface Place {
  name: string;
  line: string;
  icon: string;
  link: string;
  /** Any one of these opens it. */
  actions: string[];
}

/** The pages inside the organization, in the order they are cards. */
const PLACES: Place[] = [
  { name: 'Users', line: 'Who is in it, invited, or held back.', icon: 'users', link: '/admin/users', actions: ['iam:user:list'] },
  { name: 'Groups', line: 'What gives people their policies.', icon: 'users', link: '/admin/groups', actions: ['iam:group:list'] },
  { name: 'Policies', line: 'What is allowed, denied or asked first.', icon: 'scroll-text', link: '/admin/policies', actions: ['iam:policy:list'] },
];

/**
 * Admin → Organization.
 *
 * The person's own organization. Its name is the only thing to manage
 * here: there is no create, no delete, no list.
 */
@Component({
  selector: 'app-admin-organizations',
  standalone: false,
  templateUrl: './organizations.component.html',
  styleUrl: '../admin-shared.css',
})
export class OrganizationsComponent implements OnInit {
  loading = true;
  organization: Organization | null = null;

  name = '';
  /** Save was pressed: what the name still needs is said under it. */
  tried = false;
  saving = false;
  saveError = '';
  /** Why the organization could not be read. */
  loadError = '';

  constructor(
    private organizations: OrganizationService,
    public auth: AuthService,
  ) {}

  async ngOnInit(): Promise<void> {
    try {
      this.organization = await this.organizations.get();
      this.name = this.organization?.name ?? '';
    } catch (refused: any) {
      this.loadError = Refused.words(refused);
    } finally {
      this.loading = false;
    }
  }

  /** The cards under the name: the pages inside it this person may
   *  open, and Settings when any of its pages opens for them. */
  get places(): Place[] {
    const can = (action: string) => this.auth.can(action);
    const places = PLACES.filter((place) => place.actions.some(can));
    if (settingsPages.some((page) => settingsPageOpen(page, can))) {
      places.push({ name: 'Settings', line: 'How the platform is set up here, and for you.', icon: 'settings', link: '/settings', actions: [] });
    }
    return places;
  }

  get canRename(): boolean {
    return this.auth.can('iam:organization:rename');
  }

  get dirty(): boolean {
    return this.name.trim() !== (this.organization?.name ?? '');
  }

  get created(): string {
    return dayDate(this.organization?.created_at || '');
  }

  async save(): Promise<void> {
    this.tried = true;
    this.saveError = '';
    const name = this.name.trim();
    if (!name || !this.dirty || this.saving) return;

    this.saving = true;
    try {
      const result = await this.organizations.rename(name);
      if (result.error) {
        this.saveError = result.error;
        return;
      }
      this.organization = result.organization;
      this.name = result.organization.name;
      this.tried = false;
      // The session carries the organization's name too.
      await this.auth.refresh();
    } finally {
      this.saving = false;
    }
  }
}
