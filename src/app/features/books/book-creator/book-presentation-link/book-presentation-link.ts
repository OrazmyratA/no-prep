import { ChangeDetectionStrategy, ChangeDetectorRef, Component, Input, OnDestroy, OnInit } from '@angular/core';
import { Subscription } from 'rxjs';
import { BookElement } from '../../../../core/book.model';
import { PresentationLink } from '../../../../core/db.model';
import { PresentationLinkService, toEmbedTarget } from '../../../../core/presentation-links';
import { PresentationItem, PresentationService } from '../../../../core/presentations';
import { TranslatePipe } from '../../../../shared/translate-pipe';

/**
 * The book creator's panel for a PPT icon: shows only the chosen presentation (a PowerPoint file,
 * or a Canva / Google Slides link). "Choose a presentation" goes to the Presentations tab, like
 * the game icon's topic picker (see BookCreatorPresentationController). For PowerPoint: the slide
 * it starts on.
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

  /** The linked Canva / Google Slides link (from this device's list, else from the book itself). */
  get linkedLink(): { title: string; source: 'canva' | 'google' } | null {
    if (!this.isLinkKind || !this.linkedId) return null;
    const local = this.links.find((link) => link.id === this.linkedId);
    if (local) return local;
    const target = toEmbedTarget(String(this.element.data['presentationUrl'] || ''));
    return target ? { title: String(this.element.data['presentationTitle'] || ''), source: target.source } : null;
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
  }
}
