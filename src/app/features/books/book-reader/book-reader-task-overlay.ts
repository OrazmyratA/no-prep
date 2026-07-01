import { Component, Input } from '@angular/core';

@Component({
  selector: 'app-book-reader-task-overlay',
  standalone: false,
  templateUrl: './book-reader-task-overlay.html',
  styleUrls: ['./book-reader-task-overlay.css']
})
export class BookReaderTaskOverlayComponent {
  @Input({ required: true }) reader!: any;
}
