import { Component, Inject, OnInit } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';

import { Choice } from 'src/app/components/ui/radio-keys';
import { OauthConnectService } from 'src/app/services/oauth.service';
import { AppRecord, RecordField, RecordShape, RecordsService } from 'src/app/services/records.service';
import { connects, editableFields, isEncrypted, providerName } from './secret-shared';

/** What the page hands the dialog. */
export interface SecretFormData {
  /** The secret resources the person's agents declare. */
  shapes: RecordShape[];
  /** The secret to change; absent to add one. */
  secret?: AppRecord;
  /** Add one of this resource, with no choosing: an agent's own page
   *  knows which it needs. */
  shape?: RecordShape;
}

/** What it closes with when something was done: what the page says. */
export interface SecretFormResult {
  notice: string;
  /** The secret made or changed, to open it. */
  id: string;
}

/** A group of resources in the first step: the agent they are for. */
interface ShapeGroup {
  agent: string;
  items: RecordShape[];
}

/**
 * Adding a secret, and changing one: one dialog.
 *
 * Adding is two steps. First, what it is for: the secret resources the
 * person's agents declare, grouped by agent, each saying whether it is
 * filled in or connected. Then the form made from its fields; for an
 * account, once the secret is made, the provider's sign-in in a window
 * of its own.
 *
 * Encrypted fields are write-only: typed here and never shown back, so
 * on a change a blank one means "keep what is stored".
 */
@Component({
  selector: 'app-secret-form',
  standalone: false,
  templateUrl: './secret-form.component.html',
  styleUrl: './secret-form.component.css',
})
export class SecretFormComponent implements OnInit {
  step: 'pick' | 'form' | 'connect' = 'pick';
  query = '';

  shape: RecordShape | null = null;
  /** The secret being changed, or the one just made to connect. */
  editing: AppRecord | null = null;
  fields: Record<string, any> = {};
  /** What the person calls it; '' for no name. */
  name = '';
  /** Save was pressed: what is missing is said under its field. */
  tried = false;
  saving = false;
  problem = '';
  /** The secret made, waiting for its account to be connected. */
  private made: AppRecord | null = null;

  private choicesByField = new WeakMap<RecordField, Choice[]>();

  constructor(
    @Inject(MAT_DIALOG_DATA) public data: SecretFormData,
    private dialogRef: MatDialogRef<SecretFormComponent, SecretFormResult | null>,
    private service: RecordsService,
    private oauth: OauthConnectService,
  ) {}

  ngOnInit(): void {
    const secret = this.data.secret;
    if (secret) {
      this.editing = secret;
      this.name = secret.name || '';
      const shape = this.data.shapes.find((candidate) =>
        candidate.agent === secret.of?.agent && candidate.id === secret.of?.resource) ?? null;
      if (!shape) {
        this.problem = 'Its agent no longer declares this kind of secret, so it cannot be changed here.';
        this.step = 'form';
        return;
      }
      this.choose(shape);
      for (const field of this.formFields) {
        // Write-only: blank means keep.
        if (!isEncrypted(field)) this.fields[field.name] = secret.keys[field.name] ?? '';
      }
      return;
    }
    if (this.data.shape) this.choose(this.data.shape);
  }

  // ── Step one: which resource ────────────────────────────────────────

  /** The resources that match the search, grouped by the agent each is
   *  for: the question is "a secret for WHICH agent?". */
  get groups(): ShapeGroup[] {
    const query = this.query.trim().toLowerCase();
    const groups = new Map<string, RecordShape[]>();
    for (const shape of this.data.shapes) {
      if (query && !`${shape.label} ${shape.description} ${shape.agent_name}`.toLowerCase().includes(query)) continue;
      groups.set(shape.agent_name, [...(groups.get(shape.agent_name) || []), shape]);
    }
    return [...groups.entries()]
      .map(([agent, items]) => ({ agent, items: items.sort((a, b) => (a.label || a.id).localeCompare(b.label || b.id)) }))
      .sort((a, b) => a.agent.localeCompare(b.agent));
  }

  /** What choosing it leads to, said on its row. */
  aboutOf(shape: RecordShape): string {
    const count = editableFields(shape).length;
    const fields = count ? `${count} ${count === 1 ? 'field' : 'fields'}` : '';
    return connects(shape) ? [`Sign in with ${providerName(shape)}`, fields].filter(Boolean).join(' · ') : fields;
  }

  /** What it is, in its first sentence: the rest is the row's tooltip. */
  firstSentenceOf(shape: RecordShape): string {
    const text = (shape.description || '').trim();
    const found = /^(.+?[.!?])(\s|$)/.exec(text);
    return found ? found[1] : text;
  }

  choose(shape: RecordShape): void {
    this.shape = shape;
    this.problem = '';
    this.tried = false;
    this.fields = {};
    for (const field of this.formFields) this.fields[field.name] = '';
    this.step = 'form';
  }

  backToPick(): void {
    if (this.saving) return;
    this.step = 'pick';
    this.shape = null;
  }

  // ── The form ────────────────────────────────────────────────────────

  get formFields(): RecordField[] {
    return editableFields(this.shape);
  }

  isEncrypted(field: RecordField): boolean {
    return isEncrypted(field);
  }

  optionsOf(field: RecordField): Choice[] {
    let choices = this.choicesByField.get(field);
    if (!choices) {
      choices = (field.options || []).map((option) => ({ value: option, name: option }));
      this.choicesByField.set(field, choices);
    }
    return choices;
  }

  helpOf(field: RecordField): string {
    if (field.type === 'object') return 'Written as JSON.';
    if (!isEncrypted(field)) return '';
    return this.editing ? 'Stored and never shown. Left empty, it is kept.' : 'Encrypted when saved, and never shown again.';
  }

  /** What a field still needs, or why it cannot be sent; '' when nothing.
   *  On a change, a stored encrypted value is kept when its box is blank. */
  missing(field: RecordField): string {
    const value = this.fields[field.name];
    if (value === '' || value === null || value === undefined) {
      if (!field.required || (this.editing && isEncrypted(field))) return '';
      return field.type === 'select' ? 'Choose one.' : `Enter ${field.label || field.name}.`;
    }
    if (field.type === 'number' && Number.isNaN(Number(value))) return `${field.label || field.name} is a number.`;
    if (field.type === 'object') {
      try { JSON.parse(String(value)); } catch { return 'Not valid JSON.'; }
    }
    return '';
  }

  /** What the form sends: a blank box is no change. */
  private built(): Record<string, any> {
    const built: Record<string, any> = {};
    for (const field of this.formFields) {
      const value = this.fields[field.name];
      if (value === '' || value === null || value === undefined) continue;
      built[field.name] = field.type === 'number' ? Number(value) : field.type === 'object' ? JSON.parse(String(value)) : value;
    }
    return built;
  }

  async save(): Promise<void> {
    const shape = this.shape;
    if (!shape || this.saving) return;
    this.tried = true;
    this.problem = '';
    if (this.formFields.some((field) => this.missing(field))) return;

    this.saving = true;
    this.dialogRef.disableClose = true;
    try {
      const result = this.editing
        ? await this.service.update('secret', this.editing.record_id, {
          fields: this.built(), ...(this.name.trim() !== (this.editing.name || '') ? { name: this.name.trim() } : {}),
        })
        : await this.service.create('secret', { agent: shape.agent, resource: shape.id }, this.built(), this.name.trim());
      if (result.error || !result.record) {
        this.problem = result.error || 'The secret was not saved.';
        return;
      }
      if (!this.editing && connects(shape)) {
        // The sign-in opens on a click of its own: one that waited for
        // the save would be blocked by the browser.
        this.made = result.record;
        this.step = 'connect';
        return;
      }
      this.dialogRef.close({ notice: this.editing ? 'Secret updated.' : 'Secret created.', id: result.record.record_id });
    } finally {
      this.saving = false;
      this.dialogRef.disableClose = false;
    }
  }

  // ── Connecting an account ───────────────────────────────────────────

  get provider(): string {
    return providerName(this.shape);
  }

  async connect(): Promise<void> {
    if (!this.made || this.saving) return;
    this.saving = true;
    this.problem = '';
    const result = await this.oauth.connect(this.made.record_id);
    this.saving = false;
    if (result.error) {
      this.problem = result.error;
      return;
    }
    this.dialogRef.close({ notice: `${this.provider} account connected.`, id: this.made.record_id });
  }

  /** Not now: what was made is still made. */
  close(): void {
    if (this.saving && this.step !== 'connect') return;
    this.dialogRef.close(this.made ? { notice: 'Secret created. Connect its account from its page.', id: this.made.record_id } : null);
  }
}
