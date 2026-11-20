import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';

const routes: Routes = [
  { path: '', redirectTo: '/topics', pathMatch: 'full' },
  { path: 'topics', loadChildren: () => import('./features/topics/topics.module').then(m => m.TopicsModule) },
  { path: 'books', loadChildren: () => import('./features/books/books.module').then(m => m.BooksModule) },
  {
    // Speaking Check: a class's speaking test marked live (opened from the student selector).
    path: 'speaking-check',
    loadComponent: () => import('./features/speaking-check/speaking-check').then(m => m.SpeakingCheckComponent)
  },
  {
    path: 'presentations/link/:id',
    loadComponent: () => import('./features/presentations/presentation-link-player').then(m => m.PresentationLinkPlayerComponent)
  },
  {
    path: 'presentations/:id/play',
    loadComponent: () => import('./features/presentations/presentation-player').then(m => m.PresentationPlayerComponent)
  },
  { path: 'download', loadChildren: () => import('./features/download/download.module').then(m => m.DownloadModule) },
];

@NgModule({
  imports: [RouterModule.forRoot(routes, { useHash: true })],
  exports: [RouterModule]
})
export class AppRoutingModule { }
