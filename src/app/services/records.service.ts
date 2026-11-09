import { Injectable } from '@angular/core';

import { Failure, Refused, RequestService } from './request.service';

/** The three kinds of record, each under its own endpoints. */
export type RecordKind = 'secret' | 'data' | 'file';

/** Which agent's resource a record is of, or serves. */
export interface RecordOf {
  agent: string;
  resource: string;
}

export interface RecordOwner {
  users: string[];
  groups: string[];
}

/** One record, as a person sees it (`Records.public`): a secret's values
 *  are there by name only, as null; a datum's are read back whole. */
export interface AppRecord {
  record_id: string;
  kind: RecordKind;
  /** A file's file name; any other record's, the words its person gave
   *  it, '' for none. */
  name: string;
  /** The agent and resource it was made for; null for a person's own file. */
  of: RecordOf | null;
  owner: RecordOwner;
  /** The agents that may use it, each with the resource it serves. */
  agents: RecordOf[];
  /** Plain values, which lists filter on. */
  keys: Record<string, any>;
  /** Encrypted values: a secret's are null. */
  values: Record<string, any>;
  /** For a file: its name, type and size. */
  file: { name: string; type: string; size: number; digest?: string } | null;
  created_by: string;
  /** Handed to another member, who has not yet accepted it. */
  handing: { to: string; by: string } | null;
  created_at?: string | null;
  updated_at?: string | null;
}

/** One field of a resource, as an agent's manifest declares it. */
export interface RecordField {
  name: string;
  label?: string;
  type: 'string' | 'number' | 'select' | 'object' | 'secret' | 'form';
  storage?: 'keys' | 'values';
  required?: boolean;
  options?: string[];
}

/** One resource an agent the person may use declares, of a kind
 *  (`shapes`): what a new record may be made of. */
export interface RecordShape {
  agent: string;
  agent_name: string;
  id: string;
  label?: string;
  description?: string;
  binding?: { cardinality?: 'one' | 'many'; required?: boolean };
  /** What a person may do on it directly: `create`, `update`. */
  user_access?: string[];
  fields?: RecordField[];
  /** A secret connected through a provider rather than typed. */
  oauth?: { provider: string; [key: string]: unknown };
  /** A file resource's limits. */
  constraints?: { mime_types?: string[]; max_size_mb?: number };
}

/** What a list holds: the person's records and those shared with them,
 *  and those handed to them, waiting to be accepted. */
export interface RecordList {
  records: AppRecord[];
  handed: AppRecord[];
}

/** The changes `update` takes; whatever is left out stays. */
export interface RecordChanges {
  fields?: Record<string, any>;
  /** Its name; a file's renames the file. */
  name?: string;
  owner?: RecordOwner;
  agents?: RecordOf[];
}

/**
 * Client for a person's records, of the three kinds: secrets
 * (Secrets:Secret), data (Data:Record) and files (Files:File). One shape
 * for all three; a file is made by uploading it (FilesService).
 */
@Injectable({ providedIn: 'root' })
export class RecordsService {
  static readonly DOMAIN: Record<RecordKind, string> = {
    secret: 'Secrets:Secret', data: 'Data:Record', file: 'Files:File',
  };

  /** The most a list answers with at once. */
  static readonly PAGE = 100;

  constructor(private request: RequestService) {}

  /** Every record of a kind the person may see, a page at a time until
   *  the last; narrowed to one resource's, or by plain values. A refusal
   *  is thrown, as a `Refused`. */
  async list(kind: RecordKind, narrow: { of?: RecordOf; keys?: Record<string, any> } = {}): Promise<RecordList> {
    const found: RecordList = { records: [], handed: [] };
    let after = '';
    do {
      const page = await this.call<RecordList>(kind, 'list', { ...narrow, after, limit: RecordsService.PAGE });
      if (page.error) throw new Refused(page.error);
      found.records.push(...(page.records ?? []));
      found.handed = page.handed ?? [];
      after = page.records?.length === RecordsService.PAGE ? page.records[page.records.length - 1].record_id : '';
    } while (after);
    return found;
  }

  /** One record the person may see, or null. */
  async get(kind: RecordKind, recordId: string): Promise<AppRecord | null> {
    const r = await this.call<{ record: AppRecord }>(kind, 'get', { record_id: recordId });
    return r.record ?? null;
  }

  /** The resources of this kind that the agents the person may use declare. */
  async shapes(kind: RecordKind): Promise<RecordShape[]> {
    const r = await this.call<{ shapes: RecordShape[] }>(kind, 'shapes');
    return r.shapes ?? [];
  }

  /** Make a secret or a datum of a resource an agent declares, named or not. */
  create(kind: 'secret' | 'data', of: RecordOf, fields: Record<string, any>, name = '') {
    return this.call<{ record: AppRecord }>(kind, 'create', { of, fields, ...(name ? { name } : {}) });
  }

  /** Change a record of the person's own: its fields, a file's name, whom
   *  it is shared with, and the agents it serves. */
  update(kind: RecordKind, recordId: string, changes: RecordChanges) {
    return this.call<{ record: AppRecord }>(kind, 'update', { record_id: recordId, ...changes });
  }

  /** Hand a record to another member, who accepts it before it is theirs. */
  transfer(kind: RecordKind, recordId: string, userId: string) {
    return this.call<{ record: AppRecord }>(kind, 'transfer', { record_id: recordId, user_id: userId });
  }

  /** Take back a record the person is handing on, before it is accepted. */
  withdraw(kind: RecordKind, recordId: string) {
    return this.call<{ record: AppRecord }>(kind, 'withdraw', { record_id: recordId });
  }

  /** Accept, or decline, a record handed to the person. */
  accept(kind: RecordKind, recordId: string, accept: boolean) {
    return this.call<{ record: AppRecord }>(kind, 'accept', { record_id: recordId, accept });
  }

  remove(kind: RecordKind, recordId: string) {
    return this.call<object>(kind, 'delete', { record_id: recordId });
  }

  private call<T>(kind: RecordKind, action: string, data: any = {}): Promise<Partial<T> & Failure> {
    return this.request.gateway<Partial<T>>(`${RecordsService.DOMAIN[kind]}:${action}`, data);
  }
}
