import {
  Component, ElementRef, EventEmitter, HostListener, Input, OnInit, Output, ViewChild,
} from '@angular/core';

import { ChatSettings } from 'src/app/models/chat-protocol';
import { LlmConnection, SettingsLlmService } from 'src/app/services/settings-llm.service';
import { EFFORT_CHOICES, ModelPick, modelOf } from '../chat-defaults';

/** What a chat's assistant thinks with: a model connection ('' for the
 *  organization's default), one of its models ('' for its first), and how
 *  hard it is asked to think. */
export interface ChatModel extends ModelPick {
  effort: ChatSettings['effort'];
}

/** One row of the list: a connection and one of its models. */
export interface ModelOption {
  connection: LlmConnection;
  model: string;
}

/**
 * Which model this chat thinks with, chosen where the message is written.
 *
 * A button names the model; pressing it lists the organization's default
 * and every model of every connection the person may use, narrowed as
 * they type, and how hard the model is asked to think at the foot.
 *
 * The component chooses and says so (`chosen`); saving the choice — to
 * the chat, and as what the person's next chat starts with — is the
 * page's, which knows whether there is a chat yet.
 */
@Component({
  selector: 'app-chat-model-picker',
  standalone: false,
  templateUrl: './chat-model-picker.component.html',
  styleUrls: ['./chat-model-picker.component.css'],
})
export class ChatModelPickerComponent implements OnInit {
  @Input() llm: ChatModel = { model: '', model_id: '', effort: '' };
  @Input() disabled = false;

  @Output() chosen = new EventEmitter<ChatModel>();

  @ViewChild('search') search?: ElementRef<HTMLInputElement>;

  readonly efforts = EFFORT_CHOICES;
  open = false;
  /** The list opens above the chip where there is room — the composer
   *  is usually at the foot of the page — and below it where there is
   *  not. Never taller than the room it has. */
  below = false;
  panelHeight = 420;
  loading = false;
  connections: LlmConnection[] = [];
  query = '';

  constructor(private service: SettingsLlmService, private host: ElementRef<HTMLElement>) {}

  ngOnInit(): void {
    void this.load();
  }

  // ── What the chip says ──────────────────────────────────────────────

  /** The organization's default, as the person may use it. */
  get standard(): LlmConnection | undefined {
    return this.connections.find((connection) => connection.default);
  }

  /** The chosen model by what tells it apart: its connection's name, or
   *  the model's own where the connection offers several. */
  get label(): string {
    const chosen = this.connections.find((connection) => connection.connection_id === this.llm.model);
    const name = !this.llm.model ? this.standard?.name || 'Default model'
      : !chosen ? 'A model'
      : chosen.models.length > 1 ? modelOf(this.llm, chosen) : chosen.name;
    const effort = this.efforts.find((choice) => choice.value === this.llm.effort && choice.value);
    return effort ? `${name} · ${effort.name}` : name;
  }

  // ── The list ────────────────────────────────────────────────────────

  private async load(): Promise<void> {
    this.loading = true;
    try {
      this.connections = await this.service.list();
    } catch {
      this.connections = [];
    } finally {
      this.loading = false;
    }
  }

  /** Every model of every connection, narrowed by what was typed: a word
   *  matches the connection's name, its provider, or the model. */
  get visible(): ModelOption[] {
    const words = this.query.trim().toLowerCase().split(/\s+/).filter(Boolean);
    return this.connections.flatMap((connection) => connection.models.map((model) => ({ connection, model })))
      .filter(({ connection, model }) => {
        const text = `${connection.name} ${connection.provider} ${model}`.toLowerCase();
        return words.every((word) => text.includes(word));
      });
  }

  isChosen(option: ModelOption): boolean {
    return this.llm.model === option.connection.connection_id && modelOf(this.llm, option.connection) === option.model;
  }

  toggle(): void {
    if (this.disabled) return;
    this.open = !this.open;
    this.query = '';
    // Read again each time it opens: a connection added in Settings a
    // moment ago is offered without reloading the page.
    if (this.open) {
      this.place();
      void this.load();
      setTimeout(() => this.search?.nativeElement.focus());
    }
  }

  private place(): void {
    const chip = this.host.nativeElement.getBoundingClientRect();
    // Above, the page's own header takes the top of the window.
    const above = chip.top - 72;
    const under = window.innerHeight - chip.bottom - 16;
    this.below = under > above;
    this.panelHeight = Math.max(180, Math.min(420, this.below ? under : above));
  }

  close(): void {
    this.open = false;
  }

  @HostListener('document:mousedown', ['$event'])
  onOutside(event: MouseEvent): void {
    if (this.open && !this.host.nativeElement.contains(event.target as Node)) this.close();
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    this.close();
  }

  /** The arrows move through the list as they do in a menu. */
  moveThroughModels(event: KeyboardEvent): void {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    if ((event.target as HTMLElement).closest('app-segmented')) return;
    const panel = event.currentTarget as HTMLElement;
    const stops = [this.search?.nativeElement, ...Array.from(panel.querySelectorAll<HTMLElement>('.model-option'))]
      .filter((stop): stop is HTMLElement => !!stop);
    const next = stops[stops.indexOf(document.activeElement as HTMLElement) + (event.key === 'ArrowDown' ? 1 : -1)];
    if (!next) return;
    event.preventDefault();
    next.focus();
  }

  // ── Choosing ────────────────────────────────────────────────────────

  /** A connection and one of its models; none for the organization's default. */
  choose(connectionId: string, model = ''): void {
    this.chosen.emit({ ...this.llm, model: connectionId, model_id: model });
    this.close();
  }

  chooseEffort(effort: ChatSettings['effort']): void {
    this.chosen.emit({ ...this.llm, effort });
  }
}
