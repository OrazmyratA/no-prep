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

  get renderScale(): number {
    if (!this.primary) return 1.35;
    return this.reader.isFocusCropActive(this.page) ? 2.6 : 1.7;
  }
}
