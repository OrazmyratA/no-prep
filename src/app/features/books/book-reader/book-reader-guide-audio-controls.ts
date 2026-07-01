import { Component, Input } from '@angular/core';

@Component({
  selector: 'app-book-reader-guide-audio-controls',
  standalone: false,
  templateUrl: './book-reader-guide-audio-controls.html',
  styleUrls: ['./book-reader-guide-audio-controls.css']
})
export class BookReaderGuideAudioControlsComponent {
  @Input({ required: true }) reader!: any;
}
