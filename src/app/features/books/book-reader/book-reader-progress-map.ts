import { AfterViewInit, Component, DoCheck, ElementRef, Input, NgZone, OnDestroy, ViewChild } from '@angular/core';
import { BookPage, getLessonPageRefs, ProgressMapLesson, ProgressMapUnit } from '../../../core/book.model';
import { ConfettiInstance, GameFinishConfettiService } from '../../../shared/game-finish-overlay';

@Component({
  selector: 'app-book-reader-progress-map',
  standalone: false,
  templateUrl: './book-reader-progress-map.html',
  styleUrls: ['./book-reader-progress-map.css']
})
export class BookReaderProgressMapComponent implements AfterViewInit, DoCheck, OnDestroy {
  @Input({ required: true }) reader!: any;
  @Input({ required: true }) page!: BookPage;
  @ViewChild('mapScroll') private mapScrollRef?: ElementRef<HTMLElement>;

  get scrollElement(): HTMLElement | null {
    return this.mapScrollRef?.nativeElement ?? null;
  }

  // Both the beach's reveal and the collapsible header are driven by scroll
  // position; a full-page capture lays everything out unclipped regardless of
  // scroll, so force both into their fully-shown state for the duration of it.
  prepareForFullCapture(): void {
    this.headerCollapsed = false;
    this.beachRevealProgress = 1;
  }

  restoreAfterFullCapture(): void {
    const target = this.mapScrollRef?.nativeElement;
    this.headerCollapsed = !!target && target.scrollTop > this.headerCollapseThresholdPx;
    this.updateBeachReveal(target);
  }

  constructor(
    private ngZone: NgZone,
    private confettiService: GameFinishConfettiService
  ) {}

  openUnitId: string | null = null;
  headerCollapsed = false;
  shareCardOpen = false;
  shareCardGenerating = false;
  shareCardImageUrl: string | null = null;

  private readonly treeStageFiles = ['dead', 'bud', 'sprout', 'sapling', 'leafing', 'lush', 'blossom', 'green', 'ripening'];
  private readonly harvestTreeVariants = [
    'apple-tree',
    'cherry-tree',
    'fig-tree',
    'lemon-tree',
    'mango-tree',
    'orange-tree',
    'peach-tree',
    'pear-tree',
    'plump-tree',
    'pomegranate-tree'
  ];
  private readonly treeStageCount = 10;
  private readonly islandCount = 10;
  private readonly lessonIcons = ['water', 'air', 'sunlight', 'fertilizer'];

  private readonly unitStepRem = 12;
  private readonly topPaddingRem = 8;
  private readonly bottomPaddingRem = 14;
  private readonly lessonOrbitRadiusRem = 6.6;
  private readonly headerCollapseThresholdPx = 40;
  private readonly beachRevealSlidePx = 40;

  readonly beforeImage = "url('assets/images/book/tree/before.png')";
  readonly lifeImage = "url('assets/images/book/tree/life.png')";
  readonly waterBackgroundImage = "url('assets/images/book/islend/water.gif')";
  readonly boatImage = 'assets/images/book/islend/boat.png';
  readonly beachImage = 'assets/images/book/islend/beach.png';
  private readonly waterImageNaturalWidth = 529;
  private readonly waterImageNaturalHeight = 759;

  waterOffsetPx = 0;
  beachRevealProgress = 0;

  private wasBookComplete = false;
  private confettiInstance: ConfettiInstance | null = null;
  private confettiTimer: ReturnType<typeof setInterval> | null = null;
  private isDestroyed = false;
  private readonly confettiColors = ['#facc15', '#38bdf8', '#fb7185', '#34d399', '#a78bfa', '#f97316', '#ffffff'];

  ngAfterViewInit(): void {
    // Short books may not have enough content to scroll at all, in which case
    // no scroll event will ever fire — reveal the beach based on initial layout instead,
    // once the map's images have had a frame to lay out.
    requestAnimationFrame(() => requestAnimationFrame(() => this.updateBeachReveal(this.mapScrollRef?.nativeElement)));
  }

  ngDoCheck(): void {
    const complete = this.isBookComplete;
    if (complete && !this.wasBookComplete) {
      this.startCelebrationConfetti();
    } else if (!complete && this.wasBookComplete) {
      this.stopCelebrationConfetti();
    }
    this.wasBookComplete = complete;
  }

  ngOnDestroy(): void {
    this.isDestroyed = true;
    this.stopCelebrationConfetti();
  }

  private startCelebrationConfetti(): void {
    this.ngZone.runOutsideAngular(async () => {
      try {
        const confettiInstance = await this.confettiService.create();
        if (this.isDestroyed) {
          confettiInstance.reset();
          return;
        }
        this.confettiInstance = confettiInstance;
        this.fireCelebrationBurst();
        this.confettiTimer = setInterval(() => this.fireCelebrationBurst(), 3000);
      } catch (error) {
        console.warn('Book-completion confetti could not start.', error);
      }
    });
  }

  private fireCelebrationBurst(): void {
    if (!this.confettiInstance) return;
    this.confettiInstance({
      colors: this.confettiColors,
      disableForReducedMotion: false,
      zIndex: 2147483647,
      particleCount: 160,
      spread: 100,
      startVelocity: 42,
      ticks: 240,
      gravity: 0.9,
      scalar: 1,
      origin: { x: 0.5, y: 0.85 }
    });
  }

  private stopCelebrationConfetti(): void {
    if (this.confettiTimer) {
      clearInterval(this.confettiTimer);
      this.confettiTimer = null;
    }
    this.confettiInstance?.reset();
    this.confettiInstance = null;
  }

  get isBoatMirrored(): boolean {
    const index = this.currentUnitIndex;
    return index >= 0 && this.seededRandom(index * 31 + 77) < 0.5;
  }

  get boatTransform(): string {
    const offsetX = this.ownerLeftPercent > 50 ? '-8.3rem' : '8.3rem';
    const mirror = this.isBoatMirrored ? ' scaleX(-1)' : '';
    return `translate(${offsetX}, 4.5rem)${mirror}`;
  }

  onMapScroll(event: Event): void {
    const target = event.target as HTMLElement;
    const collapsed = target.scrollTop > this.headerCollapseThresholdPx;
    if (collapsed !== this.headerCollapsed) {
      this.headerCollapsed = collapsed;
    }
    const renderedHeight = target.clientWidth * (this.waterImageNaturalHeight / this.waterImageNaturalWidth);
    const cap = Math.max(0, renderedHeight - target.clientHeight);
    this.waterOffsetPx = -Math.min(target.scrollTop, cap);
    this.updateBeachReveal(target);
  }

  onBeachImageLoad(): void {
    // The map is recreated every time this page is reopened (it's behind an *ngIf),
    // so the beach image reloads from scratch each time; until it finishes loading,
    // scrollHeight understates the map's true height and the reveal math is stale.
    this.updateBeachReveal(this.mapScrollRef?.nativeElement);
  }

  private updateBeachReveal(target: HTMLElement | null | undefined): void {
    if (!target) return;
    const distanceFromBottom = target.scrollHeight - target.scrollTop - target.clientHeight;
    // Fades and slides in continuously as the bottom of the scroll approaches,
    // rather than snapping into view once a fixed threshold is crossed.
    const revealThreshold = Math.max(160, target.clientHeight * 0.6);
    this.beachRevealProgress = this.clamp(1 - distanceFromBottom / revealThreshold, 0, 1);
  }

  get beachRevealTransform(): string {
    const offset = (1 - this.beachRevealProgress) * this.beachRevealSlidePx;
    return `translateY(${offset}px)`;
  }

  get units(): ProgressMapUnit[] {
    return this.page.progressUnits ?? [];
  }

  get totalLessonsCount(): number {
    return this.units.reduce((sum, unit) => sum + unit.lessons.length, 0);
  }

  get completedLessonsCount(): number {
    return this.units.reduce(
      (sum, unit) => sum + unit.lessons.filter((lesson) => this.isLessonComplete(lesson)).length,
      0
    );
  }

  get bookCompletionPercent(): number {
    return this.reader.getBookCompletionPercent();
  }

  get isBookComplete(): boolean {
    return this.units.length > 0 && this.bookCompletionPercent >= 100;
  }

  get badgeLeftPercent(): number {
    return this.clamp(this.bookCompletionPercent, 7, 93);
  }

  private getCountablePages(): BookPage[] {
    const book = this.reader.book;
    if (!book) return [];
    const mainPages = ((book.pages ?? []) as BookPage[]).filter((p) => p.type !== 'progressMap' && !p.hidden);
    const workbookPages = ((book.workbooks ?? []) as { pages: BookPage[] }[]).flatMap((wb) =>
      (wb.pages ?? []).filter((p) => !p.hidden)
    );
    return [...mainPages, ...workbookPages];
  }

  get totalPagesCount(): number {
    return this.getCountablePages().length;
  }

  get visitedPagesCount(): number {
    const progress = this.reader.pageProgress as Map<string, { reached?: boolean }> | undefined;
    if (!progress) return 0;
    return this.getCountablePages().filter((p) => progress.get(p.id)?.reached).length;
  }

  get shareText(): string {
    const title = this.reader.book?.title ?? 'this book';
    return this.isBookComplete
      ? `I just finished "${title}" on No-Prep! \u{1F389}`
      : `I'm ${this.bookCompletionPercent}% through "${title}" on No-Prep! \u{1F4DA}`;
  }

  async openShareCard(event: Event): Promise<void> {
    event.stopPropagation();
    this.shareCardOpen = true;
    this.shareCardGenerating = true;
    this.shareCardImageUrl = null;
    try {
      this.shareCardImageUrl = await this.generateShareCardImage();
    } catch {
      this.shareCardImageUrl = null;
    } finally {
      this.shareCardGenerating = false;
    }
  }

  closeShareCard(): void {
    this.shareCardOpen = false;
  }

  get canUseNativeShare(): boolean {
    return typeof navigator !== 'undefined' && typeof (navigator as any).share === 'function';
  }

  private shareFileName(): string {
    const safeName = (this.reader.book?.title ?? 'noprep-progress').replace(/[^a-z0-9]+/gi, '-').toLowerCase();
    return `${safeName || 'noprep-progress'}.png`;
  }

  downloadShareCard(event: Event): void {
    event.stopPropagation();
    if (!this.shareCardImageUrl) return;
    const link = document.createElement('a');
    link.href = this.shareCardImageUrl;
    link.download = this.shareFileName();
    link.click();
  }

  async shareImage(event: Event): Promise<void> {
    event.stopPropagation();
    if (!this.shareCardImageUrl) return;
    try {
      const response = await fetch(this.shareCardImageUrl);
      const blob = await response.blob();
      const file = new File([blob], this.shareFileName(), { type: blob.type });
      const nav = navigator as any;
      if (typeof nav.canShare === 'function' && !nav.canShare({ files: [file] })) {
        this.downloadShareCard(event);
        return;
      }
      await nav.share({ files: [file], title: this.reader.book?.title ?? 'No-Prep', text: this.shareText });
    } catch (err: any) {
      if (err?.name !== 'AbortError') {
        this.downloadShareCard(event);
      }
    }
  }

  private loadImage(src: string): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error(`Unable to load ${src}`));
      img.src = src;
    });
  }

  private wrapCanvasText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
    const words = text.split(' ');
    const lines: string[] = [];
    let current = '';
    for (const word of words) {
      const attempt = current ? `${current} ${word}` : word;
      if (current && ctx.measureText(attempt).width > maxWidth) {
        lines.push(current);
        current = word;
      } else {
        current = attempt;
      }
    }
    if (current) lines.push(current);
    return lines;
  }

  private drawShareCardSparkles(ctx: CanvasRenderingContext2D, width: number, centerY: number): void {
    const sparkles = [
      { x: width * 0.12, y: centerY - 380, size: 44, alpha: 0.85 },
      { x: width * 0.88, y: centerY - 420, size: 32, alpha: 0.65 },
      { x: width * 0.16, y: centerY + 430, size: 30, alpha: 0.55 },
      { x: width * 0.85, y: centerY + 400, size: 40, alpha: 0.7 },
      { x: width * 0.5, y: centerY - 470, size: 24, alpha: 0.5 }
    ];
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#fde047';
    for (const s of sparkles) {
      ctx.globalAlpha = s.alpha;
      ctx.font = `${s.size}px "Segoe UI Symbol", Arial, sans-serif`;
      ctx.fillText('✦', s.x, s.y);
    }
    ctx.restore();
  }

  private async generateShareCardImage(): Promise<string> {
    const width = 1080;
    const height = 1820;
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas not supported');

    const sky = ctx.createLinearGradient(0, 0, 0, height);
    sky.addColorStop(0, '#bfe6ff');
    sky.addColorStop(0.45, '#eafcef');
    sky.addColorStop(1, '#d3f3dd');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, width, height);

    const logoCenterY = 640;
    const glow = ctx.createRadialGradient(width / 2, logoCenterY, 40, width / 2, logoCenterY, 620);
    glow.addColorStop(0, 'rgba(253, 224, 71, 0.45)');
    glow.addColorStop(1, 'rgba(253, 224, 71, 0)');
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, width, height);

    this.drawShareCardSparkles(ctx, width, logoCenterY);

    const logoSize = 900;
    try {
      const logo = await this.loadImage('assets/images/noprep-logo.png');
      ctx.drawImage(logo, (width - logoSize) / 2, logoCenterY - logoSize / 2, logoSize, logoSize);
    } catch {
      // fall back to no logo if it can't be loaded
    }

    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';

    let y = logoCenterY + logoSize / 2 + 100;
    const title = this.reader.book?.title ?? 'this book';
    ctx.fillStyle = '#1f2937';
    ctx.font = '700 58px "Segoe UI", Arial, sans-serif';
    const titleLines = this.wrapCanvasText(ctx, title, width - 160).slice(0, 2);
    for (const line of titleLines) {
      ctx.fillText(line, width / 2, y);
      y += 68;
    }

    y += 50;
    if (this.isBookComplete) {
      ctx.fillStyle = '#16a34a';
      ctx.font = '800 76px "Segoe UI", Arial, sans-serif';
      ctx.fillText('\u{1F389} Congratulations!', width / 2, y);
      y += 82;
      ctx.fillStyle = '#374151';
      ctx.font = '600 40px "Segoe UI", Arial, sans-serif';
      ctx.fillText("You finished the whole book — amazing work!", width / 2, y);
    } else {
      ctx.fillStyle = '#16a34a';
      ctx.font = '800 90px "Segoe UI", Arial, sans-serif';
      ctx.fillText(`${this.bookCompletionPercent}% Complete`, width / 2, y + 8);
      y += 96;
      ctx.fillStyle = '#374151';
      ctx.font = '600 40px "Segoe UI", Arial, sans-serif';
      ctx.fillText("Keep up the great work — you're doing amazing!", width / 2, y + 24);
    }

    return canvas.toDataURL('image/png');
  }

  get mapContentHeightRem(): number {
    if (!this.units.length) return 0;
    return (this.units.length - 1) * this.unitStepRem + this.topPaddingRem + this.bottomPaddingRem;
  }

  getUnitLeftPercent(index: number): number {
    const wave = Math.sin(index * 0.85) * 26;
    const jitter = (this.seededRandom(index) - 0.5) * 10;
    return this.clamp(50 + wave + jitter, 16, 84);
  }

  getUnitTopRem(index: number): number {
    return index * this.unitStepRem + this.topPaddingRem;
  }

  get currentUnitIndex(): number {
    if (!this.units.length) return -1;
    const index = this.units.findIndex((unit) => this.getUnitProgress(unit) < 1);
    return index >= 0 ? index : this.units.length - 1;
  }

  get ownerLeftPercent(): number {
    const index = this.currentUnitIndex;
    return index >= 0 ? this.getUnitLeftPercent(index) : 50;
  }

  get ownerTopRem(): number {
    const index = this.currentUnitIndex;
    return index >= 0 ? this.getUnitTopRem(index) : 0;
  }

  private seededRandom(seed: number): number {
    const value = Math.sin(seed * 12.9898) * 43758.5453;
    return value - Math.floor(value);
  }

  private clamp(value: number, min: number, max: number): number {
    return Math.min(max, Math.max(min, value));
  }

  trackByUnitId(_index: number, unit: ProgressMapUnit): string {
    return unit.id;
  }

  trackByLessonId(_index: number, lesson: ProgressMapLesson): string {
    return lesson.id;
  }

  isUnitLocked(unit: ProgressMapUnit): boolean {
    const index = this.units.findIndex((item) => item.id === unit.id);
    return !this.reader.isUnitUnlocked(this.units, index);
  }

  isUnitComplete(unit: ProgressMapUnit): boolean {
    return this.getUnitProgress(unit) >= 1;
  }

  getUnitProgress(unit: ProgressMapUnit): number {
    return this.reader.getUnitCompletionRatio(unit);
  }

  getTreeImage(unit: ProgressMapUnit): string {
    const stageIndex = this.isUnitLocked(unit)
      ? 0
      : Math.round(this.getUnitProgress(unit) * (this.treeStageCount - 1));
    if (stageIndex < this.treeStageFiles.length) {
      return `assets/images/book/tree/${this.treeStageFiles[stageIndex]}.png`;
    }
    return `assets/images/book/tree/${this.getHarvestVariant(unit)}.png`;
  }

  private getHarvestVariant(unit: ProgressMapUnit): string {
    const index = this.units.findIndex((item) => item.id === unit.id);
    return this.harvestTreeVariants[this.pickStableIndex(index, 5, this.harvestTreeVariants.length)];
  }

  getIslandImage(unit: ProgressMapUnit): string {
    const index = this.units.findIndex((item) => item.id === unit.id);
    const islandNumber = this.pickStableIndex(index, 11, this.islandCount) + 1;
    return `assets/images/book/islend/${islandNumber}.png`;
  }

  private pickStableIndex(index: number, salt: number, count: number): number {
    return Math.floor(this.seededRandom(index * 31 + salt) * count) % count;
  }

  getLessonIcon(index: number): string {
    return `assets/images/book/tree/${this.lessonIcons[index % this.lessonIcons.length]}.png`;
  }

  isLessonLocked(unit: ProgressMapUnit, lesson: ProgressMapLesson): boolean {
    const lessonIndex = unit.lessons.findIndex((item) => item.id === lesson.id);
    return !this.reader.isLessonUnlocked(unit, lessonIndex);
  }

  isLessonComplete(lesson: ProgressMapLesson): boolean {
    return this.reader.isLessonComplete(lesson);
  }

  private getLessonAngleDeg(unit: ProgressMapUnit, index: number): number {
    const count = unit.lessons.length;
    if (count <= 1) return -90;
    const spread = Math.min(220, 70 + count * 24);
    const start = -90 - spread / 2;
    return start + (spread * index) / (count - 1);
  }

  getLessonOffsetX(unit: ProgressMapUnit, index: number): number {
    const angle = (this.getLessonAngleDeg(unit, index) * Math.PI) / 180;
    return Math.cos(angle) * this.lessonOrbitRadiusRem;
  }

  getLessonOffsetY(unit: ProgressMapUnit, index: number): number {
    const angle = (this.getLessonAngleDeg(unit, index) * Math.PI) / 180;
    return Math.sin(angle) * this.lessonOrbitRadiusRem;
  }

  get openUnit(): ProgressMapUnit | null {
    return this.units.find((unit) => unit.id === this.openUnitId) ?? null;
  }

  toggleUnit(unit: ProgressMapUnit, event: Event): void {
    event.stopPropagation();
    if (this.openUnitId === unit.id) {
      this.openUnitId = null;
      this.reader.forceUiRefresh();
      return;
    }
    if (this.isUnitLocked(unit)) return;
    this.openUnitId = unit.id;
    if (unit.lessons?.length) {
      this.playRevealSound();
    }
    this.reader.forceUiRefresh();
  }

  closeUnit(): void {
    if (this.openUnitId === null) return;
    this.openUnitId = null;
    this.reader.forceUiRefresh();
  }

  hasLessonTarget(lesson: ProgressMapLesson): boolean {
    return getLessonPageRefs(lesson).length > 0;
  }

  openLesson(unit: ProgressMapUnit, lesson: ProgressMapLesson, event: Event): void {
    event.stopPropagation();
    if (!this.hasLessonTarget(lesson) || this.isLessonLocked(unit, lesson)) return;
    this.reader.navigateToProgressLesson(unit, lesson);
  }

  private playRevealSound(): void {
    const audio = new Audio('assets/sound/bubble-lesson.mp3');
    audio.volume = 0.85;
    void audio.play().catch(() => undefined);
  }
}
