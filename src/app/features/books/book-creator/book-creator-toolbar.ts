import { Component, Input } from '@angular/core';

@Component({
  selector: 'app-book-creator-toolbar',
  standalone: false,
  templateUrl: './book-creator-toolbar.html',
  styleUrls: ['./book-creator-toolbar.css']
})
export class BookCreatorToolbarComponent {
  @Input({ required: true }) creator!: any;
}
