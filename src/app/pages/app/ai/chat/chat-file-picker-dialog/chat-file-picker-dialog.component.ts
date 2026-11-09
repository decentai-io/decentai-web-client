import { Component } from '@angular/core';
import { MatDialogRef } from '@angular/material/dialog';
import { FileChoice } from '../file-picker/file-picker.component';

/**
 * "Choose from your files" in the composer: the picker in a dialog,
 * the newest few leading, and the choice handed back to the composer
 * as attachments-to-be. Nothing is uploaded: these files are already
 * the person's, and a message names them by their record id.
 */
@Component({
  selector: 'app-chat-file-picker-dialog',
  standalone: false,
  templateUrl: './chat-file-picker-dialog.component.html',
})
export class ChatFilePickerDialogComponent {
  chosen: FileChoice[] = [];

  constructor(private dialogRef: MatDialogRef<ChatFilePickerDialogComponent, FileChoice[]>) {}

  attach(): void {
    if (!this.chosen.length) return;
    this.dialogRef.close(this.chosen);
  }

  close(): void {
    this.dialogRef.close();
  }
}
