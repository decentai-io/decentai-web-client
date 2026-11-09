import { Injectable } from '@angular/core';

import { Failure, Refused, RequestService } from './request.service';

/** One of the person's keys, as the page sees it: never the secret. */
export interface ApiKey {
  key_id: string;
  name: string;
  /** The first characters, enough to tell keys apart. */
  shown: string;
  expires_at: string;
  created_at: string;
  last_used_at: string | null;
}

/** What making a key answers: the only time the secret is in the open. */
export interface MadeApiKey extends ApiKey {
  key: string;
}

/**
 * Client for Settings:ApiKey: a person's own keys for their scripts. A
 * key acts as its owner, with their rights, until it expires or is
 * revoked. Shown once when made; revoking is the only change.
 */
@Injectable({ providedIn: 'root' })
export class ApiKeysService {
  /** The most keys a person holds at once, and the longest one lasts. */
  static readonly MOST = 20;
  static readonly DAYS_MAX = 365;

  constructor(private request: RequestService) {}

  async list(): Promise<ApiKey[]> {
    const r = await this.request.gateway('Settings:ApiKey:list');
    if (r.error) throw new Refused(r.error);
    return Array.isArray(r.keys) ? r.keys : [];
  }

  create(name: string, days: number): Promise<MadeApiKey & Failure> {
    return this.request.gateway<MadeApiKey>('Settings:ApiKey:create', { name, days });
  }

  revoke(keyId: string): Promise<Failure> {
    return this.request.gateway('Settings:ApiKey:revoke', { key_id: keyId });
  }
}
