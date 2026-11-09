import { Injectable } from '@angular/core';

import { Failure, Refused, RequestService } from './request.service';

/** One lasting fact the assistant keeps about the person. */
export interface Memory {
  memory_id: string;
  text: string;
}

/**
 * Client for Settings:Memory: what the assistant keeps about the person,
 * saved from a chat's card or written here. At most 50, each at most 500
 * characters; past 50, the oldest goes.
 */
@Injectable({ providedIn: 'root' })
export class MemoryService {
  /** How many are kept at once. */
  static readonly MOST = 50;
  /** How long one may be. */
  static readonly TEXT = 500;

  constructor(private request: RequestService) {}

  /** Oldest first, as the assistant reads them. */
  async list(): Promise<Memory[]> {
    const r = await this.request.gateway('Settings:Memory:list');
    if (r.error) throw new Refused(r.error);
    return r.memories ?? [];
  }

  create(text: string): Promise<Partial<Memory> & Failure> {
    return this.request.gateway('Settings:Memory:create', { text });
  }

  update(memoryId: string, text: string): Promise<Failure> {
    return this.request.gateway('Settings:Memory:update', { memory_id: memoryId, text });
  }

  remove(memoryId: string): Promise<Failure> {
    return this.request.gateway('Settings:Memory:delete', { memory_id: memoryId });
  }
}
