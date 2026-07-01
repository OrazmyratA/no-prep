import { Component, Input } from '@angular/core';

@Component({
  selector: 'app-book-reader-toolbar',
  standalone: false,
  templateUrl: './book-reader-toolbar.html',
  styleUrls: ['./book-reader-controls.css', './book-reader-toolbar.css']
})
export class BookReaderToolbarComponent {
  @Input({ required: true }) reader!: any;
}
