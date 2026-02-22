import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule } from '@angular/forms';
import { TopicsRoutingModule } from './topics-routing.module';
import { TopicsListComponent } from './topics-list/topics-list';
import { TopicFormComponent } from './topic-form/topic-form';
import { SharedModule } from '../../shared/shared.module';
import { ActivitySelectComponent } from './activity-select/activity-select';

@NgModule({
  declarations: [TopicsListComponent, TopicFormComponent, ActivitySelectComponent],
  imports: [
    CommonModule,
    ReactiveFormsModule,
    SharedModule,
    TopicsRoutingModule
  ]
})
export class TopicsModule { }