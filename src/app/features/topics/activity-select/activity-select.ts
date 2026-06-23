import { AfterViewInit, ChangeDetectorRef, Component, ElementRef, OnDestroy, OnInit } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { Subscription } from 'rxjs';
import { GAMES, GameConfig } from '../games.config';
import { db } from '../../../core/db.model'; // Direct Dexie import
import { ResizeService } from '../../../core/resize';
import {
  ActivityAccessMode,
  filterGamesByActivityRestriction,
  normalizeAllowedActivityIds
} from './activity-restriction';

type BookActivityReturnContext = {
  bookId: string;
  pageId: string;
  pageSource: 'main' | 'workbook';
  workbookId: string;
  activityMode: ActivityAccessMode;
  allowedActivityIds: string[];
};

@Component({
  selector: 'app-activity-select',
  standalone: false,
  templateUrl: './activity-select.html',
  styleUrls: ['./activity-select.css']
})
export class ActivitySelectComponent implements OnInit, AfterViewInit, OnDestroy {
  games = GAMES;
  topicId!: number;
  topicName: string = '';
  selectedGame: GameConfig | null = null;
  showSettings = false;
  settings: any = {};
  private bookReturnContext: BookActivityReturnContext | null = null;
  private layoutSubscription?: Subscription;

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private resizeService: ResizeService,
    private cdr: ChangeDetectorRef,
    private elementRef: ElementRef<HTMLElement>
  ) {}

  async ngOnInit() {
    this.topicId = Number(this.route.snapshot.paramMap.get('id'));
    this.bookReturnContext = this.loadBookReturnContext();
    this.games = filterGamesByActivityRestriction(
      this.bookReturnContext?.activityMode || 'all',
      this.bookReturnContext?.allowedActivityIds || []
    );
    const topic = await db.topics.get(this.topicId);
    this.topicName = topic?.name || 'Topic';
  }

  ngAfterViewInit() {
    this.layoutSubscription = this.resizeService.layoutChanged$.subscribe(() => this.recalculateLayout());
    this.resizeService.requestLayoutRefresh();
  }

  ngOnDestroy() {
    this.layoutSubscription?.unsubscribe();
  }

  private recalculateLayout() {
    const root = this.elementRef.nativeElement.querySelector('.activity-page') as HTMLElement | null;
    if (root) {
      root.getBoundingClientRect();
    }
    this.cdr.detectChanges();
  }

  onGameClick(game: GameConfig) {
    if (!this.games.some((allowedGame) => allowedGame.id === game.id)) return;
    if (this.selectedGame === game) {
      this.startGame();
    } else {
      this.selectedGame = game;
      if (game.requiresSettings) {
        this.showSettings = true;
      } else {
        this.showSettings = false;
      }
    }
  }

  onSettingsChange(settings: any) {
    this.settings = settings;
  }

  startGame() {
    if (!this.selectedGame || !this.games.some((game) => game.id === this.selectedGame?.id)) return;
    this.router.navigate(['/topics', this.topicId, 'play', this.selectedGame.id], {
      queryParams: {
        ...this.settings,
        ...this.getBookReturnQueryParams()
      }
    });
  }

  cancelSelection() {
    this.selectedGame = null;
    this.showSettings = false;
    this.settings = {};
  }

  goBack() {
    if (this.bookReturnContext?.bookId) {
      const context = this.bookReturnContext;
      this.clearBookReturnContext();
      this.router.navigate(['/books', context.bookId, 'read'], {
        state: {
          pageId: context.pageId,
          pageSource: context.pageSource,
          workbookId: context.workbookId
        }
      });
      return;
    }
    this.router.navigate(['/topics']);
  }

  isPremiumLocked(game: GameConfig): boolean {
    return false;
  }

  private loadBookReturnContext(): BookActivityReturnContext | null {
    const query = this.route.snapshot.queryParamMap;
    const bookId = query.get('returnToBookId') || '';
    if (bookId) {
      const context: BookActivityReturnContext = {
        bookId,
        pageId: query.get('returnToBookPageId') || '',
        pageSource: query.get('returnToBookPageSource') === 'workbook' ? 'workbook' : 'main',
        workbookId: query.get('returnToWorkbookId') || '',
        activityMode: query.get('bookActivityMode') === 'selected' ? 'selected' : 'all',
        allowedActivityIds: normalizeAllowedActivityIds(query.get('bookAllowedActivityIds'))
      };
      this.saveBookReturnContext(context);
      return context;
    }

    return this.readStoredBookReturnContext();
  }

  private getBookReturnQueryParams(): Record<string, string> {
    const context = this.bookReturnContext;
    if (!context?.bookId) return {};
    const params: Record<string, string> = {
      returnToBookId: context.bookId,
      returnToBookPageId: context.pageId,
      returnToBookPageSource: context.pageSource,
      returnToWorkbookId: context.workbookId
    };
    if (context.activityMode === 'selected') {
      params['bookActivityMode'] = 'selected';
      params['bookAllowedActivityIds'] = context.allowedActivityIds.join(',');
    }
    return params;
  }

  private saveBookReturnContext(context: BookActivityReturnContext): void {
    try {
      sessionStorage.setItem(this.bookReturnStorageKey(), JSON.stringify({
        ...context,
        savedAt: Date.now()
      }));
    } catch {
      // Session storage is only a convenience for game routes that drop query params.
    }
  }

  private readStoredBookReturnContext(): BookActivityReturnContext | null {
    try {
      const raw = sessionStorage.getItem(this.bookReturnStorageKey());
      if (!raw) return null;
      const saved = JSON.parse(raw) as Partial<BookActivityReturnContext> & { savedAt?: number };
      if (!saved.bookId || !saved.savedAt || Date.now() - saved.savedAt > 12 * 60 * 60 * 1000) {
        sessionStorage.removeItem(this.bookReturnStorageKey());
        return null;
      }
      return {
        bookId: saved.bookId,
        pageId: saved.pageId || '',
        pageSource: saved.pageSource === 'workbook' ? 'workbook' : 'main',
        workbookId: saved.workbookId || '',
        activityMode: saved.activityMode === 'selected' ? 'selected' : 'all',
        allowedActivityIds: normalizeAllowedActivityIds(saved.allowedActivityIds)
      };
    } catch {
      return null;
    }
  }

  private clearBookReturnContext(): void {
    try {
      sessionStorage.removeItem(this.bookReturnStorageKey());
    } catch {
      // Nothing to clean up when storage is unavailable.
    }
  }

  private bookReturnStorageKey(): string {
    return `noprep-book-activity-return:${this.topicId}`;
  }

}
