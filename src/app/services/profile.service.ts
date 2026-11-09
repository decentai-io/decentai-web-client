import { Injectable } from '@angular/core';

import { AuthService, Person } from './auth.service';
import { Failure, RequestService } from './request.service';

/** What a person keeps of their own: anything the web client remembers
 *  for them, beside how they are notified (Settings:Notifications). */
export interface Preferences {
  /** What a new chat starts with: any of a chat's settings. */
  chat?: Record<string, unknown>;
  notifications?: { push?: boolean; email?: boolean; text?: boolean };
  [key: string]: unknown;
}

export interface Profile extends Person {
  preferences: Preferences;
}

/** A person of the organization, to share with or hand something to. */
export interface Peer {
  user_id: string;
  name: string;
  email: string;
}

export interface PeerGroup {
  group_id: string;
  name: string;
  /** The built-in groups, marked: Everyone holds every person. */
  everyone?: boolean;
  administrators?: boolean;
}

/** Whom the person may share with: the organization's active people, its
 *  groups, the Everyone group's id, and the ids of the groups they are in
 *  (Everyone aside), which are the only ones they may share into. */
export interface Peers {
  people: Peer[];
  /** Every group of the organization, Everyone aside. */
  groups: PeerGroup[];
  /** The Everyone group: sharing with it is sharing with the whole
   *  organization. */
  everyone: string;
  /** The groups the person is in. */
  mine: string[];
}

/**
 * Client for Account:Profile: the person's own name and preferences, and
 * whom they may share with.
 */
@Injectable({ providedIn: 'root' })
export class ProfileService {
  constructor(private request: RequestService, private auth: AuthService) {}

  async get(): Promise<Profile | null> {
    const r = await this.request.gateway('Account:Profile:get');
    return r.person ? { ...r.person, preferences: r.preferences ?? {} } : null;
  }

  async rename(name: string): Promise<{ person?: Person } & Failure> {
    return this.request.gateway('Account:Profile:update', { name });
  }

  /** Change some preferences. The API server keeps preferences whole, so
   *  the ones not named are read first and sent back as they were. */
  async savePreferences(changes: Preferences): Promise<{ person?: Person } & Failure> {
    const current = await this.request.gateway('Account:Profile:get');
    if (current.error) return current;
    return this.request.gateway('Account:Profile:update', {
      preferences: { ...(current.preferences ?? {}), ...changes },
    });
  }

  /** Whom the person may share with and hand things to. */
  async peers(): Promise<Peers> {
    const r = await this.request.gateway('Account:Profile:peers');
    const groups: PeerGroup[] = Array.isArray(r.groups) ? r.groups : [];
    const everyone = groups.find((group) => group.everyone)?.group_id ?? '';
    return {
      people: Array.isArray(r.people) ? r.people : [],
      groups: groups.filter((group) => group.group_id !== everyone),
      everyone,
      mine: this.auth.user?.groups ?? [],
    };
  }
}
