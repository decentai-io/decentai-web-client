import { WebhookDialogComponent } from './webhook-dialog.component';
import { curlExample, exampleBody, fieldNameProblem, fieldsOf, schemaOf } from './webhooks-shared';

describe('WebhookDialogComponent', () => {
  const ref = () => ({ close: jasmine.createSpy('close'), disableClose: false }) as any;

  function create(data: any = null, service: any = {}) {
    return new WebhookDialogComponent(
      ref(),
      data,
      { create: async () => ({}), update: async () => ({}), ...service } as any,
      { http: (path: string) => `https://engine.test/${path.replace(/^\/+/, '')}` } as any,
    );
  }

  it('refuses a field name a caller\'s JSON should not have', () => {
    const fields: any[] = [{ name: 'ticket_id' }, { name: 'ticket_id' }];
    expect(fieldNameProblem('Ticket', [])).not.toBe('');
    expect(fieldNameProblem('1st', [])).not.toBe('');
    expect(fieldNameProblem('ticket_id', fields)).toBe('Named twice.');
    expect(fieldNameProblem('ticket_id', [fields[0]])).toBe('');
  });

  it('turns the fields into a JSON Schema and back', () => {
    const fields: any[] = [
      { name: 'title', type: 'text', required: true, description: 'The ticket.' },
      { name: 'due', type: 'date', required: false, description: '' },
    ];
    const schema = schemaOf(fields);
    expect(schema).toEqual({
      type: 'object',
      properties: { title: { type: 'string', description: 'The ticket.' }, due: { type: 'string', format: 'date' } },
      required: ['title'],
      additionalProperties: false,
    });
    expect(fieldsOf(schema)).toEqual(fields);
    expect(fieldsOf({ type: 'object' })).toEqual([]);
  });

  it('makes a call with every field, and the signature headers when one is required', () => {
    const fields: any[] = [{ name: 'title', type: 'text' }, { name: 'count', type: 'number' }];
    expect(JSON.parse(exampleBody(fields))).toEqual({ title: '…', count: 1 });

    const plain = curlExample('https://x.test/hooks/w1', 's3cret', fields, false);
    expect(plain).toContain('Authorization: Bearer s3cret');
    expect(plain).not.toContain('X-DecentAI-Signature');
    const signed = curlExample('https://x.test/hooks/w1', 's3cret', fields, true);
    expect(signed).toContain('X-DecentAI-Signature');
    expect(signed).toContain('Idempotency-Key');
    expect(signed).not.toContain('s3cret');
  });

  it('sends only what changed when editing', () => {
    const webhook: any = {
      webhook_id: 'w1', name: 'Tickets', instruction: 'File it', require_signature: false, trust: 1,
      fields: schemaOf([{ name: 'title', type: 'text', required: true, description: '' }]),
    };
    const dialog = create({ webhook });

    expect(dialog.draft()).toEqual({});
    dialog.name = 'Support tickets';
    dialog.trust = 2;
    expect(dialog.draft()).toEqual({ name: 'Support tickets', trust: 2 });
  });

  it('shows the secret once it is made, and asks before closing on one not copied', async () => {
    const made: any = { webhook_id: 'w1', name: 'Builds', path: '/hooks/w1', fields: { type: 'object' } };
    const dialog = create(null, { create: async () => ({ webhook: made, secret: 's3cret' }) });
    dialog.name = 'Builds';
    dialog.instruction = 'Tell me what broke.';

    await dialog.save();
    expect(dialog.made).toBe(made);
    expect(dialog.url).toContain('/hooks/w1');

    dialog.done();
    expect(dialog.warned).toBeTrue();
    expect(dialog.dialog.close).not.toHaveBeenCalled();
    dialog.done();
    expect(dialog.dialog.close).toHaveBeenCalledWith(made);
  });
});
