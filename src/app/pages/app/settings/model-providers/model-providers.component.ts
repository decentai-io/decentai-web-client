import { Component, EventEmitter, Input, Output, TemplateRef, ViewChild } from '@angular/core';
import { MatDialog, MatDialogRef } from '@angular/material/dialog';

import { ServerPages } from 'src/app/components/ui/paging';
import { Choice } from 'src/app/components/ui/radio-keys';
import { AuthService } from 'src/app/services/auth.service';
import { ConfirmService } from 'src/app/services/confirm.service';
import { PeerGroup } from 'src/app/services/profile.service';
import {
  LlmConnection, LlmConnectionDraft, LlmCounts, LlmModel, LlmProvider, SettingsLlmService,
} from 'src/app/services/settings-llm.service';
import { DataPageBase } from '../../data-page-base';

/** What the form edits. */
interface Draft {
  name: string;
  provider: string;
  address: string;
  /** Blank on an edit keeps the key kept. */
  key: string;
  /** The model a chat uses unless its person picks another: the
   *  connection's first. */
  model: string;
  /** The other models people may pick. */
  others: string[];
  groups: string[];
}

/** What is still missing from the form, and the field it belongs to. */
interface Missing {
  /** 'address', 'key', 'model', 'name', 'provider', or 'blank:<its name>'. */
  field: string;
  message: string;
}

type Sharing = 'everyone' | 'some';

/**
 * Settings › Model providers: the organization's connections to model
 * providers, each a provider, its address and its key, the models people
 * may pick from it (the first is what a chat uses unless its person picks
 * another), and the groups whose chats may use it.
 *
 * Adding one is two steps: pick the provider, then paste the key. The
 * address, the name and a model are filled in; Test asks a runtime,
 * which is what calls models, whether the connection answers.
 *
 * One connection is the DEFAULT: the answer for every chat whose person
 * never chose.
 */
@Component({
  selector: 'app-model-providers',
  standalone: false,
  templateUrl: './model-providers.component.html',
  styleUrls: ['./model-providers.component.css'],
})
export class ModelProvidersComponent extends DataPageBase {
  /** The connections, the catalog of providers, and the groups a
   *  connection may be shared with, Everyone first: read by the page. */
  @Input() connections: LlmConnection[] = [];
  @Input() providers: LlmProvider[] = [];
  @Input() groups: PeerGroup[] = [];
  /** The pages the connections are, read by the page from the API
   *  server, which searches them; null when they are all given. */
  @Input() pages: ServerPages<LlmConnection> | null = null;
  /** How many connections there are, unsearched; null: those given. */
  @Input() connectionTotal: number | null = null;
  /** The server's numbers of them, where it counts them. */
  @Input() counts: LlmCounts | null = null;
  /** A connection was added, changed or removed: the page reads them again. */
  @Output() changed = new EventEmitter<void>();
  /** The search changed: the page asks the server. */
  @Output() searched = new EventEmitter<string>();

  query = '';
  busyId = '';

  /** The add-and-edit form, which is shown on the dialog shell. */
  @ViewChild('editor')
  private editor?: TemplateRef<unknown>;
  private editorRef?: MatDialogRef<unknown>;

  constructor(
    private service: SettingsLlmService,
    public auth: AuthService,
    private dialog?: MatDialog,
    private confirm?: ConfirmService,
  ) {
    super();
  }

  /** The counts under the list. */
  get foot(): string {
    const count = this.connectionCount;
    return `${count} provider${count === 1 ? '' : 's'}`;
  }

  /** How many connections there are, whatever the search. */
  get connectionCount(): number {
    return this.counts?.connections ?? this.connectionTotal ?? this.connections.length;
  }

  /** The numbers over the list: the default's name, the models people may
   *  pick in all, and how many connections name none yet. The server's,
   *  where it counts them; else those of the rows read. */
  get defaultName(): string {
    if (this.counts) return this.counts.default_name || 'None';
    return this.connections.find((connection) => connection.default)?.name ?? 'None';
  }

  get modelCount(): number {
    if (this.counts) return this.counts.models;
    return this.connections.reduce((sum, connection) => sum + connection.models.length, 0);
  }

  get withoutModel(): number {
    if (this.counts) return this.counts.without_models;
    return this.connections.filter((connection) => !connection.models.length).length;
  }

  /** A new search, asked of the server. */
  onSearch(query: string): void {
    this.query = query;
    this.searched.emit(query);
  }

  clearSearch(): void {
    this.onSearch('');
  }

  get canCreate(): boolean { return this.auth.can('settings:llm:create'); }
  get canUpdate(): boolean { return this.auth.can('settings:llm:update'); }
  get canDelete(): boolean { return this.auth.can('settings:llm:delete'); }
  get canSetDefault(): boolean { return this.auth.can('settings:llm:setdefault'); }
  get canCheck(): boolean { return this.auth.can('settings:llm:models'); }

  // ── The list ────────────────────────────────────────────────────────

  /** The rows shown: the page the server searched and read. */
  get visible(): LlmConnection[] {
    return this.connections;
  }

  providerName(id: string): string {
    return this.providers.find((provider) => provider.id === id)?.name ?? id;
  }

  /** The line under a row's name: the provider, where that is not the
   *  name already, where it is, its default model and how many more
   *  people may pick. */
  summary(connection: LlmConnection): string {
    const provider = this.providerName(connection.provider);
    const [model, ...more] = connection.models;
    const models = model ? model + (more.length ? ` +${more.length} more` : '') : '';
    return [provider === connection.name ? '' : provider, this.hostOf(connection.address), models]
      .filter(Boolean).join(' · ');
  }

  private hostOf(address: string): string {
    try {
      return new URL(address).host;
    } catch {
      return address;
    }
  }

  /** How a row says whose chats may use it. */
  shareLabel(connection: LlmConnection): string {
    if (this.everyone && connection.groups.includes(this.everyone)) return 'Everyone';
    if (!connection.groups.length) return 'Nobody yet';
    return `${connection.groups.length} group${connection.groups.length === 1 ? '' : 's'}`;
  }

  // ── Adding: first which provider ────────────────────────────────────

  /** null = closed, '' = adding, id = editing. */
  editingId: string | null = null;
  /** Adding, and no provider chosen yet. */
  choosing = false;
  providerQuery = '';

  get isCreating(): boolean { return this.editingId === ''; }

  /** Every provider is listed, not only the popular few. */
  showAll = false;

  /** The providers offered: the popular few, until the person asks for
   *  all of them or types; then every one, or every one that matches,
   *  by name. The custom entry, a server of the person's own, is offered
   *  apart. Kept between change detections: the catalog is two hundred
   *  names to sort. */
  get offered(): LlmProvider[] {
    const query = this.providerQuery.trim().toLowerCase();
    const key = `${this.showAll}|${query}`;
    if (this.offeredOf !== this.providers || this.offeredKey !== key) {
      this.offeredOf = this.providers;
      this.offeredKey = key;
      const named = this.providers.filter((provider) => !!provider.endpoint);
      this.offeredList = !query && !this.showAll
        // The few most people look for, the most looked-for first.
        ? named.filter((provider) => provider.popular)
          .sort((a, b) => Number(a.popular) - Number(b.popular))
        : named.filter((provider) =>
            !query || `${provider.name} ${provider.id}`.toLowerCase().includes(query))
          .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
    }
    return this.offeredList;
  }
  private offeredOf: LlmProvider[] | null = null;
  private offeredKey = '';
  private offeredList: LlmProvider[] = [];

  get custom(): LlmProvider | null {
    return this.providers.find((provider) => !provider.endpoint) ?? null;
  }

  /** Every named provider, the custom entry apart. */
  get total(): number {
    return this.providers.filter((p) => !!p.endpoint).length;
  }

  /** How many more a search, or the whole list, would find. */
  get others(): number {
    return this.providers.filter((p) => !!p.endpoint && !p.popular).length;
  }

  /** The list is the whole catalog, or what matches in it. */
  get listingAll(): boolean {
    return this.showAll || !!this.providerQuery.trim();
  }

  startCreate(): void {
    this.editingId = '';
    this.choosing = true;
    this.providerQuery = '';
    this.showAll = false;
    this.draft = this.blankDraft();
    this.resetEditor(true);
    this.error = '';
    this.openEditor();
  }

  /** Shows the form on the dialog shell, which gives it Escape, the
   *  focus and the way back to what opened it. Closing the dialog by
   *  any of those is closing the editor. */
  private openEditor(): void {
    if (!this.dialog || !this.editor || this.editorRef) return;
    this.editorRef = this.dialog.open(this.editor, { width: '600px' });
    this.editorRef.afterClosed().subscribe(() => {
      this.editorRef = undefined;
      this.editingId = null;
    });
  }

  /** Back to the list of providers, from the form of one. */
  chooseAnother(): void {
    if (!this.saving && this.isCreating) this.choosing = true;
  }

  // ── The form ────────────────────────────────────────────────────────

  draft: Draft = this.blankDraft();
  saving = false;
  showMore = false;
  /** The key is shown as it is typed. */
  keyShown = false;
  /** Save was pressed with something missing: from then on the form
   *  says what, under the field it belongs to. */
  private tried = false;
  /** The address the connection being edited was saved with: a new one
   *  needs the key again. */
  private savedAddress = '';

  /** The models offered to choose from: the catalog's for the provider,
   *  and what a test found. */
  models: LlmModel[] = [];
  /** A runtime is being asked, and what it said of the form as it was. */
  testing = false;
  tested: { ok: boolean; text: string } | null = null;

  readonly sharings: Choice<Sharing>[] = [
    { value: 'everyone', name: 'Everyone' },
    { value: 'some', name: 'Some groups' },
  ];

  /** The chosen provider's address while it still has parts that are
   *  the customer's own (`<aws-region>`), and what was typed for each.
   *  The form asks for those parts by name instead of having the person
   *  edit an address. */
  endpointTemplate = '';
  blankValues: Record<string, string> = {};

  /** What a blank is usually filled with, so the common case is no step. */
  private readonly blankDefaults: Record<string, string> = {
    'aws-region': 'us-east-1',
    'google-vertex-location': 'us-central1',
  };

  /** A blank, as its provider's own console calls it, and where there
   *  it is found. One not named here is asked for by its own words. */
  private static readonly BLANKS: Record<string, { label: string; help: string; example: string }> = {
    'aws-region': {
      label: 'AWS region',
      help: 'The region your Bedrock models are enabled in.',
      example: 'us-east-1',
    },
    'google-vertex-location': {
      label: 'Google Cloud region',
      help: 'Where the models are called: us-central1, europe-west4, … or global.',
      example: 'us-central1',
    },
    'cloudflare-account-id': {
      label: 'Cloudflare account ID',
      help: 'In the Cloudflare dashboard, on the Workers AI overview.',
      example: '',
    },
    'databricks-host': {
      label: 'Databricks workspace',
      help: 'Your workspace’s address, without https://.',
      example: 'dbc-a1b2c3d4-e5f6.cloud.databricks.com',
    },
    'infomaniak-product-id': {
      label: 'Infomaniak product ID',
      help: 'The number of your AI Tools product, in the Infomaniak manager.',
      example: '',
    },
    'snowflake-account': {
      label: 'Snowflake account',
      help: 'Your account identifier: the part of your Snowflake address before .snowflakecomputing.com.',
      example: 'myorg-myaccount',
    },
  };

  /** Where a provider's key is made, for the few most people use: the
   *  one thing the form asks for, and the one a person has to go and
   *  fetch. */
  private static readonly KEYS: Record<string, { where: string; url: string }> = {
    anthropic: { where: 'the Anthropic Console', url: 'https://console.anthropic.com/settings/keys' },
    openai: { where: 'the OpenAI platform', url: 'https://platform.openai.com/api-keys' },
    gemini: { where: 'Google AI Studio', url: 'https://aistudio.google.com/apikey' },
    openrouter: { where: 'OpenRouter', url: 'https://openrouter.ai/settings/keys' },
    'amazon-bedrock': { where: 'the AWS console, under Amazon Bedrock › API keys',
                        url: 'https://console.aws.amazon.com/bedrock/home#/api-keys' },
    azure: { where: 'the Azure portal, under your resource’s Keys and Endpoint', url: 'https://portal.azure.com' },
    'google-vertex': { where: 'Google Cloud: a service account’s key in JSON, the whole file pasted. The account '
                         + 'needs the Vertex AI User role',
                       url: 'https://console.cloud.google.com/iam-admin/serviceaccounts' },
    'google-vertex-anthropic': { where: 'Google Cloud: a service account’s key in JSON, the whole file pasted. The '
                                   + 'account needs the Vertex AI User role, and Claude enabled in Model Garden',
                                 url: 'https://console.cloud.google.com/iam-admin/serviceaccounts' },
    groq: { where: 'the Groq console', url: 'https://console.groq.com/keys' },
    mistral: { where: 'the Mistral console', url: 'https://console.mistral.ai/api-keys' },
    xai: { where: 'the xAI console', url: 'https://console.x.ai' },
    deepseek: { where: 'the DeepSeek platform', url: 'https://platform.deepseek.com/api_keys' },
  };

  /** Addresses a model on this computer usually answers at, as the
   *  platform sees them from inside its container. */
  readonly ownServers = [
    { name: 'Ollama', address: 'http://host.docker.internal:11434/v1' },
    { name: 'LM Studio', address: 'http://host.docker.internal:1234/v1' },
  ];

  readonly awsRegions = [
    'us-east-1', 'us-east-2', 'us-west-2', 'ca-central-1', 'sa-east-1',
    'eu-west-1', 'eu-west-2', 'eu-west-3', 'eu-central-1', 'eu-north-1',
    'ap-south-1', 'ap-northeast-1', 'ap-northeast-2', 'ap-southeast-1',
    'ap-southeast-2', 'me-central-1',
  ];

  get keyPlace(): { where: string; url: string } | null {
    return ModelProvidersComponent.KEYS[this.draft.provider] ?? null;
  }

  get keyHelp(): string {
    return this.endpointIsYours
      ? 'Encrypted when saved, and never shown again. Leave it empty for a server that asks for none.'
      : 'Encrypted when saved, and never shown again.';
  }

  get modelHelp(): string {
    const used = 'Chats use it unless their person picks another.';
    if (this.asksEndpoint) return `Your deployment’s name, as you named it in Azure. ${used}`;
    if (this.endpointIsYours) return `The model’s name on your server. ${used}`;
    return used;
  }

  /** The catalog's models not offered yet, the newest first: a few, to
   *  add with a click. */
  get suggested(): LlmModel[] {
    const offered = new Set([this.draft.model.trim(), ...this.draft.others]);
    return this.models.filter((model) => !offered.has(model.id)).slice(0, 6);
  }

  addOther(model: string): void {
    if (model !== this.draft.model.trim() && !this.draft.others.includes(model)) {
      this.draft.others = [...this.draft.others, model];
    }
  }

  blankHelp(blank: string): string {
    return ModelProvidersComponent.BLANKS[blank]?.help ?? '';
  }

  blankExample(blank: string): string {
    const example = ModelProvidersComponent.BLANKS[blank]?.example ?? '';
    return example ? `e.g. ${example}` : '';
  }

  /** What an address has in each blank of the catalog's, or null when
   *  it is not that address at all: a gateway of the person's own. */
  private blanksIn(template: string, address: string): Record<string, string> | null {
    const names = [...template.matchAll(/<([^>]+)>/g)].map((found) => found[1]);
    const pattern = template.replace(/\/+$/, '')
      .split(/<[^>]+>/)
      .map((piece) => piece.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
      .join('([^/]+?)');
    const found = new RegExp(`^${pattern}$`).exec(address.replace(/\/+$/, ''));
    if (!found) return null;
    return Object.fromEntries(names.map((name, index) => [name, found[index + 1]]));
  }

  /** The name follows the provider until the person types one. */
  private nameIsAuto = true;

  /** The group every person of the organization is in, listed first. */
  private get everyone(): string {
    return this.groups?.[0]?.group_id ?? '';
  }

  private blankDraft(): Draft {
    // A new connection is for everyone's chats until said otherwise:
    // one shared with no group is used by nobody.
    return { name: '', provider: '', address: '', key: '', model: '', others: [],
             groups: this.everyone ? [this.everyone] : [] };
  }

  private resetEditor(creating: boolean): void {
    this.endpointTemplate = '';
    this.blankValues = {};
    this.nameIsAuto = creating;
    this.showMore = false;
    this.keyShown = false;
    this.tried = false;
    this.savedAddress = '';
    this.models = [];
    this.tested = null;
  }

  get chosen(): LlmProvider | null {
    return this.providers.find((p) => p.id === this.draft.provider) ?? null;
  }

  /** The provider as the form's first line says it: its name and where
   *  it answers. */
  get chosenLine(): string {
    const name = this.chosen?.endpoint ? this.chosen.name : 'Your own server';
    const host = this.draft.address && !/[<>]/.test(this.draft.address) ? this.hostOf(this.draft.address) : '';
    return [name, host].filter(Boolean).join(' · ');
  }

  /** Whether the address is the person's to type in full: the custom
   *  entry has none of its own. */
  get endpointIsYours(): boolean {
    return !!this.chosen && !this.chosen.endpoint;
  }

  selectProvider(provider: LlmProvider): void {
    this.choosing = false;
    this.draft = { ...this.blankDraft(), provider: provider.id };
    this.resetEditor(true);
    if (this.asksEndpoint) {
      this.endpointTemplate = '';
      this.draft.address = '';
    } else {
      this.endpointTemplate = /<[^>]+>/.test(provider.endpoint) ? provider.endpoint : '';
      for (const blank of this.blanks) this.blankValues[blank] = this.blankDefaults[blank] ?? '';
      this.draft.address = this.filled(provider.endpoint);
    }
    this.draft.name = this.freeName(provider.endpoint ? provider.name : '');
    void this.loadModels(provider.id);
  }

  /** The catalog's models for the provider, the newest first chosen
   *  where none is yet: on Azure a model is a deployment the person
   *  named, so none is chosen for them there. */
  private async loadModels(provider: string): Promise<void> {
    const models = await this.service.models(provider);
    if (this.draft.provider !== provider) return;
    this.models = [...models, ...this.models.filter((found) => !models.some((model) => model.id === found.id))];
    if (!this.draft.model && models.length && !this.asksEndpoint) this.draft.model = models[0].id;
  }

  /** The provider's name, or that with a number where a connection is
   *  called so already. */
  private freeName(name: string): string {
    if (!name) return '';
    const taken = new Set(this.connections.map((c) => c.name.toLowerCase()));
    if (!taken.has(name.toLowerCase())) return name;
    for (let number = 2; ; number++) {
      if (!taken.has(`${name} ${number}`.toLowerCase())) return `${name} ${number}`;
    }
  }

  /** The customer's own parts of the provider's address, by name. */
  get blanks(): string[] {
    return [...this.endpointTemplate.matchAll(/<([^>]+)>/g)].map((found) => found[1]);
  }

  blankLabel(blank: string): string {
    const known = ModelProvidersComponent.BLANKS[blank]?.label;
    if (known) return known;
    const words = blank.replace(/-/g, ' ');
    return words.startsWith('aws ') ? 'AWS ' + words.slice(4)
      : words.charAt(0).toUpperCase() + words.slice(1);
  }

  setBlank(blank: string, value: string): void {
    this.blankValues[blank] = value;
    this.draft.address = this.filled(this.endpointTemplate);
    this.tested = null;
  }

  /** The address with every part that was typed put in; one still
   *  missing stays marked, and the blocker says so. */
  private filled(template: string): string {
    return template.replace(/<([^>]+)>/g,
      (mark, blank) => (this.blankValues[blank] ?? '').trim() || mark);
  }

  /** Whether the address is asked for whole, as the provider's portal
   *  shows it: Azure's endpoint is the customer's own, on one of several
   *  hosts, so it is pasted, not put together from a name. */
  get asksEndpoint(): boolean {
    return this.chosen?.id === 'azure';
  }

  setName(name: string): void {
    this.draft.name = name;
    this.nameIsAuto = false;
  }

  setKey(key: string): void {
    this.draft.key = key;
    this.tested = null;
  }

  setModel(model: string): void {
    this.draft.model = model;
    this.tested = null;
  }

  /** A server of the person's own is named after where it is, until
   *  they name it themselves. */
  setEndpoint(address: string): void {
    this.draft.address = address;
    this.tested = null;
    if (!this.nameIsAuto || !this.endpointIsYours) return;
    try {
      this.draft.name = this.freeName(new URL(address.trim()).host);
    } catch {
      this.draft.name = '';
    }
  }

  // ── Whose chats may use it ──────────────────────────────────────────

  get sharing(): Sharing {
    return this.everyone && this.draft.groups.includes(this.everyone) ? 'everyone' : 'some';
  }

  setSharing(sharing: Sharing): void {
    this.draft.groups = sharing === 'everyone' && this.everyone ? [this.everyone] : [];
  }

  /** The groups a connection may be shared with one by one: all but Everyone. */
  get someGroups(): PeerGroup[] {
    return this.groups.slice(1);
  }

  toggleGroup(groupId: string): void {
    const groups = new Set(this.draft.groups);
    if (!groups.delete(groupId)) groups.add(groupId);
    this.draft.groups = this.groups.map((group) => group.group_id).filter((id) => groups.has(id));
  }

  // ── Editing ─────────────────────────────────────────────────────────

  startEdit(connection: LlmConnection): void {
    this.editingId = connection.connection_id;
    this.choosing = false;
    this.draft = {
      name: connection.name, provider: connection.provider, address: connection.address, key: '',
      model: connection.models[0] ?? '', others: connection.models.slice(1), groups: [...connection.groups],
    };
    // A saved connection keeps its name and its address as they are.
    this.resetEditor(false);
    this.savedAddress = connection.address;
    // An address that is the provider's own with the person's parts in
    // it is shown as those parts. One that is not, a gateway, stays an
    // address.
    const template = this.chosen?.endpoint ?? '';
    const parts = /<[^>]+>/.test(template) && !this.asksEndpoint ? this.blanksIn(template, connection.address) : null;
    if (parts) {
      this.endpointTemplate = template;
      this.blankValues = parts;
    }
    this.error = '';
    this.openEditor();
    void this.loadModels(connection.provider);
  }

  closeEditor(): void {
    if (this.saving) return;
    this.editingId = null;
    this.editorRef?.close();
  }

  /** What is still missing, said before the request rather than after,
   *  with the field it belongs to. The key is demanded for a new
   *  connection, and for one sent to a new address. */
  private get missing(): Missing | null {
    const at = (field: string, message: string): Missing => ({ field, message });
    if (!this.draft.provider) return at('provider', 'Choose a provider.');
    const blank = this.blanks.find((name) => !(this.blankValues[name] ?? '').trim());
    if (blank) return at(`blank:${blank}`, `Enter your ${this.blankLabel(blank)}.`);
    if (!this.draft.address.trim()) {
      return at('address', this.asksEndpoint ? 'Paste your endpoint.' : 'Enter the address the server answers at.');
    }
    if (/[<>]/.test(this.draft.address)) {
      return at('address', 'Fill in the address: replace each <...> with your own account’s value.');
    }
    if (!this.draft.key.trim()) {
      if (this.isCreating && !this.endpointIsYours) return at('key', 'Paste the API key.');
      if (!this.isCreating && this.draft.address.trim() !== this.savedAddress) {
        return at('key', 'Give the key again: it is sent to the new address.');
      }
    }
    if (!this.draft.model.trim()) return at('model', 'Choose the model chats use.');
    if (!this.draft.name.trim()) return at('name', 'Give it a name.');
    return null;
  }

  /** What stands in the way of saving, or ''. */
  get blocker(): string {
    return this.missing?.message ?? '';
  }

  /** What is missing from this field, once Save has been pressed. */
  errorFor(field: string): string {
    const missing = this.tried ? this.missing : null;
    return missing?.field === field ? missing.message : '';
  }

  /** Whether a field is under "More options". */
  private hidden(field: string): boolean {
    return field === 'name' || (field === 'address' && !this.endpointIsYours && !this.asksEndpoint);
  }

  async save(): Promise<void> {
    if (this.saving) return;
    const missing = this.missing;
    if (missing) {
      this.tried = true;
      if (this.hidden(missing.field)) this.showMore = true;
      return;
    }
    this.saving = true;
    if (this.editorRef) this.editorRef.disableClose = true;
    try {
      const draft = { ...this.sent, name: this.draft.name.trim(), groups: this.draft.groups };
      const result = this.isCreating
        ? await this.service.create(draft)
        : await this.service.update(this.editingId!, draft);
      if (result.error) return this.fail(result.error);
      this.editingId = null;
      this.editorRef?.close();
      this.changed.emit();
      this.flash(`“${result.connection?.name ?? draft.name}” saved.`);
    } finally {
      this.saving = false;
      if (this.editorRef) this.editorRef.disableClose = false;
    }
  }

  /** What reaching the connection takes, as the form says it: the
   *  default model first. A blank key on an edit keeps the one kept. */
  private get sent(): LlmConnectionDraft {
    const model = this.draft.model.trim();
    return {
      provider: this.draft.provider,
      address: this.draft.address.trim(),
      models: [model, ...this.draft.others.filter((other) => other !== model)].filter(Boolean),
      ...(this.draft.key.trim() ? { key: this.draft.key.trim() } : {}),
    };
  }

  // ── Asking a runtime ────────────────────────────────────────────────

  /** A runtime reaches a saved connection, and says whether it answered. */
  async check(connection: LlmConnection): Promise<void> {
    if (this.busyId) return;
    this.busyId = connection.connection_id;
    try {
      const result = await this.service.check({}, connection.connection_id);
      if (result.error || !result.ok) {
        return this.fail(`“${connection.name}” did not answer: ${result.error || 'no reason given'}.`);
      }
      this.flash(`“${connection.name}” answered.`);
    } finally {
      this.busyId = '';
    }
  }

  /** The connection as the form says it, saved or not, reached by a
   *  runtime with its model: whether it answers, said in the form. With
   *  no model chosen the runtime tries the provider's newest, and the
   *  form takes it when it answers. */
  async test(): Promise<void> {
    const missing = this.missing;
    if (this.testing || (missing && !['name', 'model'].includes(missing.field))) {
      this.tried = true;
      return;
    }
    const id = this.editingId;
    this.testing = true;
    this.tested = null;
    this.error = '';
    try {
      const result = await this.service.check(this.sent, id ?? '');
      if (this.editingId !== id) return;
      const found = (result.models ?? []).filter((model) => !this.models.some((known) => known.id === model));
      this.models = [...this.models, ...found.map((model) => ({ id: model, name: model }))];
      if (result.ok && !this.draft.model && result.models?.length) this.draft.model = result.models[0];
      this.tested = result.ok && !result.error
        ? { ok: true, text: 'It answered.' }
        : { ok: false, text: `It did not answer: ${result.error || 'no reason given'}.` };
    } finally {
      this.testing = false;
    }
  }

  // ── Default ─────────────────────────────────────────────────────────

  async makeDefault(connection: LlmConnection): Promise<void> {
    if (connection.default || this.busyId) return;
    this.busyId = connection.connection_id;
    try {
      const result = await this.service.setDefault(connection.connection_id);
      if (result.error) return this.fail(result.error);
      this.changed.emit();
      this.flash(`“${connection.name}” is now the default.`);
    } finally {
      this.busyId = '';
    }
  }

  // ── Removing ────────────────────────────────────────────────────────

  /** Asks first, saying what goes with it. */
  async askRemove(connection: LlmConnection): Promise<void> {
    const takeover = connection.default
      ? ' It is the default: chats that chose none have no model until another is made the default.' : '';
    const sure = await this.confirm?.ask({
      title: `Remove “${connection.name}”?`,
      body: `The key goes with it. Chats that think with it stop until they pick another.${takeover}`,
      confirm: 'Remove',
      cancel: 'Keep it',
      danger: true,
    });
    if (sure) await this.remove(connection);
  }

  async remove(connection: LlmConnection): Promise<void> {
    this.busyId = connection.connection_id;
    try {
      const result = await this.service.remove(connection.connection_id);
      if (result.error) return this.fail(result.error);
      this.changed.emit();
      this.flash(`“${connection.name}” removed.`);
    } finally {
      this.busyId = '';
    }
  }
}
