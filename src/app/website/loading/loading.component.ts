import { Component, EventEmitter, Input, Output } from '@angular/core';

/**
 * The card shown while the app finds out who is here. An API server that
 * does not answer is waited on, and after a few tries the card says
 * so, with a way to ask again at once.
 */
@Component({
  selector: 'app-loading',
  standalone: false,
  templateUrl: './loading.component.html',
})
export class LoadingComponent {
  /** The API server has not answered for a while. */
  @Input() unreachable = false;
  @Output() retry = new EventEmitter<void>();
}
