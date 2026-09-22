import { Injectable } from '@angular/core';
import { Router } from '@angular/router';
import { Subject } from 'rxjs';

export interface TopicSelectionResult {
  topicId: number;
  // Tags which round trip this completion belongs to, since topicSelected$ is a single
  // app-wide bus and some of its consumers (e.g. the leaderboard's own picker) are mounted
  // globally and never destroyed - without this every listener would react to every pick.
  source: string;
}

@Injectable({ providedIn: 'root' })
export class LeaderboardStateService {
  private returnUrl: string | null = null;
  private activeSource: string | null = null;
  readonly topicSelected$ = new Subject<TopicSelectionResult>();

  constructor(private router: Router) {}

  get isSelecting(): boolean {
    return this.returnUrl !== null;
  }

  // Lets a picker page (e.g. topics-list) tailor its banner copy to why a selection is
  // in progress, without needing its own source-tracking state.
  get activeSelectionSource(): string | null {
    return this.activeSource;
  }

  beginTopicSelection(returnUrl: string, source: string): void {
    this.returnUrl = returnUrl;
    this.activeSource = source;
  }

  async completeTopicSelection(topicId: number): Promise<void> {
    const returnUrl = this.returnUrl ?? '/';
    const source = this.activeSource ?? '';
    this.returnUrl = null;
    this.activeSource = null;

    // topicSelected$ alone isn't reliable here: for a consumer whose own component gets
    // destroyed and recreated by this very navigation (e.g. activity-select), the new
    // instance's subscription may not exist yet by the time navigateByUrl's promise
    // resolves and next() fires (router.navigateByUrl resolves once the route is
    // activated, not once the new component's own lifecycle hooks finish running). So the
    // pick also rides along as query params on the return URL - read synchronously via
    // ActivatedRoute.snapshot on the other end, the same reliable path already used to
    // resume other in-progress settings. Consumers that stay mounted across the round trip
    // (e.g. the leaderboard's own persistent picker) can still just use topicSelected$.
    const urlTree = this.router.parseUrl(returnUrl);
    urlTree.queryParams = { ...urlTree.queryParams, pickedTopicId: String(topicId), pickedTopicSource: source };
    await this.router.navigateByUrl(urlTree);
    this.topicSelected$.next({ topicId, source });
  }

  cancelTopicSelection(): void {
    const url = this.returnUrl;
    this.returnUrl = null;
    this.activeSource = null;
    if (url) this.router.navigateByUrl(url);
  }
}
