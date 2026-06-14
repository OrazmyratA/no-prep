import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';

const routes: Routes = [
  { path: '', redirectTo: '/topics', pathMatch: 'full' },
  { path: 'topics', loadChildren: () => import('./features/topics/topics.module').then(m => m.TopicsModule) },
  { path: 'books', loadChildren: () => import('./features/books/books.module').then(m => m.BooksModule) },
  { path: 'download', loadChildren: () => import('./features/download/download.module').then(m => m.DownloadModule) },
];

@NgModule({
  imports: [RouterModule.forRoot(routes, { useHash: true })],
  exports: [RouterModule]
})
export class AppRoutingModule { }
