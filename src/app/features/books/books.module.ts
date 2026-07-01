import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { SharedModule } from '../../shared/shared.module';
import { BooksRoutingModule } from './books-routing.module';
import { BookCreatorComponent } from './book-creator/book-creator';
import { BookReaderComponent } from './book-reader/book-reader';
import { BookReaderPageDrawerComponent } from './book-reader/book-reader-page-drawer';
import { BookReaderSpeakingPanelComponent } from './book-reader/book-reader-speaking-panel';
import { BookReaderTaskOverlayComponent } from './book-reader/book-reader-task-overlay';
import { BookSwitcherComponent } from './book-switcher/book-switcher';
import { PdfPageCanvasComponent } from './pdf-page-canvas/pdf-page-canvas';
import { TranslatePipe } from '../../shared/translate-pipe';

@NgModule({
  declarations: [BookCreatorComponent, BookReaderComponent, BookReaderPageDrawerComponent, BookReaderSpeakingPanelComponent, BookReaderTaskOverlayComponent, BookSwitcherComponent, PdfPageCanvasComponent],
  imports: [CommonModule, FormsModule, SharedModule, BooksRoutingModule, TranslatePipe]
})
export class BooksModule {}
