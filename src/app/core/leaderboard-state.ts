import { Injectable } from '@angular/core';
import { Router } from '@angular/router';
import { Subject } from 'rxjs';

@Injectable({ providedIn: 'root' })
export class LeaderboardStateService {
  private returnUrl: string | null = null;
  readonly topicSelected$ = new Subject<number>();

  constructor(private router: Router) {}

  get isSelecting(): boolean {
    return this.returnUrl !== null;
  }

  beginTopicSelection(returnUrl: string): void {
    this.returnUrl = returnUrl;
  }

  async completeTopicSelection(topicId: number): Promise<void> {
    const url = this.returnUrl ?? '/';
    this.returnUrl = null;
    await this.router.navigateByUrl(url);
    this.topicSelected$.next(topicId);
  }

  cancelTopicSelection(): void {
    const url = this.returnUrl;
    this.returnUrl = null;
    if (url) this.router.navigateByUrl(url);
  }
}
