import { Component, ElementRef, Input, ViewChild } from '@angular/core';
import { SwipeDirective } from '../../../shared/swipe.directive';

@Component({
  selector: 'app-book-creator-editor-surface',
  standalone: false,
  templateUrl: './book-creator-editor-surface.html',
  styleUrls: ['./book-creator-editor-surface.css']
})
export class BookCreatorEditorSurfaceComponent {
  @Input({ required: true }) creator!: any;

  @ViewChild('editorCanvas') editorCanvas?: ElementRef<HTMLElement>;
  @ViewChild('editorCanvasShell') editorCanvasShell?: ElementRef<HTMLElement>;
  @ViewChild('creatorDrawingCanvas') creatorDrawingCanvas?: ElementRef<HTMLCanvasElement>;
  @ViewChild(SwipeDirective) swipeDir?: SwipeDirective;
}
