import { Component, ElementRef, Input, ViewChild } from '@angular/core';

@Component({
  selector: 'app-book-reader-speaking-panel',
  standalone: false,
  templateUrl: './book-reader-speaking-panel.html',
  styleUrls: ['./book-reader-speaking.css', './book-reader-speaking-responsive.css']
})
export class BookReaderSpeakingPanelComponent {
  @Input({ required: true }) reader!: any;

  @ViewChild('speakingAiChat') speakingAiChat?: ElementRef<HTMLElement>;
  @ViewChild('speakingRecordButton') speakingRecordButton?: ElementRef<HTMLButtonElement>;
}
