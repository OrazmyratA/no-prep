import { Component, Input } from '@angular/core';

@Component({
  selector: 'app-book-creator-inspector',
  standalone: false,
  templateUrl: './book-creator-inspector.html',
  styleUrls: ['./book-creator-inspector.css']
})
export class BookCreatorInspectorComponent {
  @Input({ required: true }) creator!: any;

  /**
   * A game icon shows only its chosen topic and chosen activities; "Change" opens the full tools.
   * Keys include the element (and topic), so choosing another topic or icon closes them again.
   */
  private changingTopicKey: string | null = null;
  private editingActivitiesFor: string | null = null;

  private topicKey(element: any): string {
    return `${element.id}:${element.data?.['topicId'] ?? ''}`;
  }

  isChoosingTopic(element: any): boolean {
    return !element.data?.['topicId'] || this.changingTopicKey === this.topicKey(element);
  }

  toggleTopicChange(element: any): void {
    const key = this.topicKey(element);
    this.changingTopicKey = this.changingTopicKey === key ? null : key;
  }

  isEditingActivities(element: any): boolean {
    return this.editingActivitiesFor === element.id;
  }

  toggleActivitiesEdit(element: any): void {
    this.editingActivitiesFor = this.editingActivitiesFor === element.id ? null : element.id;
  }

  /** "Selected" opens the full list straight away, since the teacher is about to pick. */
  setActivityRestriction(element: any, restricted: boolean): void {
    const wasRestricted = this.creator.isGameActivityRestricted(element);
    this.creator.setGameActivityRestriction(element, restricted);
    if (restricted && !wasRestricted) this.editingActivitiesFor = element.id;
    if (!restricted) this.editingActivitiesFor = null;
  }

  allowedGames(element: any): any[] {
    return (this.creator.games || []).filter((game: { id: string }) => this.creator.isGameActivityAllowed(element, game.id));
  }
}
