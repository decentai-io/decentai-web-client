import { Injectable } from '@angular/core';

import { InstalledAgent } from './agents.service';
import { Failure, Refused, RequestService } from './request.service';

/** Where a provider is: consent, tokens, and whose account it is
 *  (empty where the provider says so in the token response). */
export interface OauthEndpoints {
  authorize_url: string;
  token_url: string;
  identity_url: string;
}

/** One app the organization registered with a provider. The client
 *  secret is never shown again: `secret` says only whether one is kept. */
export interface OauthApp {
  app_id: string;
  provider: string;
  client_id: string;
  /** The provider's addresses this registration settles; an agent
   *  naming others cannot connect through it. */
  endpoints: OauthEndpoints;
  secret: boolean;
}

/** A provider an installed agent's secret connects through, and which
 *  agents need it: what the page offers before anything is typed. */
export interface DeclaredProvider {
  provider: string;
  needed_by: string[];
  /** The addresses the agents name for it — more than one set when
   *  they disagree. */
  endpoints: (OauthEndpoints & { named_by: string[] })[];
}

/** The providers installed agents' secrets connect through, from their
 *  manifests' `oauth` blocks. */
export function declaredProviders(agents: InstalledAgent[]): DeclaredProvider[] {
  const found = new Map<string, DeclaredProvider>();
  for (const agent of agents) {
    for (const secret of agent.manifest?.resources?.secrets ?? []) {
      const oauth = secret.oauth as { provider: string; authorize_url?: string; token_url?: string;
                                      identity?: { url?: string } } | undefined;
      if (!oauth?.provider) continue;
      const declared = found.get(oauth.provider) ?? { provider: oauth.provider, needed_by: [], endpoints: [] };
      found.set(oauth.provider, declared);
      if (!declared.needed_by.includes(agent.name)) declared.needed_by.push(agent.name);
      const named = { authorize_url: oauth.authorize_url ?? '', token_url: oauth.token_url ?? '',
                      identity_url: oauth.identity?.url ?? '' };
      const same = declared.endpoints.find((set) => set.authorize_url === named.authorize_url
        && set.token_url === named.token_url && set.identity_url === named.identity_url);
      if (same) {
        if (!same.named_by.includes(agent.name)) same.named_by.push(agent.name);
      } else {
        declared.endpoints.push({ ...named, named_by: [agent.name] });
      }
    }
  }
  return [...found.values()];
}

/** Client for Settings:Oauth: the organization's connected apps, one per
 *  provider, so members can connect accounts with a click. */
@Injectable({ providedIn: 'root' })
export class SettingsOauthService {
  constructor(private request: RequestService) {}

  /** The apps, and the address each provider sends a person back to. */
  async list(): Promise<{ apps: OauthApp[]; redirect: string }> {
    const r = await this.request.gateway('Settings:Oauth:list');
    if (r.error) throw new Refused(r.error);
    return { apps: r.apps ?? [], redirect: String(r.redirect || '') };
  }

  create(draft: { provider: string; client_id: string; client_secret: string; endpoints: OauthEndpoints }):
    Promise<{ app?: OauthApp } & Failure> {
    return this.request.gateway('Settings:Oauth:create', draft);
  }

  /** A secret left out keeps the one kept; changed endpoints need it again. */
  update(appId: string, draft: { client_id: string; client_secret?: string; endpoints: OauthEndpoints }):
    Promise<{ app?: OauthApp } & Failure> {
    return this.request.gateway('Settings:Oauth:update', { app_id: appId, ...draft });
  }

  remove(appId: string): Promise<Failure> {
    return this.request.gateway('Settings:Oauth:delete', { app_id: appId });
  }
}
