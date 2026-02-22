import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { TopicsListComponent } from './topics-list/topics-list';
import { TopicFormComponent } from './topic-form/topic-form';
import { ActivitySelectComponent } from './activity-select/activity-select';

const routes: Routes = [
  { path: '', component: TopicsListComponent },
  { path: 'new', component: TopicFormComponent },
  { path: ':id/edit', component: TopicFormComponent },
  { path: ':id/activities', component: ActivitySelectComponent },
  { path: ':id/play', loadChildren: () => import('../games/games.module').then(m => m.GamesModule) }
];

@NgModule({
  imports: [RouterModule.forChild(routes)],
  exports: [RouterModule]
})
export class TopicsRoutingModule { }
