import {
  AfterViewInit, ChangeDetectionStrategy, ChangeDetectorRef, Component, ElementRef, OnDestroy, ViewChild
} from '@angular/core';
import { DomSanitizer, SafeHtml, SafeResourceUrl } from '@angular/platform-browser';
import { ActivatedRoute, Router } from '@angular/router';
import { BookReturn, bookReturnFromQuery, goBackToBook } from '../../core/book-return';
import { PresentationLink } from '../../core/db.model';
import { LeaderboardStateService } from '../../core/leaderboard-state';
import { LINK_SOURCES, openPresentationPage, PresentationLinkService, toLinkTarget } from '../../core/presentation-links';
import { TranslatePipe } from '../../shared/translate-pipe';

/**
 * Plays a Canva or Google Slides presentation from its link, inside No-Prep: the service's own
 * viewer (its arrows, animations, full screen) fills the stage under No-Prep's bar. It is part of
 * the page, so the class leaderboard simply opens on top of it. Needs the internet.
 *
 * Also plays any web page (a sandboxed frame, so it can never move No-Prep away) and an added
 * .html file. The file runs walled off from No-Prep: in the desktop app from its own private
 * address (noprep-html://, served by the main process, so it may load its own fonts and scripts
 * from the internet), elsewhere as an inline document without No-Prep's origin. Either way it can
 * never read No-Prep's data.
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
  /** How the frame is shown: the service's viewer, a web page, or an added .html file. */
  frameKind: 'embed' | 'web' | 'html-app' | 'html-inline' = 'embed';
  /** The .html file's text, when it is shown inline (web / Android). */
  srcdoc: SafeHtml | null = null;
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
    if (link?.source === 'html') {
      await this.showHtml(link);
      this.cdr.markForCheck();
      return;
    }
    // Only addresses made by toLinkTarget (Canva / Google Slides embeds, https pages) are shown.
    const target = link ? toLinkTarget(link.embedUrl) ?? toLinkTarget(link.url) : null;
    if (!link || !target) {
      this.state = 'missing';
    } else {
      this.frameKind = target.source === 'web' ? 'web' : 'embed';
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
    if (!this.link || this.link.source === 'html') return;
    this.state = 'loading';
    // A fresh address makes the frame load again.
    const target = toLinkTarget(this.link.embedUrl);
    if (target) {
      const url = new URL(target.embedUrl);
      url.searchParams.set('t', String(Date.now()));
      this.src = this.sanitizer.bypassSecurityTrustResourceUrl(url.href);
    }
    this.cdr.markForCheck();
  }

  private async showHtml(link: PresentationLink): Promise<void> {
    const html = await this.links.htmlOf(link);
    if (this.destroyed) return;
    if (!html) {
      this.state = 'missing';
      return;
    }
    this.link = link;
    const api = (window as any)?.electronAPI?.presentations;
    if (typeof api?.serveHtml === 'function') {
      const served = await api.serveHtml(link.id, html);
      if (this.destroyed) return;
      // Only the app's own private address for this file is ever put in the frame.
      if (served?.ok && typeof served.result === 'string' && served.result.startsWith('noprep-html://')) {
        this.frameKind = 'html-app';
        this.src = this.sanitizer.bypassSecurityTrustResourceUrl(served.result);
        this.state = 'loading';
        return;
      }
    }
    this.frameKind = 'html-inline';
    this.srcdoc = this.sanitizer.bypassSecurityTrustHtml(html);
    this.state = 'loading';
  }

  get sourceIcon(): string {
    return LINK_SOURCES[this.link?.source ?? 'canva'].icon;
  }

  /** The ↗ button: Canva / Google Slides / web pages open in the browser; a file has no page. */
  get canOpenSite(): boolean {
    return !!this.link && this.link.source !== 'html';
  }

  get helpKey(): string {
    switch (this.link?.source) {
      case 'google': return 'presentationLinkHelpGoogle';
      case 'web': return 'presentationLinkHelpWeb';
      case 'html': return 'presentationLinkHelpHtml';
      default: return 'presentationLinkHelpCanva';
    }
  }

  get siteName(): string {
    const source = this.link?.source ?? 'canva';
    return source === 'web' && this.link ? new URL(this.link.embedUrl).hostname.replace(/^www\./, '') : LINK_SOURCES[source].name;
  }

  /** Opens the design on Canva / Google Slides itself (e.g. a private design the teacher is signed in to). */
  openSite(): void {
    if (this.link && this.link.source !== 'html') void openPresentationPage(this.link.url);
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
