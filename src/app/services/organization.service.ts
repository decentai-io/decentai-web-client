import { Injectable } from '@angular/core';

import { Refused, RequestService } from './request.service';

export interface Organization {
  org_id: string;
  name: string;
  created_at?: string | null;
}

/**
 * Client for IAM:Organization: the caller's own organization. Renaming is
 * the only change made through this door.
 */
@Injectable({ providedIn: 'root' })
export class OrganizationService {
  constructor(private request: RequestService) {}

  async get(): Promise<Organization | null> {
    const r = await this.request.gateway('IAM:Organization:get');
    if (r.error) throw new Refused(r.error);  // the page says why, a picker falls back
    return r.organization ?? null;
  }

  rename(name: string) {
    return this.request.gateway<{ organization: Organization }>('IAM:Organization:rename', { name });
  }
}
