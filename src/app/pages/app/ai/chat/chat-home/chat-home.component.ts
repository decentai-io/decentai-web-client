import { Component, ElementRef, HostListener, OnInit, ViewChild } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { MatDialog } from '@angular/material/dialog';

import { AlertComponent } from 'src/app/components/alert/alert.component';
import { fullDate, relativeDate } from 'src/app/components/ui/dates';
import { Chat, ChatSettings } from 'src/app/models/chat-protocol';
import { AiSessionService } from 'src/app/services/ai-session.service';
import { AttentionService } from 'src/app/services/attention.service';
import { ConfirmService } from 'src/app/services/confirm.service';
import { ProfileService } from 'src/app/services/profile.service';
import { WorkSwitchService } from 'src/app/services/work-switch.service';
import { Prompt } from '../chat-composer/chat-composer.component';
import { chatDefaults } from '../chat-defaults';
import { ChatModel } from '../chat-model-picker/chat-model-picker.component';
import { FileChoice, FilePickerComponent } from '../file-picker/file-picker.component';

/** A chat as its row shows it. */
interface ChatRow extends Chat {
  displayDate: string;
  fullDate: string;
  dateGroup: string;
}

/** The chats page: a new conversation starts at the composer, and every
 *  earlier one is listed under it — searched, archived, restored, or
 *  deleted without leaving the page. */
@Component({
  selector: 'app-chat-home',
  templateUrl: './chat-home.component.html',
  styleUrls: ['./chat-home.component.css'],
  standalone: false,
})
export class ChatHomeComponent implements OnInit {
  @ViewChild('search') private search?: ElementRef<HTMLInputElement>;

  /** The chats of the shelf shown. */
  chats: ChatRow[] = [];
  filteredChats: ChatRow[] = [];
  chatGroups: Array<{ label: string; chats: ChatRow[] }> = [];
  searchQuery = '';
  /** Archived chats are still yours — they are simply out of the way.
   *  Deleting one is the irreversible act, and it stays a separate
   *  button so nobody reaches for it when they meant "put this away". */
  showArchived = false;
  isLoading = false;
  /** Whether the list has arrived once — cached or fetched — so the page
   *  knows a skeleton from "nothing here". */
  chatsLoaded = false;
  loadError = false;
  /** A prompt another page handed over, put in the composer for the
   *  person to read and send. */
  draft = '';
  /** Files handed over by the Files page ("Use in a chat"), staged in
   *  the composer. No chat exists for them yet: one is made when the
   *  message is sent, so nothing is left behind unsent. */
  staged: FileChoice[] | null = null;
  /** What the next chat thinks with, named under the composer and
   *  changed there: what this person last picked. */
  llm: ChatModel = { model: '', model_id: '', effort: '' };

  constructor(
    private router: Router,
    private route: ActivatedRoute,
    private aiSession: AiSessionService,
    private profileService: ProfileService,
    public dialog: MatDialog,
    private attention: AttentionService,
    private confirm: ConfirmService,
    private workSwitch: WorkSwitchService,
  ) {}

  async ngOnInit() {
    const cached = this.aiSession.peekChats();
    if (cached) this.setChats(cached);
    // Refreshed in the background: a new conversation never waits for
    // the list.
    void this.loadChats();
    void this.defaults().then((kept) => (this.llm = {
      model: kept.model || '', model_id: kept.model_id || '', effort: kept.effort || '',
    }));
    const handed = history.state?.stagedFiles;
    if (Array.isArray(handed) && handed.length) {
      // The Files page hands over its records.
      this.staged = handed.map((one) => (one.file ? FilePickerComponent.toChoice(one) : one));
      // Read once: a reload, or Back, must not stage them again.
      const { stagedFiles, ...rest } = history.state || {};
      history.replaceState(rest, '');
    }
    // An agent's page hands over a prompt to try. It is put in the
    // composer and nothing more: an address is something anybody can
    // write, and a link must not be able to make a chat and speak in it
    // as the person who followed it. They read it and press send.
    const prompt = String(this.route.snapshot.queryParamMap.get('prompt') || '').trim();
    if (prompt) {
      this.draft = prompt;
      await this.router.navigate([], { queryParams: {}, replaceUrl: true });
    }
  }

  async loadChats() {
    this.loadError = false;
    try {
      const archived = this.showArchived;
      const chats = await this.aiSession.listChats(archived);
      if (archived !== this.showArchived) return;
      this.setChats(chats);
      if (!archived) this.attention.absorb(chats);
    } catch {
      this.loadError = true;
    }
  }

  private setChats(chats: Chat[]) {
    this.chats = chats.map((chat) => ({
      ...chat,
      title: chat.title || 'Untitled chat',
      displayDate: relativeDate(chat.updated_at),
      fullDate: fullDate(chat.updated_at),
      dateGroup: this.dateGroup(chat.updated_at),
    }));
    this.chatsLoaded = true;
    this.applyFilters();
  }

  /** Stand at the shelf of chats in use, or at the archive. */
  showShelf(archived: boolean) {
    if (archived === this.showArchived) return;
    this.showArchived = archived;
    this.searchQuery = '';
    this.chatsLoaded = false;
    this.chats = [];
    this.applyFilters();
    void this.loadChats();
  }

  /** What the list shows: the search within the shelf, grouped by when. */
  applyFilters() {
    const query = this.searchQuery.trim().toLowerCase();
    this.filteredChats = this.chats.filter((chat) => !query || chat.title.toLowerCase().includes(query));
    const groups = new Map<string, ChatRow[]>();
    for (const chat of this.filteredChats) {
      groups.set(chat.dateGroup, [...(groups.get(chat.dateGroup) || []), chat]);
    }
    this.chatGroups = [...groups.entries()].map(([label, chats]) => ({ label, chats }));
  }

  /** Enter in the search opens the best match — type, Enter, you are
   *  there. */
  openFirstMatch(): void {
    const [first] = this.filteredChats;
    if (first && this.searchQuery.trim()) this.openChat(first.chat_id);
  }

  /** Which of the four groups a chat is listed under. */
  private dateGroup(dateStr: string): string {
    const date = new Date(dateStr);
    if (isNaN(date.getTime())) return 'Earlier';
    const today = new Date();
    const startToday = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
    const startDate = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
    const days = Math.floor((startToday - startDate) / 86400000);
    if (days <= 0) return 'Today';
    if (days === 1) return 'Yesterday';
    return days < 7 ? 'Previous 7 days' : 'Earlier';
  }

  openChat(chatId: string, initialMessage: Prompt | null = null) {
    void this.router.navigate([`ai/chats/${chatId}`], { state: initialMessage ? { initialMessage } : {} });
  }

  async onPrompt(message: Prompt) {
    // Stopped, nothing runs: a chat made now would only hold a message
    // nobody reads, and stay in the list. The words go back in the box.
    if (this.workSwitch.stopped$.value) {
      this.giveBack(message);
      this.alert({
        title: 'Everything is stopped',
        type: 'error',
        messages: [{ description: 'Nothing of yours runs until you resume, from the bar at the top. Your message is still in the box.' }],
      });
      return;
    }
    this.isLoading = true;
    try {
      const kept = await this.defaults();
      const picked = { model: this.llm.model, model_id: this.llm.model_id, effort: this.llm.effort };
      if (kept.model !== picked.model || (kept.model_id || '') !== picked.model_id
          || (kept.effort || '') !== picked.effort) {
        // The model picked here is what the person's next chat starts
        // with too.
        await this.profileService.savePreferences({ chat: { ...kept, ...picked } });
      }
      // First words become the title; the chat's page sends them.
      const res = await this.aiSession.createChat(message.query.substring(0, 80), picked);
      if (res.data?.chat) {
        this.openChat(res.data.chat.chat_id, message);
      } else {
        this.giveBack(message);
        this.alert({ title: 'Chat', type: 'error', messages: [{ description: res.error || 'Failed to create chat.' }] });
      }
    } finally {
      this.isLoading = false;
    }
  }

  /** What the person's new chats start with. */
  private async defaults(): Promise<Partial<ChatSettings>> {
    return chatDefaults((await this.profileService.get().catch(() => null))?.preferences.chat);
  }

  /** A message that went nowhere, back in the box with its files: the
   *  composer emptied itself when it was sent. Emptied, then given back
   *  after a check, so the same words sent twice still come back. */
  private giveBack(message: Prompt): void {
    this.draft = '';
    setTimeout(() => (this.draft = message.query || ''));
    const files = message.uploads.filter((upload) => upload.record_id);
    if (files.length) {
      this.staged = files.map((upload) => ({
        record_id: upload.record_id!, name: upload.filename, type: upload.file_type, size: upload.file_size,
      }));
    }
  }

  onModelChosen(llm: ChatModel): void {
    this.llm = llm;
  }

  alert(message: any) {
    this.dialog.open(AlertComponent, { width: 'auto', data: message });
  }

  /** Archiving needs no confirmation — it is reversible, and asking
   *  about a reversible thing teaches people to click through the
   *  dialogs that matter. */
  async archive(chat: Chat) {
    const res = await this.aiSession.archiveChat(chat.chat_id);
    if (res.error) {
      this.alert({ title: 'Archive failed', type: 'error', messages: [{ description: res.error }] });
      return;
    }
    await this.loadChats();
  }

  async restore(chat: Chat) {
    const res = await this.aiSession.restoreChat(chat.chat_id);
    if (res.error) {
      this.alert({ title: 'Restore failed', type: 'error', messages: [{ description: res.error }] });
      return;
    }
    await this.loadChats();
  }

  /** Deleting is the one act here that cannot be taken back, so it is
   *  asked; once done, the row is simply gone. */
  async askDelete(chat: Chat) {
    const sure = await this.confirm.ask({
      title: `Delete “${chat.title}”?`,
      body: 'Its messages, schedules and the files attached to it are deleted for good. To put it out of the way instead, archive it.',
      confirm: 'Delete',
      danger: true,
    });
    if (!sure) return;
    const res = await this.aiSession.deleteChat(chat.chat_id);
    if (res.error) {
      this.alert({ title: 'Delete failed', type: 'error', messages: [{ description: `“${chat.title}” could not be deleted. ${res.error}` }] });
      return;
    }
    await this.loadChats();
  }

  // ── Keys ────────────────────────────────────────────────────────────

  /** "/" anywhere on the page, outside a box being typed in, goes to
   *  the search. */
  @HostListener('document:keydown', ['$event'])
  onKey(event: KeyboardEvent): void {
    if (event.key !== '/' || event.ctrlKey || event.metaKey || event.altKey) return;
    const typing = event.target instanceof Element
      && event.target.closest('input, textarea, [contenteditable="true"]');
    if (typing) return;
    event.preventDefault();
    this.search?.nativeElement.focus();
  }

  /** The arrows move through the rows, from one conversation's link to
   *  the next. */
  moveThroughRows(event: KeyboardEvent): void {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    const list = event.currentTarget as HTMLElement;
    const rows = Array.from(list.querySelectorAll<HTMLElement>('.chat-open'));
    const at = rows.indexOf(document.activeElement as HTMLElement);
    if (at < 0) return;
    event.preventDefault();
    rows[at + (event.key === 'ArrowDown' ? 1 : -1)]?.focus();
  }
}
