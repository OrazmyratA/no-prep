import { Component, Input } from '@angular/core';
import { BookPage } from '../../../core/book.model';

@Component({
  selector: 'app-book-reader-page-frame',
  standalone: false,
  templateUrl: './book-reader-page-frame.html',
  styleUrls: ['./book-reader-stage.css', './book-reader-elements.css', './book-reader-page-frame.css']
})
export class BookReaderPageFrameComponent {
  @Input({ required: true }) reader!: any;
  @Input({ required: true }) page!: BookPage;
  @Input() pdfUrl = '';
  @Input() primary = false;
  @Input() companion = false;

  // Shared with the reader's page prefetching: a prefetched page only helps if it was drawn at
  // exactly the scale the visible frame will later ask for.
  static readonly PRIMARY_RENDER_SCALE = 1.7;
  static readonly COMPANION_RENDER_SCALE = 1.35;
  static readonly FOCUS_CROP_RENDER_SCALE = 2.6;

  get renderScale(): number {
    if (!this.primary) return BookReaderPageFrameComponent.COMPANION_RENDER_SCALE;
    return this.reader.isFocusCropActive(this.page)
      ? BookReaderPageFrameComponent.FOCUS_CROP_RENDER_SCALE
      : BookReaderPageFrameComponent.PRIMARY_RENDER_SCALE;
  }
}
