import { Component, OnInit } from '@angular/core';
import { Refused } from 'src/app/services/request.service';

import { Draft } from 'src/app/components/ui/draft';
import { Choice } from 'src/app/components/ui/radio-keys';
import { HasUnsavedChanges } from 'src/app/guards/unsaved-changes.guard';
import { AuthService } from 'src/app/services/auth.service';
import { SettingsLlmService } from 'src/app/services/settings-llm.service';
import { OrgSettings, SettingsOrgService } from 'src/app/services/settings-org.service';
import { SettingsSpeechService } from 'src/app/services/settings-speech.service';

/** The organization's settings this page edits. */
type Speech = Pick<OrgSettings, 'speech' | 'speech_connection' | 'transcription_model' | 'speech_model' | 'speech_voice'>;

/** What an organization that has chosen nothing has: no speech. */
const STANDARD: Speech = {
  speech: 'none', speech_connection: '', transcription_model: '', speech_model: '', speech_voice: '',
};

/**
 * Settings › Speech: for the whole organization, what writes a spoken
 * message down and says a reply aloud: the platform's speech service, a
 * model connection, or nothing. One form, saved with the save bar.
 */
@Component({
  selector: 'app-speech',
  standalone: false,
  templateUrl: './speech.component.html',
  styleUrl: './speech.component.css',
})
export class SpeechComponent implements OnInit, HasUnsavedChanges {
  loading = true;
  loadError = '';
  saving = false;
  saveError = '';

  readonly draft = new Draft<Speech>(STANDARD);
  /** The organization's model connections, to speak through. */
  connections: Choice[] = [];

  readonly sourceChoices: Choice<Speech['speech']>[] = [
    { value: 'service', name: 'The speech service' },
    { value: 'model', name: 'A model connection' },
    { value: 'none', name: 'Off' },
  ];

  constructor(
    private service: SettingsOrgService,
    private llm: SettingsLlmService,
    private auth: AuthService,
    private speech: SettingsSpeechService,
  ) {}

  get canEdit(): boolean {
    return this.auth.can('settings:organization:update');
  }

  ngOnInit(): Promise<void> {
    return this.load();
  }

  async load(): Promise<void> {
    this.loading = true;
    this.loadError = '';
    try {
      const [settings, connections] = await Promise.all([
        this.service.get(),
        this.auth.can('settings:llm:list') ? this.llm.list(this.auth.can('settings:llm:create')) : Promise.resolve([]),
      ]);
      this.connections = connections.map((connection) => ({ value: connection.connection_id, name: connection.name }));
      this.take(settings);
    } catch (failed) {
      this.loadError = Refused.words(failed);
    } finally {
      this.loading = false;
    }
  }

  private take(settings: OrgSettings): void {
    const { speech, speech_connection, transcription_model, speech_model, speech_voice } = settings;
    this.draft.take({ speech, speech_connection, transcription_model, speech_model, speech_voice });
  }

  /** A model connection alone does not say what speaks through it. */
  get connectionError(): string {
    return this.draft.value.speech === 'model' && !this.draft.value.speech_connection
      ? 'Choose the connection that speaks.' : '';
  }

  /** What the choice means, in a line. */
  get sourceHelp(): string {
    switch (this.draft.value.speech) {
      case 'service': return 'The platform’s own speech service writes recordings down and says replies aloud. Nothing is stored.';
      case 'model': return 'A recording is written down, and a reply said, by the connection’s provider. Nothing is stored.';
      default: return 'No microphone in the composer, and replies are read, not heard.';
    }
  }

  async save(): Promise<void> {
    if (this.saving) return;
    if (this.connectionError) {
      this.saveError = this.connectionError;
      return;
    }
    this.saving = true;
    this.saveError = '';
    try {
      const result = await this.service.update(this.draft.value);
      if (result.error || !result.settings) {
        this.saveError = result.error || 'The settings could not be saved.';
        return;
      }
      this.take(result.settings);
      // Whether pages offer speech has just been decided.
      void this.speech.offered(true);
    } finally {
      this.saving = false;
    }
  }

  discard(): void {
    this.draft.discard();
    this.saveError = '';
  }

  unsavedChangesTo(): string {
    return this.draft.dirty ? 'Speech' : '';
  }
}
