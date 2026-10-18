import { Component, Input } from '@angular/core';
import { ExerciseKind } from '../../../../core/ai-topic/task-prep';
import { BookCreatorTaskPrepController } from '../book-creator-task-prep-controller';

const KIND_ICONS: Record<ExerciseKind | 'video', string> = {
  gapFill: '✏️', wordBank: '🔤', circle: '⭕', choice: '🔘', match: '🔗', crossword: '🔠', open: '📝', other: '📄', video: '🎬'
};

// "✨ Prepare tasks" in the book creator's right panel (docs/ai-task-prep.md). The state lives in
// BookCreatorTaskPrepController; this is only its view. It shares the lesson planner's styles.
@Component({
  selector: 'app-task-prep-panel',
  standalone: false,
  templateUrl: './task-prep-panel.html',
  styleUrls: ['../lesson-plan-panel/lesson-plan-panel.css', './task-prep-panel.css']
})
export class TaskPrepPanelComponent {
  @Input({ required: true }) creator!: any;

  get prep(): BookCreatorTaskPrepController {
    return this.creator.taskPrep;
  }

  kindIcon(kind: string): string {
    return KIND_ICONS[kind as ExerciseKind] ?? KIND_ICONS.other;
  }
}
