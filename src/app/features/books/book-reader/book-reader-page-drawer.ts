import { Component, Input } from '@angular/core';

@Component({
  selector: 'app-book-reader-page-drawer',
  standalone: false,
  templateUrl: './book-reader-page-drawer.html',
  styleUrls: ['./book-reader-page-drawer.css']
})
export class BookReaderPageDrawerComponent {
  @Input({ required: true }) reader!: any;
}
