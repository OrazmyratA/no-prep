import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { TopicsListComponent } from './topics-list/topics-list';
import { TopicFormComponent } from './topic-form/topic-form';
import { ActivitySelectComponent } from './activity-select/activity-select';
import { topicExistsGuard } from './topic-exists.guard';

const routes: Routes = [
  { path: '', component: TopicsListComponent },
  { path: 'new', component: TopicFormComponent },
  { path: ':id/edit', component: TopicFormComponent, canActivate: [topicExistsGuard] },
  { path: ':id/activities', component: ActivitySelectComponent, canActivate: [topicExistsGuard] },
  { path: ':id/play', canActivate: [topicExistsGuard], loadChildren: () => import('../games/games.module').then(m => m.GamesModule) }
];

@NgModule({
  imports: [RouterModule.forChild(routes)],
  exports: [RouterModule]
})
export class TopicsRoutingModule { }
