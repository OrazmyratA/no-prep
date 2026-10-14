import { Component, Input } from '@angular/core';
import { findRecipe } from '../../../../core/ai-topic/ai-topic-recipes';
import { LessonPlan, LessonSection, LessonTopic } from '../../../../core/ai-topic/lesson-plan';
import { GameConfig } from '../../../topics/games.config';
import { BookCreatorLessonPlanController } from '../book-creator-lesson-plan-controller';

// "✨ AI lesson plan" in the book creator's right panel (docs/ai-lesson-planner.md §3).
// The state lives in BookCreatorLessonPlanController; this is only its view.
@Component({
  selector: 'app-lesson-plan-panel',
  standalone: false,
  templateUrl: './lesson-plan-panel.html',
  styleUrls: ['./lesson-plan-panel.css']
})
export class LessonPlanPanelComponent {
  @Input({ required: true }) creator!: any;

  /** The section whose icon shows every game it could offer, not just the chosen ones. */
  moreOpen: string | null = null;

  get planner(): BookCreatorLessonPlanController {
    return this.creator.lessonPlanner;
  }

  get plan(): LessonPlan | null {
    return this.planner.plan;
  }

  game(id: string | null): GameConfig | undefined {
    return (this.creator.games as GameConfig[]).find(game => game.id === id);
  }

  /** The icon's chosen games, or every game its topic can play while "more" is open. */
  shownChoices(section: LessonSection): string[] {
    return this.moreOpen === section.id ? this.planner.sectionChoices(section.id) : section.games;
  }

  toggleMore(sectionId: string): void {
    this.moreOpen = this.moreOpen === sectionId ? null : sectionId;
  }

  recipeLabel(topic: LessonTopic): string {
    return findRecipe(topic.recipe)?.labelKey ?? '';
  }

  joinLines(lines: string[]): string {
    return lines.join('\n');
  }

  setVocabulary(text: string): void {
    if (this.plan) this.plan.vocabulary = text.split(/[,;\n]/).map(word => word.trim()).filter(Boolean);
  }
}
