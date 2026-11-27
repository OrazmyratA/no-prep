import { ChangeDetectionStrategy, ChangeDetectorRef, Component, ElementRef, Input, OnDestroy, OnInit, ViewChild } from '@angular/core';
import { Subscription } from 'rxjs';
import { BookElement } from '../../../../core/book.model';
import { PresentationLink } from '../../../../core/db.model';
import { LINK_SOURCES, LinkSource, PresentationLinkService, toLinkTarget } from '../../../../core/presentation-links';
import { PresentationItem, PresentationService } from '../../../../core/presentations';
import { TranslatePipe } from '../../../../shared/translate-pipe';

/**
 * The book creator's panel for a PPT icon: shows only the chosen presentation (a PowerPoint file,
 * or a Canva / Google Slides link). "Choose a presentation" goes to the Presentations tab, like
 * the game icon's topic picker (see BookCreatorPresentationController). For PowerPoint: the slide
 * it starts on, picked from a two-column grid of its slides (or typed).
 *
 * Element data: presentationKind ('file' | 'link'), presentationId, presentationTitle, startSlide
 * (PowerPoint), presentationUrl (links: the book carries the link itself, so a shared book plays
 * it on any device).
 */
@Component({
  selector: 'app-book-presentation-link',
  standalone: true,
  imports: [TranslatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './book-presentation-link.html',
  styleUrls: ['./book-presentation-link.css']
})
export class BookPresentationLinkComponent implements OnInit, OnDestroy {
  @Input({ required: true }) creator!: any;
  @Input({ required: true }) element!: BookElement;

  items: PresentationItem[] = [];
  links: PresentationLink[] = [];
  private thumbs = new Map<string, string | null>();
  private subscriptions: Subscription[] = [];

  /** Slide pictures for the start-slide grid (index 0 = slide 1); null while not made yet. */
  slidePictures: (string | null)[] = [];
  /** Width / height of the slides, from the first picture (16:9 until then). */
  slideRatio = 16 / 9;
  private slidesKey = '';
  private slidesRetry: ReturnType<typeof setTimeout> | null = null;
  private destroyed = false;
  @ViewChild('slideGrid') private slideGrid?: ElementRef<HTMLElement>;

  constructor(
    public presentations: PresentationService,
    private presentationLinks: PresentationLinkService,
    private cdr: ChangeDetectorRef
  ) {}

  async ngOnInit(): Promise<void> {
    this.subscriptions.push(
      this.presentations.items$.subscribe((items) => {
        this.items = items;
        this.cdr.markForCheck();
      }),
      this.presentationLinks.links$.subscribe((links) => {
        this.links = links;
        this.cdr.markForCheck();
      })
    );
    await this.presentationLinks.refresh();
    if (this.presentations.isDesktop) await this.presentations.refresh();
  }

  ngOnDestroy(): void {
    this.destroyed = true;
    if (this.slidesRetry) clearTimeout(this.slidesRetry);
    this.subscriptions.forEach((s) => s.unsubscribe());
  }

  get linkedId(): string {
    return String(this.element.data['presentationId'] || '');
  }

  get isLinkKind(): boolean {
    return this.element.data['presentationKind'] === 'link';
  }

  /** The linked PowerPoint file, if it is on this computer. */
  get linked(): PresentationItem | null {
    if (this.isLinkKind) return null;
    return this.items.find((item) => item.id === this.linkedId) ?? null;
  }

  /**
   * The linked Canva / Google Slides / web link or .html file (from this device's list, else a
   * link from the book itself; an .html file lives only on the device it was added on).
   */
  get linkedLink(): { title: string; source: LinkSource } | null {
    if (!this.isLinkKind || !this.linkedId) return null;
    const local = this.links.find((link) => link.id === this.linkedId);
    if (local) return local;
    const target = toLinkTarget(String(this.element.data['presentationUrl'] || ''));
    return target ? { title: String(this.element.data['presentationTitle'] || ''), source: target.source } : null;
  }

  sourceIcon(source: LinkSource): string {
    return LINK_SOURCES[source]?.icon ?? '🔗';
  }

  sourceName(source: LinkSource): { name: string; nameKey?: string } {
    return LINK_SOURCES[source] ?? LINK_SOURCES.canva;
  }

  /** Slide numbers for the grid (1..count); starts reading the pictures for a newly linked deck. */
  get slideNumbers(): number[] {
    const item = this.linked;
    if (!item || !item.slideCount || !this.presentations.isDesktop) return [];
    const key = `${item.id}:${item.thumbVersion}:${item.slideCount}`;
    if (key !== this.slidesKey) {
      this.slidesKey = key;
      this.slidePictures = new Array(item.slideCount).fill(null);
      if (this.slidesRetry) clearTimeout(this.slidesRetry);
      void this.loadSlidePictures(item, key);
    }
    return Array.from({ length: item.slideCount }, (_, i) => i + 1);
  }

  /**
   * A few pictures at a time, the start slide's batch first, so the grid fills in as PowerPoint
   * makes them (the first time) or straight away (later: read from disk). When PowerPoint can't
   * now (a slideshow is playing), it tries again a little later.
   */
  private async loadSlidePictures(item: PresentationItem, key: string): Promise<void> {
    const batch = 6;
    const count = item.slideCount;
    const starts: number[] = [];
    for (let from = 1; from <= count; from += batch) starts.push(from);
    const startBatch = Math.floor((Math.min(this.startSlide, count) - 1) / batch) * batch + 1;
    starts.sort((a, b) => (a === startBatch ? -1 : b === startBatch ? 1 : a - b));
    for (const from of starts) {
      if (this.destroyed || key !== this.slidesKey) return;
      if (this.slidePictures.slice(from - 1, from - 1 + batch).every(Boolean)) continue;
      const result = await this.presentations.deckSlidePictures(item.id, from, Math.min(count, from + batch - 1));
      if (this.destroyed || key !== this.slidesKey) return;
      result.pictures.forEach((picture, i) => {
        if (picture) this.slidePictures[from - 1 + i] = picture;
      });
      this.slidePictures = [...this.slidePictures];
      if (from === 1 && result.pictures[0]) this.measureRatio(result.pictures[0]);
      this.cdr.markForCheck();
      if (from === startBatch) setTimeout(() => this.scrollToStart(), 0);
      if (result.busy) {
        this.slidesRetry = setTimeout(() => {
          if (key === this.slidesKey) void this.loadSlidePictures(item, key);
        }, 5000);
        return;
      }
    }
  }

  private measureRatio(src: string): void {
    const image = new Image();
    image.onload = () => {
      if (image.naturalWidth && image.naturalHeight) {
        this.slideRatio = image.naturalWidth / image.naturalHeight;
        this.cdr.markForCheck();
      }
    };
    image.src = src;
  }

  /** Brings the start slide into view inside the grid (not the whole panel). */
  private scrollToStart(): void {
    const grid = this.slideGrid?.nativeElement;
    const tile = grid?.querySelector<HTMLElement>(`[data-slide="${this.startSlide}"]`);
    if (!grid || !tile) return;
    const top = tile.offsetTop - grid.offsetTop;
    if (top < grid.scrollTop || top + tile.offsetHeight > grid.scrollTop + grid.clientHeight) {
      grid.scrollTop = Math.max(0, top - (grid.clientHeight - tile.offsetHeight) / 2);
    }
  }

  /** The card's picture: the start slide once its picture is made, else the first slide. */
  get cardPicture(): string | null {
    return this.slidePictures[this.startSlide - 1] ?? this.thumb;
  }

  /** The chosen PowerPoint's first slide (loaded once per picture version). */
  get thumb(): string | null {
    const item = this.linked;
    if (!item) return null;
    const key = `${item.id}:${item.thumbVersion}`;
    if (!this.thumbs.has(key)) {
      this.thumbs.set(key, null);
      void this.presentations.thumbnail(item).then((src) => {
        this.thumbs.set(key, src);
        this.cdr.markForCheck();
      });
    }
    return this.thumbs.get(key) ?? null;
  }

  get startSlide(): number {
    return Math.max(1, Number(this.element.data['startSlide']) || 1);
  }

  unlink(): void {
    this.creator.captureHistory();
    this.element.data['presentationKind'] = 'file';
    this.element.data['presentationId'] = null;
    this.element.data['presentationTitle'] = '';
    this.element.data['presentationUrl'] = '';
    this.element.data['label'] = 'PowerPoint';
    this.element.data['startSlide'] = 1;
    this.cdr.markForCheck();
  }

  setStartSlide(value: string): void {
    const max = this.linked?.slideCount || 999;
    const slide = Math.min(max, Math.max(1, Math.round(Number(value)) || 1));
    if (slide === this.startSlide) return;
    this.creator.captureHistory();
    this.element.data['startSlide'] = slide;
    this.cdr.markForCheck();
    setTimeout(() => this.scrollToStart(), 0);
  }
}
