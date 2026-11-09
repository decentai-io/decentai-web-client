import {
  Component, EventEmitter, Input, OnChanges, OnDestroy, OnInit, Output, TemplateRef, ViewChild,
} from '@angular/core';
import { MatDialog, MatDialogRef } from '@angular/material/dialog';

import { Choice } from 'src/app/components/ui/radio-keys';
import { Peer, ProfileService } from 'src/app/services/profile.service';

/** One person who could take something over. */
export type Candidate = Peer;

/**
 * Hand something to another member. The same dialog wherever a thing
 * can be handed on — a record, a skill, an MCP server, a webhook — so
 * the act reads the same everywhere: pick a person, and once they accept,
 * the thing is theirs, with its sharing intact.
 *
 * The people offered are the organization's active members. The current
 * steward is never offered; a transfer to oneself is not a transfer.
 */
@Component({
  selector: 'app-transfer-dialog',
  standalone: false,
  templateUrl: './transfer-dialog.component.html',
  styleUrls: ['./transfer-dialog.component.css'],
})
export class TransferDialogComponent implements OnInit, OnChanges, OnDestroy {
  /** What is being handed over, in words: "the credential “Gmail”". */
  @Input() subject = 'this';
  /** What handing it over means, where it means more than usual. */
  @Input() note = 'It becomes theirs to change and delete. Everyone it is shared with keeps seeing it.';
  /** The current steward, never offered. */
  @Input() ownerId = '';
  @Input() busy = false;
  @Output() chosen = new EventEmitter<Candidate>();
  @Output() closed = new EventEmitter<void>();

  /** What the dialog shows. A page puts <app-transfer-dialog> in its
   *  template while something is being handed over; the component opens
   *  this on the dialog shell as it appears, and says `closed` when the
   *  dialog goes. */
  @ViewChild('sheet', { static: true })
  private sheet!: TemplateRef<unknown>;
  private dialogRef?: MatDialogRef<unknown>;

  loading = true;
  candidates: Candidate[] = [];
  query = '';
  selectedId = '';

  constructor(
    private profiles: ProfileService,
    private dialog: MatDialog,
  ) {}

  ngOnChanges(): void {
    // While the hand-over is on its way the dialog stays.
    if (this.dialogRef) this.dialogRef.disableClose = this.busy;
  }

  ngOnDestroy(): void {
    this.dialogRef?.close();
  }

  async ngOnInit(): Promise<void> {
    this.dialogRef = this.dialog.open(this.sheet, { width: '480px' });
    this.dialogRef.afterClosed().subscribe(() => {
      this.dialogRef = undefined;
      this.closed.emit();
    });

    const people = (await this.profiles.peers().catch(() => null))?.people ?? [];
    this.candidates = people.filter((person) => person.user_id !== this.ownerId)
      .sort((a, b) => (a.name || a.email).localeCompare(b.name || b.email));
    this.loading = false;
  }

  get visible(): Candidate[] {
    const q = this.query.trim().toLowerCase();
    if (!q) return this.candidates;
    return this.candidates.filter((c) =>
      `${c.name} ${c.email}`.toLowerCase().includes(q));
  }

  /** The people shown, as the choices of the dialog's cards. */
  get choices(): Choice[] {
    this.refreshChoices();
    return this.shown;
  }
  private shown: Choice[] = [];
  private shownFor = '';

  /** Rebuilt only when the search or the people change, so the cards
   *  keep their elements while one is being chosen. */
  private refreshChoices(): void {
    const key = `${this.query}|${this.candidates.length}`;
    if (key === this.shownFor) return;
    this.shownFor = key;
    this.shown = this.visible.map((person) => ({
      value: person.user_id,
      name: person.name || person.email,
      hint: person.name ? person.email : undefined,
    }));
  }

  get selected(): Candidate | null {
    return this.candidates.find((c) => c.user_id === this.selectedId) || null;
  }

  confirm(): void {
    const pick = this.selected;
    if (pick && !this.busy) this.chosen.emit(pick);
  }

  close(): void {
    if (!this.busy) this.dialogRef?.close();
  }
}
