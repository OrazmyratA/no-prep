import { Component, Input } from '@angular/core';

@Component({
  selector: 'app-book-creator-inspector',
  standalone: false,
  templateUrl: './book-creator-inspector.html',
  styleUrls: ['./book-creator-inspector.css']
})
export class BookCreatorInspectorComponent {
  @Input({ required: true }) creator!: any;
}
