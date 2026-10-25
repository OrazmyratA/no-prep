import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';

// Reader and creator are separate lazy chunks: a teacher opening a book to read does not
// download or parse the creator, and the other way round. ':id' reaches their '' routes.
const loadCreator = () => import('./book-creator/book-creator.module').then(m => m.BookCreatorModule);
const loadReader = () => import('./book-reader/book-reader.module').then(m => m.BookReaderModule);

const routes: Routes = [
  { path: 'new', loadChildren: loadCreator },
  { path: ':id/edit', loadChildren: loadCreator },
  { path: ':id/read', loadChildren: loadReader }
];

@NgModule({
  imports: [RouterModule.forChild(routes)],
  exports: [RouterModule]
})
export class BooksRoutingModule {}
