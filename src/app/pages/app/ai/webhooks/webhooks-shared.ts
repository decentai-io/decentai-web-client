import { Choice } from 'src/app/components/ui/radio-keys';
import { WebhookSchema } from 'src/app/services/webhooks.service';

/**
 * What the Webhooks page and its dialogs say, kept in one place: the
 * fields a caller posts and the JSON Schema they make, and the example
 * a caller copies.
 */

/** What a field of an incoming event may be. */
export type WebhookFieldType = 'text' | 'number' | 'boolean' | 'date' | 'list' | 'object';

/** One field a caller posts, as the dialog edits it. */
export interface WebhookField {
  name: string;
  type: WebhookFieldType;
  required: boolean;
  description: string;
}

/** A field's name: what a JSON key the assistant reads should be. */
export const FIELD_NAME = /^[a-z][a-z0-9_]{0,63}$/;

export const FIELD_TYPES: Choice<WebhookFieldType>[] = [
  { value: 'text', name: 'Text' },
  { value: 'number', name: 'Number' },
  { value: 'boolean', name: 'Yes or no' },
  { value: 'date', name: 'Date' },
  { value: 'list', name: 'List' },
  { value: 'object', name: 'Object' },
];

/** Each type as JSON Schema says it. */
const SCHEMA_TYPES: Record<WebhookFieldType, { type: string; format?: string }> = {
  text: { type: 'string' },
  number: { type: 'number' },
  boolean: { type: 'boolean' },
  date: { type: 'string', format: 'date' },
  list: { type: 'array' },
  object: { type: 'object' },
};

/** Why a field's name is refused, or ''. */
export function fieldNameProblem(name: string, fields: WebhookField[]): string {
  const trimmed = name.trim();
  if (!trimmed) return 'Give the field a name.';
  if (!FIELD_NAME.test(trimmed)) return 'Lowercase letters, digits and _, starting with a letter.';
  if (fields.filter((field) => field.name.trim() === trimmed).length > 1) return 'Named twice.';
  return '';
}

/** The fields as the JSON Schema a body is checked against: one object
 *  with those fields and nothing else. */
export function schemaOf(fields: WebhookField[]): WebhookSchema {
  const properties: NonNullable<WebhookSchema['properties']> = {};
  for (const field of fields) {
    properties[field.name] = { ...SCHEMA_TYPES[field.type], ...(field.description ? { description: field.description } : {}) };
  }
  const required = fields.filter((field) => field.required).map((field) => field.name);
  return { type: 'object', properties, ...(required.length ? { required } : {}), additionalProperties: false };
}

/** A schema read back into fields, as far as the dialog can say them:
 *  a property of another shape is read as an object. */
export function fieldsOf(schema: WebhookSchema | null | undefined): WebhookField[] {
  const required = schema?.required ?? [];
  return Object.entries(schema?.properties ?? {}).map(([name, property]) => {
    const type = (Object.keys(SCHEMA_TYPES) as WebhookFieldType[]).find((each) =>
      SCHEMA_TYPES[each].type === property?.type && SCHEMA_TYPES[each].format === property?.format) ?? 'object';
    return { name, type, required: required.includes(name), description: property?.description ?? '' };
  });
}

/** What an event's body could hold for a field of this type. */
function exampleValue(type: WebhookFieldType): unknown {
  switch (type) {
    case 'number': return 1;
    case 'boolean': return true;
    case 'date': return new Date().toISOString().slice(0, 10);
    case 'list': return [];
    case 'object': return {};
    default: return '…';
  }
}

/** A body that fits the fields: every one of them, with a value of its
 *  type; laid out over lines when `indent` is given. */
export function exampleBody(fields: WebhookField[], indent?: number): string {
  const body: Record<string, unknown> = {};
  for (const field of fields) body[field.name] = exampleValue(field.type);
  return JSON.stringify(body, null, indent);
}

/** A call a person can paste into a terminal. A webhook that requires a
 *  signature is called with the signature alone, made as the HMAC line
 *  says, so the secret never travels; otherwise the secret is the
 *  bearer, in double quotes, so `$WEBHOOK_SECRET` may stand for it. */
export function curlExample(url: string, secret: string, fields: WebhookField[], signed: boolean): string {
  const lines = [`curl -X POST '${url}'`];
  if (!signed) lines.push(`  -H "Authorization: Bearer ${secret}"`);
  lines.push(`  -H 'Content-Type: application/json'`);
  if (signed) {
    lines.push(`  -H 'Idempotency-Key: <unique per event>'`);
    lines.push(`  -H 'X-DecentAI-Timestamp: <unix seconds>'`);
    lines.push(`  -H 'X-DecentAI-Signature: <hex>'`);
  }
  lines.push(`  -d '${exampleBody(fields).replace(/'/g, `'\\''`)}'`);
  return lines.join(' \\\n');
}

/** How a signature is made. */
export const HMAC_LINE =
  'signature = HMAC-SHA256(secret, "<timestamp>.<Idempotency-Key>.<body>") as hex, in X-DecentAI-Signature, '
  + 'with the timestamp (unix seconds, within five minutes) in X-DecentAI-Timestamp; each signature is taken once.';

/** Copies, and says whether it could. */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
