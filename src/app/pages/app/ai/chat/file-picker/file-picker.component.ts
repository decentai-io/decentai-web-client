import { Component, EventEmitter, Input, OnInit, Output } from '@angular/core';

import { sizeLabel } from 'src/app/components/ui/file-types';
import { AppRecord, RecordsService } from 'src/app/services/records.service';

/** A file of the person's, as a message attaches it: by its record id. */
export interface FileChoice {
  record_id: string;
  name: string;
  type: string;
  size: number;
  created_at?: string;
}

/**
 * Choosing files from everything the person can see.
 *
 * Two places: the composer's "choose from your files", where the newest
 * few lead, and the Files page, which stages one file straight into a
 * new chat (`toChoice`). The list is the Files page's, searched by name
 * here.
 *
 * The picker owns the ticks and says what changed; whoever embeds it
 * owns the buttons and what the choice means.
 */
@Component({
  selector: 'app-file-picker',
  standalone: false,
  templateUrl: './file-picker.component.html',
  styleUrls: ['./file-picker.component.css'],
})
export class FilePickerComponent implements OnInit {
  /** With no search, the newest this many lead. */
  @Input() recentCount = 0;

  @Output() selectionChange = new EventEmitter<FileChoice[]>();

  /** How many search results are listed at once. */
  static readonly SEARCH_LIMIT = 30;

  selected = new Set<string>();
  search = '';
  loading = false;
  error = '';
  private everything: FileChoice[] | null = null;

  constructor(private records: RecordsService) {}

  ngOnInit(): void {
    void this.loadEverything();
  }

  /** The newest few. */
  get leading(): FileChoice[] {
    return (this.everything || []).slice(0, this.recentCount);
  }

  /** Files the search finds, the leading ones left out: they are listed
   *  above. */
  get searchResults(): FileChoice[] {
    const words = this.search.trim().toLowerCase();
    if (!words) return [];
    const listed = new Set(this.leading.map((file) => file.record_id));
    return (this.everything || [])
      .filter((file) => !listed.has(file.record_id) && file.name.toLowerCase().includes(words))
      .slice(0, FilePickerComponent.SEARCH_LIMIT);
  }

  get searching(): boolean {
    return !!this.search.trim() && !this.loading;
  }

  isSelected(id: string): boolean {
    return this.selected.has(id);
  }

  toggle(id: string): void {
    if (!this.selected.delete(id)) this.selected.add(id);
    this.selectionChange.emit((this.everything || []).filter((file) => this.selected.has(file.record_id)));
  }

  /** One line under the name: kind, size, when. */
  fileMeta(file: FileChoice): string {
    const dot = file.name.lastIndexOf('.');
    const kind = dot > 0 ? file.name.slice(dot + 1).toUpperCase() : file.type.split('/').pop()?.toUpperCase() || 'FILE';
    const when = file.created_at ? new Date(file.created_at).toLocaleDateString() : '';
    return [kind, file.size ? sizeLabel(file.size) : '', when].filter(Boolean).join(' · ');
  }

  /** A file record, in the picker's shape. */
  static toChoice(record: AppRecord): FileChoice {
    return {
      record_id: record.record_id, name: record.file?.name || 'a file', type: record.file?.type || '',
      size: record.file?.size || 0, created_at: record.created_at || '',
    };
  }

  private async loadEverything(): Promise<void> {
    this.loading = true;
    this.error = '';
    try {
      const found = await this.records.list('file');
      this.everything = found.records.map((record) => FilePickerComponent.toChoice(record))
        .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
    } catch {
      this.everything = [];
      this.error = 'Your files could not be listed.';
    } finally {
      this.loading = false;
    }
  }
}
