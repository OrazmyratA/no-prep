import {
  AfterViewInit, ChangeDetectionStrategy, ChangeDetectorRef, Component, ElementRef, OnDestroy, ViewChild
} from '@angular/core';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { ActivatedRoute, Router } from '@angular/router';
import { BookReturn, bookReturnFromQuery, goBackToBook } from '../../core/book-return';
import { PresentationLink } from '../../core/db.model';
import { LeaderboardStateService } from '../../core/leaderboard-state';
import { openPresentationPage, PresentationLinkService, toEmbedTarget } from '../../core/presentation-links';
import { TranslatePipe } from '../../shared/translate-pipe';

/**
 * Plays a Canva or Google Slides presentation from its link, inside No-Prep: the service's own
 * viewer (its arrows, animations, full screen) fills the stage under No-Prep's bar. It is part of
 * the page, so the class leaderboard simply opens on top of it. Needs the internet.
 */
@Component({
  selector: 'app-presentation-link-player',
  standalone: true,
  imports: [TranslatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './presentation-link-player.html',
  styleUrls: ['./presentation-player.css', './presentation-link-player.css']
})
export class PresentationLinkPlayerComponent implements AfterViewInit, OnDestroy {
  /** The bar's free strip: the floating leaderboard button lives here, as in the PowerPoint player. */
  @ViewChild('dock') dockRef?: ElementRef<HTMLElement>;

  link: PresentationLink | null = null;
  src: SafeResourceUrl | null = null;
  state: 'loading' | 'ready' | 'missing' | 'offline' = 'loading';
  showHelp = false;
  bookReturn: BookReturn | null = null;

  private dockObserver?: ResizeObserver;
  private destroyed = false;

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private links: PresentationLinkService,
    private leaderboard: LeaderboardStateService,
    private sanitizer: DomSanitizer,
    private cdr: ChangeDetectorRef
  ) {}

  async ngAfterViewInit(): Promise<void> {
    document.body.classList.add('np-presenting');
    this.dockLeaderboardButton();
    this.bookReturn = bookReturnFromQuery(this.route.snapshot.queryParamMap);
    const id = this.route.snapshot.paramMap.get('id') ?? '';
    const link = await this.links.get(id);
    if (this.destroyed) return;
    // Only addresses made by toEmbedTarget (Canva / Google Slides) are ever shown.
    const target = link ? toEmbedTarget(link.embedUrl) ?? toEmbedTarget(link.url) : null;
    if (!link || !target) {
      this.state = 'missing';
    } else {
      this.link = link;
      this.src = this.sanitizer.bypassSecurityTrustResourceUrl(target.embedUrl);
      this.state = navigator.onLine === false ? 'offline' : 'loading';
    }
    this.cdr.markForCheck();
  }

  onFrameLoad(): void {
    if (this.state === 'loading') {
      this.state = 'ready';
      this.cdr.markForCheck();
    }
  }

  retry(): void {
    if (!this.link) return;
    this.state = 'loading';
    // A fresh address makes the frame load again.
    const target = toEmbedTarget(this.link.embedUrl);
    if (target) this.src = this.sanitizer.bypassSecurityTrustResourceUrl(`${target.embedUrl}&t=${Date.now()}`);
    this.cdr.markForCheck();
  }

  get siteName(): string {
    return this.link?.source === 'google' ? 'Google Slides' : 'Canva';
  }

  /** Opens the design on Canva / Google Slides itself (e.g. a private design the teacher is signed in to). */
  openSite(): void {
    if (this.link) void openPresentationPage(this.link.url);
  }

  toggleHelp(): void {
    this.showHelp = !this.showHelp;
    this.cdr.markForCheck();
  }

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

  ngOnDestroy(): void {
    this.destroyed = true;
    this.dockObserver?.disconnect();
    this.leaderboard.fabZone$.next(null);
    document.body.classList.remove('np-presenting');
  }
}
