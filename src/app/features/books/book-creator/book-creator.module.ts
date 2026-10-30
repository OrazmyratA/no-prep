import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { SharedModule } from '../../../shared/shared.module';
import { TranslatePipe } from '../../../shared/translate-pipe';
import { BooksSharedModule } from '../books-shared.module';
import { canDeactivateBookCreator } from '../book-unsaved.guard';
import { BookCreatorComponent } from './book-creator';
import { BookCreatorEditorSurfaceComponent } from './book-creator-editor-surface';
import { BookCreatorInspectorComponent } from './book-creator-inspector';
import { BookCreatorPageStripComponent } from './book-creator-page-strip';
import { BookCreatorToolbarComponent } from './book-creator-toolbar';
import { BookCreatorVideoSubtitlesComponent } from './book-creator-video-subtitles';
import { LessonPlanPanelComponent } from './lesson-plan-panel/lesson-plan-panel';
import { TaskPrepPanelComponent } from './task-prep-panel/task-prep-panel';

// Lazy on its own, so opening a book to read does not download the creator.
@NgModule({
  declarations: [
    BookCreatorComponent,
    BookCreatorEditorSurfaceComponent,
    BookCreatorInspectorComponent,
    BookCreatorPageStripComponent,
    BookCreatorToolbarComponent,
    BookCreatorVideoSubtitlesComponent,
    LessonPlanPanelComponent,
    TaskPrepPanelComponent
  ],
  imports: [
    CommonModule,
    FormsModule,
    SharedModule,
    TranslatePipe,
    BooksSharedModule,
    RouterModule.forChild([{ path: '', component: BookCreatorComponent, canDeactivate: [canDeactivateBookCreator] }])
  ]
})
export class BookCreatorModule {}
