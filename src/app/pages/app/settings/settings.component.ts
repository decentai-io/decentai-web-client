import { Component, OnDestroy, OnInit } from '@angular/core';

import { ServerPage, ServerPages } from 'src/app/components/ui/paging';
import { AuthService } from 'src/app/services/auth.service';
import { PeerGroup, ProfileService } from 'src/app/services/profile.service';
import { LlmConnection, LlmCounts, LlmProvider, SettingsLlmService } from 'src/app/services/settings-llm.service';
import { DataPageBase } from '../data-page-base';

/**
 * Settings › Model providers: reads what the providers list is drawn
 * from (the organization's connections, the platform's catalog of
 * providers, and the groups a connection is shared with) and hands it to
 * <app-model-providers>, which is the page. The connections are paged
 * and searched on the API server.
 */
@Component({
  selector: 'app-settings',
  standalone: false,
  templateUrl: './settings.component.html',
})
export class SettingsComponent extends DataPageBase implements OnInit, OnDestroy {
  loading = true;

  /** The connections the page shows, twenty at a time: those this
   *  person may use, or, for an administrator, every one of the
   *  organization. */
  readonly pages = new ServerPages<LlmConnection>(20, (after, limit) => this.read(after, limit));
  /** How many there are, unsearched, and the server's numbers of them. */
  all = 0;
  counts: LlmCounts | null = null;
  /** The search, sent to the server. */
  query = '';
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
    const [, providers, peers] = await Promise.all([
      this.pages.first(),
      this.service.providers(),
      this.profiles.peers(),
    ]);
    if (this.pages.error) this.fail(this.pages.error);
    this.providers = providers;
    this.groups = [
      ...(peers.everyone ? [{ group_id: peers.everyone, name: 'Everyone' }] : []),
      ...peers.groups,
    ];
    this.loading = false;
  }

  ngOnDestroy(): void {
    this.pages.cancel();
  }

  get connections(): LlmConnection[] {
    return this.pages.rows;
  }

  /** Read the connections again: one was added, changed or removed. */
  async reload(): Promise<void> {
    await this.pages.reload();
  }

  /** A new search: from the first page, once the typing stops. */
  search(query: string): void {
    this.query = query;
    this.pages.search();
  }

  private async read(after: string, limit: number): Promise<ServerPage<LlmConnection>> {
    const page = await this.service.page(after, limit, { q: this.query, all: this.auth.can('settings:llm:create') });
    if (!page.error) {
      if (!this.query.trim()) this.all = page.total;
      this.counts = page.counts;
    }
    return page;
  }
}
