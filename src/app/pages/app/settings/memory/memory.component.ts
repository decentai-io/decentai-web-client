import { Component, OnInit } from '@angular/core';
import { Refused } from 'src/app/services/request.service';

import { AuthService } from 'src/app/services/auth.service';
import { ConfirmService } from 'src/app/services/confirm.service';
import { Memory, MemoryService } from 'src/app/services/memory.service';

/** With fewer spaces than this left, the page says the cap is near. */
const NEAR_LIMIT = 10;

/**
 * Settings › Memory: what the assistant keeps about you.
 *
 * A memory arrives one of two ways — saved from a chat, when the
 * assistant offered it on a card and you said yes, or written here by
 * you. Either way it is yours to correct and to forget.
 */
@Component({
  selector: 'app-memory',
  standalone: false,
  templateUrl: './memory.component.html',
  styleUrls: ['./memory.component.css'],
})
export class MemoryComponent implements OnInit {
  loading = true;
  /** Why the memories could not be read. */
  loadError = '';
  memories: Memory[] = [];
  /** How many memories are kept at once. */
  readonly limit = MemoryService.MOST;
  query = '';
  readonly textLimit = MemoryService.TEXT;

  /** The memory being written. */
  newText = '';
  adding = false;
  addError = '';

  /** The memory being edited in its row. */
  editingId: string | null = null;
  editText = '';
  editError = '';
  busyId = '';
  /** Why a memory could not be forgotten. */
  forgetError = '';
  forgettingAll = false;

  constructor(
    private service: MemoryService,
    public auth: AuthService,
    private confirm: ConfirmService,
  ) {}

  ngOnInit(): Promise<void> {
    return this.load();
  }

  async load(): Promise<void> {
    this.loading = true;
    this.loadError = '';
    try {
      await this.reload();
    } catch (failed) {
      this.loadError = Refused.words(failed);
    } finally {
      this.loading = false;
    }
  }

  private async reload(): Promise<void> {
    this.memories = await this.service.list();
  }

  // ── Access, and the cap ─────────────────────────────────────────────

  get canAdd(): boolean {
    return this.auth.can('settings:memory:create');
  }

  get canEdit(): boolean {
    return this.auth.can('settings:memory:update');
  }

  get canForget(): boolean {
    return this.auth.can('settings:memory:delete');
  }

  /** Room left before the oldest memory starts being dropped. */
  get remaining(): number {
    return Math.max(0, this.limit - this.memories.length);
  }

  /** Near enough the cap that the eviction rule is about to matter. */
  get nearLimit(): boolean {
    return this.remaining < NEAR_LIMIT;
  }

  get atLimit(): boolean {
    return this.memories.length >= this.limit;
  }

  /** The counts under the list. */
  get foot(): string {
    return `${this.memories.length} saved · ${this.remaining} space${this.remaining === 1 ? '' : 's'} left`;
  }

  /** What the cap means, said before something quietly goes. */
  get capWarning(): string {
    if (this.atLimit) return `Full at ${this.limit}: the next memory saved drops the oldest.`;
    return `At ${this.limit}, a new memory drops the oldest.`;
  }

  /** Newest first. The server hands them over oldest first, the order the
   *  assistant reads them in; on a page, that buries the one you just
   *  saved at the bottom. */
  get filteredMemories(): Memory[] {
    const query = this.query.trim().toLowerCase();
    return this.memories.filter((memory) => !query || memory.text.toLowerCase().includes(query)).reverse();
  }

  // ── Writing one yourself ────────────────────────────────────────────

  get canSubmitNew(): boolean {
    const text = this.newText.trim();
    return !!text && text.length <= this.textLimit && !this.adding;
  }

  async addMemory(): Promise<void> {
    if (!this.canSubmitNew) return;
    this.adding = true;
    this.addError = '';
    try {
      const result = await this.service.create(this.newText.trim());
      if (result.error) {
        this.addError = result.error;
        return;
      }
      this.newText = '';
      await this.reload();
    } finally {
      this.adding = false;
    }
  }

  // ── A row ───────────────────────────────────────────────────────────

  startEdit(memory: Memory): void {
    this.editingId = memory.memory_id;
    this.editText = memory.text;
    this.editError = '';
  }

  cancelEdit(): void {
    this.editingId = null;
    this.editText = '';
    this.editError = '';
  }

  async saveEdit(memory: Memory): Promise<void> {
    const text = this.editText.trim();
    if (!text || text === memory.text) return;
    this.busyId = memory.memory_id;
    this.editError = '';
    try {
      const result = await this.service.update(memory.memory_id, text);
      if (result.error) {
        // The editor stays open, holding the text that was refused.
        this.editError = result.error;
        return;
      }
      // As the server keeps it: its spaces run together.
      memory.text = text.split(/\s+/).join(' ');
      this.cancelEdit();
    } finally {
      this.busyId = '';
    }
  }

  // ── Forgetting ──────────────────────────────────────────────────────

  async forget(memory: Memory): Promise<void> {
    const sure = await this.confirm.ask({
      title: 'Forget this memory?',
      body: `“${memory.text}” The assistant stops using it in new conversations; those that already used it are unchanged.`,
      confirm: 'Forget',
      cancel: 'Keep it',
      danger: true,
    });
    if (!sure) return;
    this.busyId = memory.memory_id;
    this.forgetError = '';
    try {
      const result = await this.service.remove(memory.memory_id);
      if (result.error) {
        this.forgetError = result.error;
        return;
      }
      await this.reload();
    } finally {
      this.busyId = '';
    }
  }

  /** Every memory, one after the other, after one question. */
  async forgetAll(): Promise<void> {
    const count = this.memories.length;
    const sure = await this.confirm.ask({
      title: `Forget all ${count} memories?`,
      body: 'The assistant starts new conversations knowing none of them. This cannot be undone.',
      confirm: 'Forget all',
      cancel: 'Keep them',
      danger: true,
    });
    if (!sure) return;
    this.forgettingAll = true;
    this.forgetError = '';
    try {
      for (const memory of [...this.memories]) {
        const result = await this.service.remove(memory.memory_id);
        if (result.error) {
          this.forgetError = result.error;
          break;
        }
      }
      await this.reload();
    } finally {
      this.forgettingAll = false;
    }
  }
}
