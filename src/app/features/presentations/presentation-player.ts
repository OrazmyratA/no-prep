import {
  AfterViewInit, ChangeDetectionStrategy, ChangeDetectorRef, Component, ElementRef, HostListener, NgZone, OnDestroy, ViewChild
} from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { Subscription } from 'rxjs';
import { BookReturn, bookReturnFromQuery, goBackToBook } from '../../core/book-return';
import { LanguageService } from '../../core/language';
import { LeaderboardStateService } from '../../core/leaderboard-state';
import { showAppNotification } from '../../core/notification';
import { PointerTool, PresentationItem, PresentationService, StageRect } from '../../core/presentations';
import { isTypingTarget } from '../games/game-utils';
import { TranslatePipe } from '../../shared/translate-pipe';

type PlayerState = 'opening' | 'playing' | 'ended' | 'failed' | 'no-powerpoint';

/** Where each presentation was left, so coming back (e.g. after picking a class list) resumes there. */
const lastSlides = new Map<string, number>();

/**
 * Plays a presentation inside No-Prep. PowerPoint itself plays it (every animation, sound and video)
 * in a window kept exactly over the stage; No-Prep's own tools stay in the toolbar above it (the
 * floating leaderboard button is kept in the toolbar's free strip, since nothing of No-Prep's can
 * be drawn over PowerPoint's window). While the class leaderboard is open the slideshow steps
 * aside and a still picture of the slide stands in for it.
 */
@Component({
  selector: 'app-presentation-player',
  standalone: true,
  imports: [TranslatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './presentation-player.html',
  styleUrls: ['./presentation-player.css']
})
export class PresentationPlayerComponent implements AfterViewInit, OnDestroy {
  @ViewChild('stage') stageRef?: ElementRef<HTMLElement>;
  /** The toolbar's free strip: the floating leaderboard button lives here while a show plays. */
  @ViewChild('dock') dockRef?: ElementRef<HTMLElement>;

  item: PresentationItem | null = null;
  state: PlayerState = 'opening';
  /** Why PowerPoint could not open it (POWERPOINT_BUSY, PRESENTATION_EDITING, …). */
  failReason: string | null = null;
  slide = 0;
  slides = 0;
  /** A still picture of the slide while the slideshow steps aside. */
  still: string | null = null;
  covered = false;
  /** "Jump to a slide": small pictures of every slide (null while they are being made). */
  jumpOpen = false;
  pictures: (string | null)[] | null = null;
  private loadingPictures = false;
  /** The drawing tool on the slide: the normal pointer, pen, laser or eraser. */
  tool: PointerTool = 'arrow';
  readonly tools: { tool: PointerTool; icon: string; label: string }[] = [
    { tool: 'pen', icon: '🖊️', label: 'presentationToolPen' },
    { tool: 'laser', icon: '🔴', label: 'presentationToolLaser' },
    { tool: 'eraser', icon: '🧽', label: 'presentationToolEraser' }
  ];
  /** Opened from a book's PPT icon: Back returns to that page of the book. */
  bookReturn: BookReturn | null = null;

  private id = '';
  private poll: ReturnType<typeof setInterval> | null = null;
  private resizeObserver?: ResizeObserver;
  private subscription?: Subscription;
  private destroyed = false;
  private coverToken = 0;
  /** "Not running" answers in a row; one alone can come mid slide change. */
  private endedAnswers = 0;
  /** Why the slideshow is stepping aside right now (the class leaderboard, the slide list). */
  private readonly coverReasons = new Set<string>();
  private dockObserver?: ResizeObserver;

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private presentations: PresentationService,
    private leaderboard: LeaderboardStateService,
    private cdr: ChangeDetectorRef,
    private zone: NgZone,
    private lang: LanguageService
  ) {}

  async ngAfterViewInit(): Promise<void> {
    document.body.classList.add('np-presenting');
    this.dockLeaderboardButton();
    this.id = this.route.snapshot.paramMap.get('id') ?? '';
    const query = this.route.snapshot.queryParamMap;
    this.bookReturn = bookReturnFromQuery(query);
    // A book's PPT icon may start on a chosen slide; otherwise carry on where the teacher left off.
    const startSlide = Number(query.get('slide')) || 0;
    if (startSlide) {
      // Only the first time: coming back here (e.g. after choosing a class list) carries on
      // from where the teacher was, not from the book's start slide again.
      void this.router.navigate([], { relativeTo: this.route, queryParams: { slide: null }, queryParamsHandling: 'merge', replaceUrl: true });
    }
    if (!this.presentations.isDesktop || !(await this.presentations.isPowerPointAvailable())) {
      this.setState('no-powerpoint');
      return;
    }
    await this.presentations.refresh();
    this.item = this.presentations.items$.value.find((entry) => entry.id === this.id) ?? null;
    this.cdr.markForCheck();
    await this.start(startSlide > 0 ? startSlide : (lastSlides.get(this.id) ?? 1));
  }

  private async start(fromSlide: number): Promise<void> {
    const rect = this.stageRect();
    if (!rect || this.destroyed) return;
    this.setState('opening');
    const response = await this.presentations.play(this.id, rect, fromSlide);
    if (this.destroyed) {
      void this.presentations.stop();
      return;
    }
    if (!response.ok) {
      this.failReason = response.error;
      this.setState('failed');
      return;
    }
    this.failReason = null;
    this.slides = response.result.slides;
    this.tool = 'arrow';
    // Right after going to the start slide PowerPoint may not report the position yet.
    this.slide = response.result.slide || fromSlide;
    this.setState('playing');
    this.watch();
  }

  private watch(): void {
    if (!this.resizeObserver && this.stageRef) {
      this.resizeObserver = new ResizeObserver(() => this.placeStage());
      this.resizeObserver.observe(this.stageRef.nativeElement);
    }
    this.subscription ??= this.leaderboard.overlayOpen$.subscribe((open) => {
      // The leaderboard takes over from the slide list.
      if (open && this.jumpOpen) {
        this.jumpOpen = false;
        this.coverReasons.delete('jump');
        this.cdr.markForCheck();
      }
      void this.cover('class', open);
    });
    this.zone.runOutsideAngular(() => {
      this.stopPolling();
      this.poll = setInterval(() => void this.readState(), 700);
    });
  }

  private async readState(): Promise<void> {
    if (this.state !== 'playing' || this.covered) return;
    const state = await this.presentations.state();
    this.zone.run(() => {
      if (!state.running) {
        // Esc in the slideshow, or a click past the last slide (asked twice to be sure).
        if (++this.endedAnswers < 2) return;
        this.endedAnswers = 0;
        this.stopPolling();
        this.setState('ended');
        return;
      }
      this.endedAnswers = 0;
      if (state.slide !== this.slide || state.slides !== this.slides) {
        this.slide = state.slide ?? this.slide;
        this.slides = state.slides ?? this.slides;
        lastSlides.set(this.id, this.slide);
        this.cdr.markForCheck();
      }
    });
  }

  /** The class leaderboard or the slide list opened (or closed): the slideshow steps aside for it. */
  private async cover(reason: string, on: boolean): Promise<void> {
    if (this.state !== 'playing') return;
    const wasCovered = this.coverReasons.size > 0;
    if (on) this.coverReasons.add(reason);
    else this.coverReasons.delete(reason);
    const open = this.coverReasons.size > 0;
    if (open === wasCovered) return;
    const token = ++this.coverToken;
    if (open) {
      this.covered = true;
      const width = Math.round((this.stageRef?.nativeElement.clientWidth ?? 1280) * (window.devicePixelRatio || 1));
      this.still = await this.presentations.snapshot(width);
      if (token !== this.coverToken) return;
      this.cdr.markForCheck();
      await this.presentations.command('hide');
    } else {
      await this.presentations.command('show');
      if (token !== this.coverToken) return;
      this.covered = false;
      this.still = null;
      this.cdr.markForCheck();
    }
  }

  private placeStage(): void {
    const rect = this.stageRect();
    if (rect && this.state === 'playing') void this.presentations.move(rect);
  }

  /** Keeps the floating leaderboard button in the toolbar's free strip (and with it on resize). */
  private dockLeaderboardButton(): void {
    const dock = this.dockRef?.nativeElement;
    if (!dock) return;
    const update = () => {
      const r = dock.getBoundingClientRect();
      this.leaderboard.fabZone$.next({ left: r.left, top: r.top, width: r.width, height: r.height });
    };
    update();
    this.dockObserver = new ResizeObserver(update);
    this.dockObserver.observe(dock);
    this.dockObserver.observe(document.body);
  }

  private stageRect(): StageRect | null {
    const element = this.stageRef?.nativeElement;
    if (!element) return null;
    const r = element.getBoundingClientRect();
    return { x: r.left, y: r.top, width: r.width, height: r.height };
  }

  private setState(state: PlayerState): void {
    this.state = state;
    this.cdr.markForCheck();
  }

  private stopPolling(): void {
    if (this.poll) clearInterval(this.poll);
    this.poll = null;
  }

  // ---------- Controls ----------

  async next(): Promise<void> {
    if (this.state !== 'playing' || this.covered) return;
    await this.presentations.command('next');
    void this.readState();
  }

  async previous(): Promise<void> {
    if (this.state !== 'playing' || this.covered) return;
    await this.presentations.command('prev');
    void this.readState();
  }

  async goTo(slide: number): Promise<void> {
    if (this.state !== 'playing' || this.covered) return;
    await this.presentations.command('goto', Math.min(Math.max(1, slide), this.slides || 1));
    void this.readState();
  }

  // ---------- Jump to a slide ----------

  async toggleJump(): Promise<void> {
    if (this.jumpOpen) {
      await this.closeJump();
      return;
    }
    if (this.state !== 'playing' || this.coverReasons.has('class')) return;
    this.jumpOpen = true;
    this.cdr.markForCheck();
    await this.cover('jump', true);
    if (!this.pictures) this.pictures = new Array(this.slides).fill(null);
    this.scrollCurrentIntoView();
    void this.loadPictures();
  }

  // Asks for a few pictures at a time and shows each batch as it comes. Only while the list is
  // open, so the arrows (and leaving the page) never wait long behind picture-making.
  private async loadPictures(): Promise<void> {
    if (this.loadingPictures) return;
    this.loadingPictures = true;
    const batch = 3;
    try {
      for (let from = 1; from <= this.slides; from += batch) {
        if (this.destroyed || !this.jumpOpen || this.state !== 'playing' || !this.pictures) return;
        if (this.pictures.slice(from - 1, from - 1 + batch).every(Boolean)) continue;
        const result = await this.presentations.slidePictures(from, from + batch - 1);
        if (!result.slides || !this.pictures) return;
        const pictures = [...this.pictures];
        result.pictures.forEach((picture, index) => (pictures[from - 1 + index] = picture));
        this.pictures = pictures;
        this.cdr.markForCheck();
      }
    } finally {
      this.loadingPictures = false;
    }
  }

  // ---------- Drawing on the slide ----------

  /** Picks a tool; picking the one in use goes back to the normal pointer. */
  async setTool(tool: PointerTool): Promise<void> {
    if (this.state !== 'playing') return;
    this.tool = this.tool === tool ? 'arrow' : tool;
    this.cdr.markForCheck();
    await this.presentations.pointer(this.tool);
  }

  async clearDrawings(): Promise<void> {
    if (this.state !== 'playing') return;
    await this.presentations.pointer('clear');
  }

  async closeJump(): Promise<void> {
    if (!this.jumpOpen) return;
    this.jumpOpen = false;
    this.cdr.markForCheck();
    await this.cover('jump', false);
  }

  async jumpTo(slide: number): Promise<void> {
    await this.closeJump();
    await this.goTo(slide);
  }

  private scrollCurrentIntoView(): void {
    setTimeout(() => document.querySelector('.pp-jump-item.is-current')?.scrollIntoView({ block: 'nearest' }));
  }

  /** Full screen for the whole app (the floating full-screen button is hidden on this page). */
  async toggleFullScreen(): Promise<void> {
    const api = (window as any)?.electronAPI;
    try {
      if (typeof api?.toggleAppFullscreen === 'function') {
        await api.toggleAppFullscreen();
      } else if (document.fullscreenElement) {
        await document.exitFullscreen();
      } else {
        await document.documentElement.requestFullscreen();
      }
    } catch (error) {
      console.warn('Unable to toggle full screen', error);
    }
  }

  get failMessage(): string {
    if (this.failReason === 'POWERPOINT_BUSY') return 'presentationPowerPointBusy';
    if (this.failReason === 'PRESENTATION_EDITING') return 'presentationStillEditing';
    return 'presentationOpenFailed';
  }

  /** It is still open in PowerPoint from editing: close it there (only if saved) and play here. */
  async closeAndPlay(): Promise<void> {
    const error = await this.presentations.release(this.id);
    if (error) {
      this.failReason = error === 'PRESENTATION_UNSAVED' ? 'PRESENTATION_EDITING' : error;
      if (error === 'PRESENTATION_UNSAVED') showAppNotification(this.lang.translate('presentationSaveFirst'), 'info');
      this.cdr.markForCheck();
      return;
    }
    await this.start(this.slide || 1);
  }

  async playAgain(): Promise<void> {
    lastSlides.delete(this.id);
    await this.start(1);
  }

  /** The show was closed before its last slide (Esc, or by accident): it can carry on from there. */
  get canContinue(): boolean {
    return this.slide > 1 && this.slides > 0 && this.slide < this.slides;
  }

  async continueShow(): Promise<void> {
    await this.start(this.slide);
  }

  async edit(): Promise<void> {
    this.stopPolling();
    this.state = 'ended';
    await this.presentations.stop();
    await this.presentations.edit(this.id);
    this.back();
  }

  get backLabel(): string {
    return this.bookReturn ? 'menuBackToBook' : 'presentationBack';
  }

  back(): void {
    if (this.bookReturn) {
      void goBackToBook(this.router, this.bookReturn);
      return;
    }
    void this.router.navigate(['/topics'], { queryParams: { category: 'presentations' } });
  }

  /** The teacher's clicker and keyboard: arrows, Page Up/Down, space, Home/End. */
  @HostListener('window:keydown', ['$event'])
  onKey(event: KeyboardEvent): void {
    if (this.jumpOpen && event.key === 'Escape') {
      event.preventDefault();
      void this.closeJump();
      return;
    }
    if (this.state !== 'playing' || this.covered || isTypingTarget(event, { allowButtons: true })) return;
    const key = event.key;
    // Space / Enter on a focused toolbar button press that button instead.
    if ((key === ' ' || key === 'Enter') && event.target instanceof Element && event.target.closest('button')) return;
    if (['ArrowRight', 'ArrowDown', 'PageDown', ' ', 'Enter'].includes(key)) {
      event.preventDefault();
      void this.next();
    } else if (['ArrowLeft', 'ArrowUp', 'PageUp', 'Backspace'].includes(key)) {
      event.preventDefault();
      void this.previous();
    } else if (key === 'Home') {
      event.preventDefault();
      void this.goTo(1);
    } else if (key === 'End') {
      event.preventDefault();
      void this.goTo(this.slides);
    }
  }

  ngOnDestroy(): void {
    this.destroyed = true;
    this.stopPolling();
    this.resizeObserver?.disconnect();
    this.dockObserver?.disconnect();
    this.leaderboard.fabZone$.next(null);
    document.body.classList.remove('np-presenting');
    this.subscription?.unsubscribe();
    if (this.slide) lastSlides.set(this.id, this.slide);
    void this.presentations.stop();    // also closes the file after the show ended
  }
}
