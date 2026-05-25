import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule } from '@angular/forms';
import { DragDropModule } from '@angular/cdk/drag-drop';
import { TopicsRoutingModule } from './topics-routing.module';
import { TopicsListComponent } from './topics-list/topics-list';
import { TopicFormComponent } from './topic-form/topic-form';
import { SharedModule } from '../../shared/shared.module';
import { ActivitySelectComponent } from './activity-select/activity-select';
import { TranslatePipe } from "../../shared/translate-pipe";

@NgModule({
  declarations: [TopicsListComponent, TopicFormComponent, ActivitySelectComponent],
  imports: [
    CommonModule,
    ReactiveFormsModule,
    DragDropModule,
    SharedModule,
    TopicsRoutingModule,
    TranslatePipe
]
})
export class TopicsModule { }