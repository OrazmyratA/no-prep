import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { BookCreatorComponent } from './book-creator/book-creator';
import { BookReaderComponent } from './book-reader/book-reader';
import { canDeactivateBookCreator } from './book-unsaved.guard';

const routes: Routes = [
  { path: 'new', component: BookCreatorComponent, canDeactivate: [canDeactivateBookCreator] },
  { path: ':id/edit', component: BookCreatorComponent, canDeactivate: [canDeactivateBookCreator] },
  { path: ':id/read', component: BookReaderComponent }
];

@NgModule({
  imports: [RouterModule.forChild(routes)],
  exports: [RouterModule]
})
export class BooksRoutingModule {}
