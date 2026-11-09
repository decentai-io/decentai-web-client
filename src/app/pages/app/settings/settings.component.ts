import { Component, OnInit } from '@angular/core';

import { AuthService } from 'src/app/services/auth.service';
import { PeerGroup, ProfileService } from 'src/app/services/profile.service';
import { LlmConnection, LlmProvider, SettingsLlmService } from 'src/app/services/settings-llm.service';
import { DataPageBase } from '../data-page-base';

/**
 * Settings › Model providers: reads what the providers list is drawn
 * from (the organization's connections, the platform's catalog of
 * providers, and the groups a connection is shared with) and hands it to
 * <app-model-providers>, which is the page.
 */
@Component({
  selector: 'app-settings',
  standalone: false,
  templateUrl: './settings.component.html',
})
export class SettingsComponent extends DataPageBase implements OnInit {
  loading = true;

  /** The connections the page shows: those this person may use, or,
   *  for an administrator, every one of the organization. */
  connections: LlmConnection[] = [];
  /** The groups a connection may be shared with, Everyone first. */
  groups: PeerGroup[] = [];

  /** The platform's catalog of providers, as the API server serves it:
   *  the page keeps no list of its own to fall out of step with it. */
  providers: LlmProvider[] = [];

  constructor(
    private service: SettingsLlmService,
    private profiles: ProfileService,
    public auth: AuthService,
  ) {
    super();
  }

  async ngOnInit(): Promise<void> {
    const [connections, providers, peers] = await Promise.all([
      this.list(),
      this.service.providers(),
      this.profiles.peers(),
    ]);
    this.connections = connections;
    this.providers = providers;
    this.groups = [
      ...(peers.everyone ? [{ group_id: peers.everyone, name: 'Everyone' }] : []),
      ...peers.groups,
    ];
    this.loading = false;
  }

  /** Read the connections again: one was added, changed or removed. */
  async reload(): Promise<void> {
    this.connections = await this.list();
  }

  private list(): Promise<LlmConnection[]> {
    return this.service.list(this.auth.can('settings:llm:create'));
  }
}
