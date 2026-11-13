import { NgFor, NgIf } from '@angular/common';
import {
  Component, EventEmitter, Input, OnChanges, OnDestroy, OnInit, Output, TemplateRef, ViewChild,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatDialog, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { LucideAngularModule } from 'lucide-angular';

import { FieldComponent } from 'src/app/components/ui/field.component';
import { Choice } from 'src/app/components/ui/radio-keys';
import { SelectComponent } from 'src/app/components/ui/select.component';
import { AppRecord, RecordOf, RecordShape } from 'src/app/services/records.service';
import { agentLabel } from './record-page';

/**
 * The agents that may use one record, chosen in a dialog. Each is an
 * agent and the resource of its own the record serves. The one the
 * record was made for always stays; any other is added by hand, from
 * the resources of the same kind the person's agents declare. Whether
 * the record fits one is the API server's to say, and its refusal is
 * shown here.
 *
 * The page puts <app-record-agents> in its template while it is open,
 * and saves what it says.
 */
@Component({
  selector: 'app-record-agents',
  standalone: true,
  imports: [NgFor, NgIf, FormsModule, MatDialogModule, LucideAngularModule, FieldComponent, SelectComponent],
  template: `
    <ng-template #sheet>
      <h2 mat-dialog-title>Agents that may use it</h2>
      <mat-dialog-content>
        <div class="form">
          <p class="dialog-note">An agent reaches only the records that list it, and only for the resource named.</p>
          <ul class="agents-listed">
            <li *ngFor="let entry of listed">
              <span class="agents-words">
                <span class="agents-name">{{ nameOf(entry) }}</span>
                <span class="agents-hint">{{ isOwn(entry) ? 'Made for it' : labelOf(entry) }}</span>
              </span>
              <button class="icon-btn sm" type="button" *ngIf="!isOwn(entry)" [disabled]="busy"
                      [attr.aria-label]="'Take it from ' + nameOf(entry)" (click)="drop(entry)">
                <lucide-icon name="x" [size]="16" aria-hidden="true"></lucide-icon>
              </button>
            </li>
          </ul>
          <p class="dialog-note" *ngIf="!listed.length">No agent may use it.</p>
          <app-field label="Add an agent" *ngIf="choices.length">
            <app-select name="add" placeholder="Choose an agent and what it keeps" [choices]="choices"
                        [ngModel]="''" (ngModelChange)="add($event)"></app-select>
          </app-field>
          <p class="form-notice is-error" role="alert" *ngIf="problem">{{ problem }}</p>
        </div>
      </mat-dialog-content>
      <mat-dialog-actions>
        <button class="btn" type="button" [disabled]="busy" (click)="close()">Cancel</button>
        <button class="btn primary" type="button" [disabled]="busy" (click)="save.emit(listed)">{{ busy ? 'Saving…' : 'Save' }}</button>
      </mat-dialog-actions>
    </ng-template>
  `,
  styles: [`
    .agents-listed { display: grid; gap: 8px; margin: 0; padding: 0; list-style: none; }
    .agents-listed li { display: flex; align-items: center; gap: 8px; }
    .agents-words { display: grid; flex: 1; min-width: 0; }
    .agents-name { color: var(--ink); font-weight: 500; }
    .agents-hint { color: var(--ink-2); font-size: var(--t-sm); }
  `],
})
export class RecordAgentsComponent implements OnInit, OnChanges, OnDestroy {
  @Input({ required: true }) record!: AppRecord;
  /** The resources of the record's kind the person's agents declare. */
  @Input() shapes: RecordShape[] = [];
  @Input() busy = false;
  /** Why the last save was refused. */
  @Input() problem = '';

  @Output() save = new EventEmitter<RecordOf[]>();
  @Output() closed = new EventEmitter<void>();

  @ViewChild('sheet', { static: true })
  private sheet!: TemplateRef<unknown>;
  private dialogRef?: MatDialogRef<unknown>;

  listed: RecordOf[] = [];
  choices: Choice[] = [];

  constructor(private dialog: MatDialog) {}

  ngOnInit(): void {
    this.listed = [...this.record.agents];
    this.offer();
    this.dialogRef = this.dialog.open(this.sheet, { width: '480px', maxWidth: '100vw' });
    this.dialogRef.afterClosed().subscribe(() => {
      this.dialogRef = undefined;
      this.closed.emit();
    });
  }

  ngOnChanges(): void {
    // While the save is on its way the dialog stays.
    if (this.dialogRef) this.dialogRef.disableClose = this.busy;
  }

  ngOnDestroy(): void {
    this.dialogRef?.close();
  }

  private shapeOf(entry: RecordOf): RecordShape | undefined {
    return this.shapes.find((shape) => shape.agent === entry.agent && shape.id === entry.resource);
  }

  nameOf(entry: RecordOf): string {
    return this.shapeOf(entry)?.agent_name || agentLabel(entry.agent);
  }

  labelOf(entry: RecordOf): string {
    return this.shapeOf(entry)?.label || entry.resource;
  }

  isOwn(entry: RecordOf): boolean {
    return !!this.record.of && this.record.of.agent === entry.agent && this.record.of.resource === entry.resource;
  }

  /** What may still be added: every resource of the kind not listed. */
  private offer(): void {
    this.choices = this.shapes
      .filter((shape) => !this.listed.some((entry) => entry.agent === shape.agent && entry.resource === shape.id))
      .map((shape) => ({
        value: `${shape.agent}/${shape.id}`, name: shape.agent_name,
        hint: [shape.label || shape.id, shape.description].filter(Boolean).join(': '),
      }));
  }

  add(value: string): void {
    const [agent, resource] = value.split('/');
    if (!agent || !resource) return;
    this.listed = [...this.listed, { agent, resource }];
    this.offer();
  }

  drop(entry: RecordOf): void {
    this.listed = this.listed.filter((other) => other !== entry);
    this.offer();
  }

  close(): void {
    if (!this.busy) this.dialogRef?.close();
  }
}
