import { Component, Input } from '@angular/core';

@Component({
  selector: 'app-book-creator-page-strip',
  standalone: false,
  templateUrl: './book-creator-page-strip.html',
  styleUrls: ['./book-creator-page-strip.css']
})
export class BookCreatorPageStripComponent {
  @Input({ required: true }) creator!: any;
}
