import { NgClass, NgFor, NgIf } from '@angular/common';
import { Component, Inject, OnInit } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogModule } from '@angular/material/dialog';
import { MatTooltipModule } from '@angular/material/tooltip';

import { EmptyComponent } from 'src/app/components/ui/empty.component';
import { fullDate, relativeDate } from 'src/app/components/ui/dates';
import { OutboundDelivery, OutboundService } from 'src/app/services/outbound.service';

/** Whose sends: one notification out. */
export interface DeliveriesDialogData {
  id: string;
  name: string;
}

/** One line of the list, in words. */
interface DeliveryLine {
  word: string;
  tone: string;
  what: string;
  at: string;
  atInFull: string;
}

/** How a send ended, in a word and the chip's tone. */
const OUTCOME: Record<OutboundDelivery['outcome'], { word: string; tone: string }> = {
  sent: { word: 'Delivered', tone: 'accent' },
  refused: { word: 'Refused', tone: 'danger' },
  failed: { word: 'Failed, tried again', tone: 'warn' },
};

/**
 * The last twenty sends to a notification out: how each ended, and what
 * the receiver answered. (What a webhook in heard is its own page's,
 * under AI › Webhooks.)
 */
@Component({
  selector: 'app-deliveries-dialog',
  standalone: true,
  imports: [NgIf, NgFor, NgClass, MatDialogModule, MatTooltipModule, EmptyComponent],
  styleUrl: './outbound.component.css',
  template: `
    <h2 mat-dialog-title>Deliveries of {{ data.name }}</h2>
    <mat-dialog-content>
      <p class="dialog-note">The latest first.</p>
      <div *ngIf="loading" aria-busy="true" aria-label="Loading deliveries">
        <span class="sk sk-field"></span>
      </div>
      <app-empty *ngIf="!loading && problem" icon="triangle-alert" title="The deliveries could not be read" [line]="problem">
        <button class="btn" type="button" (click)="load()">Try again</button>
      </app-empty>
      <app-empty *ngIf="!loading && !problem && !lines.length" icon="send"
                 title="Nothing has been sent yet" line="Notifications show here as they are sent."></app-empty>
      <ul class="hook-deliveries" *ngIf="!loading && lines.length">
        <li class="hook-delivery" *ngFor="let line of lines">
          <span class="hook-delivery-head">
            <span class="chip" [ngClass]="line.tone">{{ line.word }}</span>
            <span>{{ line.what }}</span>
            <span [matTooltip]="line.atInFull">{{ line.at }}</span>
          </span>
        </li>
      </ul>
    </mat-dialog-content>
    <mat-dialog-actions>
      <button class="btn" type="button" [disabled]="loading" (click)="load()">Refresh</button>
      <button class="btn primary" type="button" mat-dialog-close>Close</button>
    </mat-dialog-actions>
  `,
})
export class DeliveriesDialogComponent implements OnInit {
  loading = true;
  problem = '';
  lines: DeliveryLine[] = [];

  constructor(
    @Inject(MAT_DIALOG_DATA) public data: DeliveriesDialogData,
    private service: OutboundService,
  ) {}

  ngOnInit(): Promise<void> {
    return this.load();
  }

  async load(): Promise<void> {
    this.loading = true;
    this.problem = '';
    try {
      const page = await this.service.deliveries(this.data.id);
      if (page.error) this.problem = page.error;
      this.lines = [...page.deliveries].reverse().map((one) => ({
        ...(OUTCOME[one.outcome] ?? OUTCOME.failed),
        what: one.status ? `The address answered ${one.status}` : 'The address could not be reached',
        at: relativeDate(one.at), atInFull: fullDate(one.at),
      }));
    } catch {
      this.problem = 'Could not reach the server. Check your connection.';
    } finally {
      this.loading = false;
    }
  }
}
