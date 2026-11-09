import { Injectable } from '@angular/core';

import { EngineService } from './engine.service';
import { AppRecord, RecordOf } from './records.service';
import { SessionTokenService } from './session-token.service';

/**
 * A file's bytes, in and out. What is known of a file is a record
 * (RecordsService, kind `file`); its bytes go up to `/upload` and come
 * back from `/download/<record id>`, fetched with the session token: the
 * API server is on another origin, and a link or an `<img>` carries no
 * token, so the bytes are fetched here and shown or saved from a blob
 * (`fetchBlob`, `download`, `open`).
 */
@Injectable({ providedIn: 'root' })
export class FilesService {
  constructor(
    private engine: EngineService,
    private session: SessionTokenService,
  ) {}

  /** The largest file `/upload` takes by default, in MB. */
  static readonly MAX_UPLOAD_MB = 25;

  /** Upload one file from the page: its bytes as the body, its name in
   *  the address, and, for a file of an agent's resource, which. The
   *  file is the person's own, made a record. `progress` is told how
   *  much has been sent, from 0 to 1; `cancel` stops it, and the answer
   *  then says so. */
  upload(file: File, progress?: (sent: number) => void, of?: RecordOf): {
    done: Promise<{ record?: AppRecord; error?: string }>;
    cancel: () => void;
  } {
    const call = new XMLHttpRequest();
    const done = new Promise<{ record?: AppRecord; error?: string }>((resolve) => {
      const answer = (): any => {
        try { return JSON.parse(call.responseText || '{}'); } catch { return {}; }
      };
      call.upload.onprogress = (event) => {
        if (event.lengthComputable) progress?.(event.loaded / event.total);
      };
      call.onload = () => {
        const body = answer();
        resolve(call.status === 200 && body.record
          ? { record: body.record }
          : { error: body.error?.message || `The upload was refused (${call.status}).` });
      };
      call.onerror = () => resolve({ error: 'The connection was lost before the file arrived.' });
      call.onabort = () => resolve({ error: 'Cancelled.' });
    });

    const query = new URLSearchParams({ name: file.name, ...(of ? { agent: of.agent, resource: of.resource } : {}) });
    call.open('POST', this.engine.http(`upload?${query}`));
    // The session token rides on this, as on every call.
    for (const [name, value] of Object.entries(this.session.headers())) {
      call.setRequestHeader(name, value);
    }
    call.setRequestHeader('Content-Type', file.type || 'application/octet-stream');
    call.send(file);
    return { done, cancel: () => call.abort() };
  }

  /** The download route's address for a file. It needs the session
   *  token, which a bare link cannot carry: `fetchBlob` is how the
   *  bytes are read. */
  downloadUrl(recordId: string): string {
    return this.engine.http(`download/${encodeURIComponent(recordId)}`);
  }

  /** The file's bytes, fetched with the session. */
  async fetchBlob(recordId: string): Promise<Blob> {
    const answer = await fetch(this.downloadUrl(recordId), { headers: this.session.headers() });
    if (!answer.ok) throw new Error(String(answer.status));
    return answer.blob();
  }

  /** Save a file through the browser's download, under its name. */
  async download(recordId: string, filename: string): Promise<void> {
    await this.saveBlob(await this.fetchBlob(recordId), filename || recordId);
  }

  /**
   * Show a file in a new tab, when it is a kind a tab shows as itself
   * and nothing more: a PDF, a picture, plain text, sound or video. Any
   * other kind is saved instead.
   *
   * A tab opened on an address made here (`blob:`) is a page of this
   * app's own origin, beside the session's token. A file that a browser
   * would run — HTML, SVG, XML — opened that way would run as this app,
   * whoever uploaded it, so it never is: the bytes are given a type
   * from the list below, never the one the file arrived with.
   */
  async open(recordId: string, filename = ''): Promise<void> {
    const blob = await this.fetchBlob(recordId);
    const shown = FilesService.shownAs(blob.type);
    if (!shown) {
      await this.saveBlob(blob, filename || recordId);
      return;
    }
    const url = URL.createObjectURL(new Blob([blob], { type: shown }));
    window.open(url, '_blank', 'noopener');
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }

  /** The type a tab is given for a file of this type, or nothing when
   *  the file is to be saved rather than shown. */
  static shownAs(type: string): string {
    const bare = String(type || '').split(';')[0].trim().toLowerCase();
    return FilesService.SHOWN.has(bare) || /^(audio|video)\/[\w.+-]+$/.test(bare)
      ? bare : '';
  }

  /** The kinds a tab shows as themselves and runs nothing in. Not SVG:
   *  an SVG is a document that may carry script. */
  private static readonly SHOWN = new Set([
    'application/pdf',
    'image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/avif', 'image/bmp',
    'text/plain', 'text/csv',
  ]);

  private async saveBlob(blob: Blob, filename: string): Promise<void> {
    const url = URL.createObjectURL(blob);
    try {
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } finally {
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    }
  }
}
