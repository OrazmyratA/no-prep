import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { SharedModule } from '../../../shared/shared.module';
import { TranslatePipe } from '../../../shared/translate-pipe';
import { BooksSharedModule } from '../books-shared.module';
import { canDeactivateBookReader } from '../book-unsaved.guard';
import { BookReaderComponent } from './book-reader';
import { BookReaderGuideAudioControlsComponent } from './book-reader-guide-audio-controls';
import { BookReaderPageDrawerComponent } from './book-reader-page-drawer';
import { BookReaderPageFrameComponent } from './book-reader-page-frame';
import { BookReaderProgressMapComponent } from './book-reader-progress-map';
import { BookReaderSpeakingPanelComponent } from './book-reader-speaking-panel';
import { BookReaderTaskOverlayComponent } from './book-reader-task-overlay';
import { BookReaderToolbarComponent } from './book-reader-toolbar';

// Lazy on its own, so reading a book does not download the book creator.
@NgModule({
  declarations: [
    BookReaderComponent,
    BookReaderGuideAudioControlsComponent,
    BookReaderPageDrawerComponent,
    BookReaderPageFrameComponent,
    BookReaderProgressMapComponent,
    BookReaderSpeakingPanelComponent,
    BookReaderTaskOverlayComponent,
    BookReaderToolbarComponent
  ],
  imports: [
    CommonModule,
    FormsModule,
    SharedModule,
    TranslatePipe,
    BooksSharedModule,
    RouterModule.forChild([{ path: '', component: BookReaderComponent, canDeactivate: [canDeactivateBookReader] }])
  ]
})
export class BookReaderModule {}
