import { Component, OnInit, OnDestroy, ChangeDetectorRef } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { db, Item } from '../../core/db.model';

@Component({
  selector: 'app-reveal-game',
  standalone: false,
  templateUrl: './reveal-game.html',
  styleUrl: `./reveal-game.css`
})
export class RevealGameComponent implements OnInit, OnDestroy {
  topicId!: number;
  items: Item[] = [];
  currentIndex = 0;
  currentItem: Item | null = null;
  gameActive = false;
  gameFinished = false;
  loading = true;
  private timer: any;
  public totalTime = 25; // seconds
  timeLeft = this.totalTime;
  gridSize = 14; 
  gridRevealed: boolean[][] = [];
  private revealInterval: any;
  private readonly revealSpeed = 100; // ms per square (matches totalTime)
  private collectSound: HTMLAudioElement | null = null;
  isPaused = false;
  private totalCells = 0;
  private revealedCount = 0;
  private intervalTime = 0;
  private imageUrls: Map<number, string> = new Map();
  private objectUrls: string[] = [];

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private cdr: ChangeDetectorRef
  ) {}

async ngOnInit() {
  const idParam =
    this.route.snapshot.paramMap.get('id') ??
    this.route.parent?.snapshot.paramMap.get('id');
  this.topicId = Number(idParam);

  // Read settings from query params
  this.route.queryParams.subscribe(params => {
    if (params['timer']) {
      this.totalTime = Number(params['timer']);
    }
    if (params['gridSize']) {
      this.gridSize = Number(params['gridSize']);
    }
  });

  this.items = await db.items.where('topicId').equals(this.topicId).sortBy('order');
  this.items = this.items.filter(item => !!item.image);
  this.loading = false;
  if (this.items.length === 0) {
    alert('No items with images found in this topic!');
    this.router.navigate(['/topics', this.topicId, 'activities']);
    return;
  }
  // Preload sound
  this.collectSound = new Audio('/assets/sound/collect.mp3');
  this.collectSound.load();
  this.startNextItem();
}

  ngOnDestroy() {
    this.objectUrls.forEach(url => URL.revokeObjectURL(url));
    this.clearTimers();
    if (this.collectSound) {
      this.collectSound.pause();
      this.collectSound = null;
    }
  }

private clearTimers() {
  if (this.revealInterval) {
    clearInterval(this.revealInterval);
    this.revealInterval = null;
  }
  if (this.timer) {
    clearTimeout(this.timer);
    this.timer = null;
  }
}

  startNextItem() {
    if (this.currentIndex >= this.items.length) {
      this.gameFinished = true;
      this.gameActive = false;
      this.isPaused = false;
      this.cdr.detectChanges();
      return;
    }

    this.currentItem = this.items[this.currentIndex];
    this.resetGrid();
    this.timeLeft = this.totalTime;
    this.gameFinished = false; 
    this.gameActive = true;
    this.isPaused = false;
    this.totalCells = this.gridSize * this.gridSize;
    this.revealedCount = 0;
    this.intervalTime = (this.totalTime * 1000) / this.totalCells;
    this.cdr.detectChanges();

    this.startRevealLoop();
  }

  private resetGrid() {
    this.gridRevealed = [];
    for (let i = 0; i < this.gridSize; i++) {
      this.gridRevealed[i] = new Array(this.gridSize).fill(false);
    }
  }

  private revealRandomCell() {
    const unrevealed: { row: number; col: number }[] = [];
    for (let r = 0; r < this.gridSize; r++) {
      for (let c = 0; c < this.gridSize; c++) {
        if (!this.gridRevealed[r][c]) unrevealed.push({ row: r, col: c });
      }
    }
    if (unrevealed.length === 0) return;
    const { row, col } = unrevealed[Math.floor(Math.random() * unrevealed.length)];
    this.gridRevealed[row][col] = true;
  }

  skipToNext() {
    this.collectSound?.play();
    this.clearTimers();
    this.isPaused = false;
    // Reveal all cells quickly (or just move to next)
    this.currentIndex++;
    
    this.startNextItem();
  }

imageUrl(blob: Blob, itemId: number): string {
  // Check if we already have a cached URL for this item ID
  if (!this.imageUrls.has(itemId)) {
    const url = URL.createObjectURL(blob);
    this.imageUrls.set(itemId, url);
    // Track it for cleanup, just like you do for objectUrls
    this.objectUrls.push(url);
  }
  return this.imageUrls.get(itemId)!;
}

onMenuAction(action: string) {
  if (action === 'activity') {
    this.router.navigate(['/topics', this.topicId, 'activities']);
  } else if (action === 'startover') {
    this.clearTimers();
    this.currentIndex = 0;
    this.gameFinished = false;
    this.isPaused = false;
    this.startNextItem();
  } else if (action === 'resume') {
    this.resumeGame();
  }
}

onMenuOpenChange(event: boolean | Event) {
  const isOpen =
    typeof event === 'boolean'
      ? event
      : Boolean((event as CustomEvent<boolean>).detail);

  if (isOpen) {
    this.pauseGame();
    return;
  }

  this.resumeGame();
}

private pauseGame() {
  if (!this.gameActive || this.gameFinished || this.isPaused) return;
  this.isPaused = true;
  this.clearTimers();
  this.cdr.detectChanges();
}

private resumeGame() {
  if (!this.gameActive || this.gameFinished || !this.isPaused) return;
  this.isPaused = false;
  this.startRevealLoop();
  this.cdr.detectChanges();
}

private startRevealLoop() {
  if (this.revealInterval || !this.gameActive || this.gameFinished || this.isPaused) return;
  if (this.revealedCount >= this.totalCells) {
    this.completeCurrentItem();
    return;
  }

  this.revealInterval = setInterval(() => {
    if (this.isPaused || !this.gameActive) return;

    if (this.revealedCount < this.totalCells) {
      this.revealRandomCell();
      this.revealedCount++;
      this.timeLeft = this.totalTime - (this.revealedCount / this.totalCells) * this.totalTime;
      this.cdr.detectChanges();
      return;
    }

    this.completeCurrentItem();
  }, this.intervalTime || this.revealSpeed);
}

private completeCurrentItem() {
  this.clearTimers();
  this.timer = setTimeout(() => {
    this.currentIndex++;
    this.startNextItem();
  }, 1500);
}
}
