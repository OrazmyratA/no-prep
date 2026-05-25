import { AfterViewInit, ChangeDetectorRef, Component, ElementRef, OnDestroy, OnInit } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { Subscription } from 'rxjs';
import { GAMES, GameConfig } from '../games.config';
import { db } from '../../../core/db.model'; // Direct Dexie import
import { ResizeService } from '../../../core/resize';

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
    if (!this.selectedGame) return;
    this.router.navigate(['/topics', this.topicId, 'play', this.selectedGame.id], {
      queryParams: this.settings
    });
  }

  cancelSelection() {
    this.selectedGame = null;
    this.showSettings = false;
    this.settings = {};
  }

  goBack() {
    this.router.navigate(['/topics']);
  }

  isPremiumLocked(game: GameConfig): boolean {
    return false;
  }
}
