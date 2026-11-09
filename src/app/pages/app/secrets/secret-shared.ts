import { AppRecord, RecordField, RecordShape } from 'src/app/services/records.service';

/**
 * What the list, a secret's own page and its form all read off a secret,
 * said once. A secret is a record of a resource an agent declares: its
 * plain fields are read back, its encrypted ones never are, only that
 * they are set.
 */

/** The plain value that says which thing a secret is for: the account
 *  it connected, a site, an address, a user. '' when none does. */
export function identifier(secret: AppRecord): string {
  const keys = secret.keys || {};
  if (keys['account']) return String(keys['account']);
  const telling = ['site', 'url', 'endpoint', 'host', 'account', 'username', 'user', 'email', 'domain', 'name'];
  for (const name of Object.keys(keys)) {
    if (telling.some((word) => name.toLowerCase().includes(word)) && keys[name]) return String(keys[name]);
  }
  return '';
}

/** What a secret is called in a list: its name, else what it is for, else
 *  what kind it is. */
export function secretTitle(secret: AppRecord, shape: RecordShape | null): string {
  return secret.name || identifier(secret) || shape?.label || secret.of?.resource || 'Secret';
}

/** A secret that connects an account through its provider rather than
 *  being typed, and whether it is connected yet. */
export function connects(shape: RecordShape | null): boolean {
  return !!shape?.oauth;
}

export function isConnected(secret: AppRecord): boolean {
  return !!secret.keys?.['account'] || 'access_token' in (secret.values || {});
}

/** A provider's id as a name: "google" is Google. */
export function providerName(shape: RecordShape | null): string {
  const id = shape?.oauth?.provider || '';
  return id ? id.charAt(0).toUpperCase() + id.slice(1) : 'the provider';
}

/** The fields a person types. A `form` field's answers come from a
 *  chat, where the agent asks them. */
export function editableFields(shape: RecordShape | null): RecordField[] {
  return (shape?.fields || []).filter((field) => field.type !== 'form');
}

/** Whether a field is kept encrypted, and so never shown back: all but
 *  those its resource keeps as plain `keys`. */
export function isEncrypted(field: RecordField): boolean {
  return field.storage !== 'keys';
}

/** One field of a secret, as its page lists it. */
export interface ShownField {
  label: string;
  /** The plain value; '' for an encrypted field. */
  value: string;
  /** Encrypted: said to be set or not, never shown. */
  hidden: boolean;
  set: boolean;
}

/** A secret's fields in its resource's order: plain ones as text,
 *  encrypted ones as set or not. A secret whose resource is no longer
 *  declared lists what it holds. */
export function shownFields(secret: AppRecord, shape: RecordShape | null): ShownField[] {
  const keys = secret.keys || {};
  const values = secret.values || {};
  const fields = shape?.fields?.length ? shape.fields
    : [...Object.keys(keys).map((name) => ({ name, type: 'string', storage: 'keys' } as RecordField)),
       ...Object.keys(values).map((name) => ({ name, type: 'secret', storage: 'values' } as RecordField))];
  return fields.map((field) => isEncrypted(field)
    ? { label: field.label || field.name, value: '', hidden: true, set: field.name in values }
    : { label: field.label || field.name, value: String(keys[field.name] ?? ''), hidden: false, set: field.name in keys });
}
