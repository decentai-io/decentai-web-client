import { Component, EventEmitter, Input, OnInit, Output } from '@angular/core';

import { EngineService } from '../../services/engine.service';

/**
 * The first screen, when no engine is named: which DecentAI to sign in
 * to, as the app on a phone asks. The address is asked whether an
 * engine answers there before it is kept, so a typo is said here and
 * not as a sign-in that cannot work. It is also where **Change** on the
 * sign-in page leads, with the current address filled in.
 */
@Component({
  selector: 'app-connect',
  templateUrl: './connect.component.html',
  styleUrls: ['./connect.component.css'],
  standalone: false,
})
export class ConnectComponent implements OnInit {
  /** Whether an engine is already named: the screen then offers a way
   *  back without changing anything. */
  @Input() changing = false;
  /** An engine answers at this address: the app signs out of the one
   *  it was signed in to, keeps this one, and goes on to the session. */
  @Output() connected = new EventEmitter<string>();
  /** Nothing changed: back to where the person was. */
  @Output() cancelled = new EventEmitter<void>();

  server = '';
  busy = false;
  tried = false;
  /** Why the address was not kept, said under the field. */
  problem = '';

  constructor(private engine: EngineService) {}

  ngOnInit(): void {
    // What is set is offered to change; a page assuming its own origin
    // offers nothing, since that origin answered as no engine.
    this.server = this.engine.configured ? this.engine.url : '';
  }

  get title(): string {
    return this.changing ? 'Change the engine' : 'Connect to DecentAI';
  }

  get sentence(): string {
    return this.changing
      ? 'Sign-ins go to this address. Changing it signs you out here.'
      : 'Enter the address of the DecentAI engine your organization runs.';
  }

  get serverProblem(): string {
    if (!this.server.trim()) return 'Enter the engine\'s address.';
    try {
      new URL(EngineService.normalize(this.server));
      return '';
    } catch {
      return 'That is not an address.';
    }
  }

  async connect(): Promise<void> {
    this.tried = true;
    this.problem = '';
    if (this.serverProblem) return;
    this.busy = true;
    try {
      const address = EngineService.normalize(this.server);
      const found = await EngineService.probe(address);
      if (found === 'unreachable') {
        this.problem = 'Could not reach that address. Check it, and your connection.';
        return;
      }
      if (found === 'not-engine') {
        this.problem = 'Something answers there, but it is not a DecentAI engine. '
          + 'The address is the engine\'s, not this page\'s.';
        return;
      }
      // Not chosen here: the session at the old engine is ended at the
      // old engine first, with its own token (AppComponent.engineChosen).
      this.connected.emit(address);
    } finally {
      this.busy = false;
    }
  }

  cancel(): void {
    this.cancelled.emit();
  }
}
