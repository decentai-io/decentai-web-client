import { Component, OnInit } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { Refused } from 'src/app/services/request.service';

import { Draft } from 'src/app/components/ui/draft';
import { Choice } from 'src/app/components/ui/radio-keys';
import { HasUnsavedChanges } from 'src/app/guards/unsaved-changes.guard';
import { AuthService } from 'src/app/services/auth.service';
import { ProfileService } from 'src/app/services/profile.service';
import { DeviceSpeechService, Hearing, SpeechBy } from 'src/app/services/device-speech.service';
import { MicrophoneService } from 'src/app/services/microphone.service';
import { ReadAloudService } from 'src/app/services/read-aloud.service';
import { SettingsSpeechService } from 'src/app/services/settings-speech.service';
import { LlmConnection, SettingsLlmService } from 'src/app/services/settings-llm.service';
import { ChatSettings, DEFAULT_CHAT_SETTINGS } from 'src/app/models/chat-protocol';
import { ChatAgentsDialogComponent, ChatReach } from '../../ai/chat/chat-agents-dialog/chat-agents-dialog.component';
import { ChatSkillsDialogComponent } from '../../ai/chat/chat-skills-dialog/chat-skills-dialog.component';
import { EFFORT_CHOICES, TRUST_CHOICES, TURN_BUDGET_CHOICES, chatDefaults } from '../../ai/chat/chat-defaults';

/** What a new chat of this person starts with, of a chat's settings. */
type ChatDefaults = Pick<ChatSettings, 'model' | 'effort' | 'trust' | 'turn_budget' | 'agents' | 'skills' | 'mcp_servers'>;

const STANDARD: ChatDefaults = {
  model: DEFAULT_CHAT_SETTINGS.model, effort: DEFAULT_CHAT_SETTINGS.effort,
  trust: DEFAULT_CHAT_SETTINGS.trust, turn_budget: DEFAULT_CHAT_SETTINGS.turn_budget,
  agents: null, skills: null, mcp_servers: null,
};

/** A choice of agents, skills or servers, in words. */
export function listWords(value: string[] | null, noun: string): string {
  if (!value) return `Every ${noun} you may use`;
  return value.length ? `${value.length} chosen` : `No ${noun}`;
}

/** How long "Saved" shows beside a switch that saves itself. */
const NOTE_FOR_MS = 2000;

/**
 * Settings › Chat defaults: the model, its effort, the trust level, the
 * turn budget, and the agents, servers and skills that a new chat of this
 * person starts with — every one they may use, or those chosen. Any chat
 * can still change each from its own menu. One form, saved with the save
 * bar; speech — who writes down what is said, who reads replies aloud,
 * and whether they are read unasked — is this device's alone and saves
 * itself.
 */
@Component({
  selector: 'app-chat-defaults',
  standalone: false,
  templateUrl: './chat-defaults.component.html',
  styles: ['.choose-line { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }'],
})
export class ChatDefaultsComponent implements OnInit, HasUnsavedChanges {
  loading = true;
  /** Why the page could not be read. */
  loadError = '';
  saving = false;
  saveError = '';

  readonly draft = new Draft<ChatDefaults>(STANDARD);
  /** The connections this person may use, and the organization's default
   *  first: what the model is chosen among. */
  modelChoices: Choice<string>[] = [];
  /** "Saved", for a moment, beside the read-aloud switch. */
  readAloudNote = '';
  /** "Saved", for a moment, beside the speech choices. */
  speechNote = '';

  /** Who may write down what is said here, and who does. */
  dictationChoices: Choice<SpeechBy>[] = [];
  dictationBy: SpeechBy | null = null;
  /** Whether this browser's own recognizer hears on the computer. */
  hearing: Hearing = 'none';
  /** Who may read replies aloud here, and who does. */
  readingChoices: Choice<SpeechBy>[] = [];
  readingBy: SpeechBy | null = null;

  readonly trustChoices: Choice<number>[] = TRUST_CHOICES;
  readonly turnChoices: Choice<number>[] = TURN_BUDGET_CHOICES;
  readonly effortChoices: Choice<string>[] = EFFORT_CHOICES;

  constructor(
    private profiles: ProfileService,
    private llm: SettingsLlmService,
    public auth: AuthService,
    public readAloud: ReadAloudService,
    private device: DeviceSpeechService,
    private speech: SettingsSpeechService,
    private microphone: MicrophoneService,
    private dialog: MatDialog,
  ) {}

  /** The model is chosen among connections, which not everyone may list. */
  get canChooseModel(): boolean {
    return this.auth.can('settings:llm:list');
  }

  ngOnInit(): Promise<void> {
    return this.load();
  }

  async load(): Promise<void> {
    this.loading = true;
    this.loadError = '';
    try {
      const [profile, connections] = await Promise.all([
        this.profiles.get(),
        this.canChooseModel ? this.llm.list() : Promise.resolve([]),
      ]);
      // No profile is no answer: the gateway reports a failure as one.
      if (!profile) throw new Error('no profile');
      this.modelChoices = [{ value: '', name: 'The organization\'s default' },
        ...connections.map((connection: LlmConnection) => ({ value: connection.connection_id, name: connection.name }))];
      this.kept = profile.preferences.chat ?? {};
      this.draft.take(this.read());
      void this.readAloud.refresh();
      void this.loadSpeech();
    } catch (failed) {
      this.loadError = Refused.words(failed);
    } finally {
      this.loading = false;
    }
  }

  /** What the person kept for their new chats, whole: saved back with
   *  what the form changes. */
  private kept: Record<string, unknown> = {};

  /** The kept defaults as the form's values; what was never chosen is
   *  the platform's standard. */
  private read(): ChatDefaults {
    const chosen = chatDefaults(this.kept);
    return {
      model: chosen.model ?? STANDARD.model, effort: chosen.effort ?? STANDARD.effort,
      trust: chosen.trust ?? STANDARD.trust, turn_budget: chosen.turn_budget ?? STANDARD.turn_budget,
      agents: chosen.agents ?? null, skills: chosen.skills ?? null, mcp_servers: chosen.mcp_servers ?? null,
    };
  }

  readonly listWords = listWords;

  /** The agents and servers a new chat uses, chosen in the dialog a chat's
   *  own menu opens. */
  chooseReach(): void {
    const value = this.draft.value;
    this.dialog.open(ChatAgentsDialogComponent, {
      width: '480px', maxWidth: '95vw',
      data: { agents: value.agents, mcp_servers: value.mcp_servers, defaults: { agents: null, mcp_servers: null } },
    }).afterClosed().subscribe((reach: ChatReach | null) => {
      if (reach) Object.assign(this.draft.value, reach);
    });
  }

  chooseSkills(): void {
    this.dialog.open(ChatSkillsDialogComponent, {
      width: '560px', maxWidth: '95vw', data: { skills: this.draft.value.skills, defaults: null },
    }).afterClosed().subscribe((chosen: { skills: string[] | null } | null) => {
      if (chosen) this.draft.value.skills = chosen.skills;
    });
  }

  async save(): Promise<void> {
    if (this.saving) return;
    this.saving = true;
    this.saveError = '';
    try {
      const chat = { ...this.kept, ...this.draft.value };
      const result = await this.profiles.savePreferences({ chat });
      if (result.error) {
        this.saveError = result.error;
        return;
      }
      this.kept = chat;
      this.draft.take(this.read());
    } finally {
      this.saving = false;
    }
  }

  /** What can write down speech and read it aloud on this device, and
   *  which of them does. */
  private async loadSpeech(): Promise<void> {
    const offered = await this.speech.offered();
    const serverHears = this.microphone.available && offered;
    this.hearing = await this.device.hearing();
    this.dictationChoices = [
      ...(this.hearing !== 'none'
        ? [{ value: 'device' as const, name: this.hearing === 'local' ? 'This computer' : 'This browser’s service' }]
        : []),
      ...(serverHears ? [{ value: 'server' as const, name: 'The server' }] : []),
    ];
    this.dictationBy = await this.device.dictation(serverHears);
    const ownVoice = !!(await this.device.voice());
    this.readingChoices = [
      ...(ownVoice ? [{ value: 'device' as const, name: 'This computer’s voices' }] : []),
      ...(offered ? [{ value: 'server' as const, name: 'The server' }] : []),
    ];
    this.readingBy = await this.device.reading(offered);
  }

  /** Where what is said goes to be written down, in one line. */
  get dictationHelp(): string {
    if (this.dictationBy === 'server') {
      return 'Your recording goes to your DecentAI server, which writes it down.';
    }
    if (this.hearing === 'local') return 'On this computer: what you say stays on it.';
    const away = 'your browser sends what you say to its maker’s service — Google for Chrome, Microsoft for Edge, Apple for Safari — to write it down.';
    return this.dictationBy === 'device'
      ? `On: ${away}`
      : `Off. Choose it to dictate here: ${away}`;
  }

  get readingHelp(): string {
    return this.readingBy === 'server'
      ? 'Your DecentAI server makes the audio.'
      : 'On this computer, with a voice of its own: nothing is sent.';
  }

  setDictation(by: SpeechBy): void {
    this.device.choose({ dictation: by });
    this.dictationBy = by;
    this.saidSpeech();
  }

  async setReading(by: SpeechBy): Promise<void> {
    this.device.choose({ reading: by });
    this.readingBy = by;
    await this.readAloud.refresh();
    this.saidSpeech();
  }

  private saidSpeech(): void {
    this.speechNote = 'Saved';
    setTimeout(() => (this.speechNote = ''), NOTE_FOR_MS);
  }

  /** Kept on this device, with nothing to save: said so for a moment. */
  setReadAloud(on: boolean): void {
    this.readAloud.automatic = on;
    this.readAloudNote = 'Saved';
    setTimeout(() => (this.readAloudNote = ''), NOTE_FOR_MS);
  }

  unsavedChangesTo(): string {
    return this.draft.dirty ? 'Chat defaults' : '';
  }
}
