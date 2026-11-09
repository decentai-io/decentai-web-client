import { Directive, ElementRef, Input, OnChanges, OnDestroy } from '@angular/core';

import { FilesService } from '../../services/files.service';

/**
 * A picture of the platform's own, shown with the session.
 *
 * The API server is on another origin and knows the person by the
 * token the app holds, which an `<img src>` cannot carry. So the bytes
 * are fetched with it, and the image is shown from a blob of its own:
 *
 *   <img [appAuthSrc]="recordId" alt="…" />
 *
 * The blob's address is given back when the picture changes or the
 * element goes.
 */
@Directive({
  selector: 'img[appAuthSrc]',
  standalone: true,
})
export class AuthSrcDirective implements OnChanges, OnDestroy {
  /** The file's record id, as `/download/<id>` names it. */
  @Input('appAuthSrc') ref = '';

  private shown = '';
  private round = 0;

  constructor(private image: ElementRef<HTMLImageElement>, private files: FilesService) {}

  ngOnChanges(): void {
    const ref = String(this.ref || '');
    const round = ++this.round;
    this.release();
    if (!ref) {
      this.image.nativeElement.removeAttribute('src');
      return;
    }
    this.files.fetchBlob(ref).then((blob) => {
      if (round !== this.round) return;
      this.shown = URL.createObjectURL(blob);
      this.image.nativeElement.src = this.shown;
    }).catch(() => {
      // The picture stays as its description: the card under it still
      // names the file and offers it.
      if (round === this.round) this.image.nativeElement.removeAttribute('src');
    });
  }

  ngOnDestroy(): void {
    this.round += 1;
    this.release();
  }

  private release(): void {
    if (this.shown) URL.revokeObjectURL(this.shown);
    this.shown = '';
  }
}
