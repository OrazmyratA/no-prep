import { ChangeDetectorRef, Component, Input, OnDestroy } from '@angular/core';
import { Subscription } from 'rxjs';

import { BookElement } from '../../../core/book.model';
import { LanguageService } from '../../../core/language';
import { SubtitleLine } from '../../../core/subtitles/subtitle-lines';
import {
  SUBTITLE_LANGUAGES,
  SubtitleSession,
  VideoSubtitlesService,
  bookVideoSubtitles
} from '../../../core/subtitles/video-subtitles';
import { ConfirmationService } from '../../../shared/confirmation';

/**
 * A video's subtitles in the book creator: pick the language, ✨ make them (on this computer, before
 * class), fix a word or remove a line. They are saved in the book, so the reader and a shared copy
 * show them at once.
 */
@Component({
  selector: 'app-book-creator-video-subtitles',
  standalone: false,
  templateUrl: './book-creator-video-subtitles.html',
  styleUrl: './book-creator-video-subtitles.css'
})
export class BookCreatorVideoSubtitlesComponent implements OnDestroy {
  @Input({ required: true }) creator!: any;
  @Input({ required: true })
  set element(value: BookElement) {
    if (value !== this._element) this.stop();
    this._element = value;
  }
  get element(): BookElement {
    return this._element;
  }
  private _element!: BookElement;

  readonly languages = SUBTITLE_LANGUAGES;
  session: SubtitleSession | null = null;
  private subscriptions: Subscription[] = [];

  constructor(
    private videoSubtitles: VideoSubtitlesService,
    private confirmation: ConfirmationService,
    private lang: LanguageService,
    private cdr: ChangeDetectorRef
  ) {}

  get language(): string {
    return bookVideoSubtitles(this.element.data).language;
  }

  get lines(): SubtitleLine[] {
    return bookVideoSubtitles(this.element.data).lines;
  }

  /** A file the app can listen to (YouTube and other web pages can't be heard). */
  get canMake(): boolean {
    const src = String(this.element.data?.['src'] || '');
    return !!src && !/^https?:\/\//i.test(src);
  }

  get making(): boolean {
    const phase = this.session?.state$.value.phase;
    return phase === 'downloading' || phase === 'listening';
  }

  get phase(): string {
    return this.session?.state$.value.phase ?? 'idle';
  }

  get percent(): number {
    return Math.round((this.session?.state$.value.progress ?? 0) * 100);
  }

  setLanguage(language: string): void {
    this.stop();
    this.write({ language, lines: this.lines });
  }

  async make(): Promise<void> {
    if (!this.canMake || this.making || !this.creator.book) return;
    if (this.lines.length && !(await this.confirmation.confirm(this.lang.translate('subtitlesMakeAgainConfirm')))) return;
    this.stop();
    const src = String(this.element.data['src']);
    const session = this.videoSubtitles.open(`${this.creator.book.id}:${src}`, this.creator.getElementAssetUrl(this.element), this.language);
    this.session = session;
    await session.reset();
    this.write({ language: this.language, lines: [] });
    this.subscriptions.push(
      // Each finished piece goes into the book straight away (nothing lost if the teacher leaves).
      session.lines$.subscribe((lines) => {
        if (this.session === session && lines.length) this.write({ language: this.language, lines });
      }),
      session.state$.subscribe(() => this.cdr.markForCheck())
    );
    await session.start();
  }

  editText(index: number, text: string): void {
    const lines = this.lines.map((line, i) => (i === index ? { ...line, text } : line));
    this.write({ language: this.language, lines });
  }

  removeLine(index: number): void {
    this.creator.beginHistoryCapture();
    this.write({ language: this.language, lines: this.lines.filter((_, i) => i !== index) });
    this.creator.commitHistoryCapture();
  }

  /** 0:08 — where the line starts in the video. */
  time(seconds: number): string {
    const whole = Math.max(0, Math.floor(seconds));
    return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
  }

  trackLine(index: number, line: SubtitleLine): string {
    return `${index}:${line.start}`;
  }

  private write(subtitles: { language: string; lines: SubtitleLine[] }): void {
    this.element.data['subtitles'] = subtitles;
    this.creator.markBookDirty();
    this.cdr.markForCheck();
  }

  private stop(): void {
    this.subscriptions.splice(0).forEach((s) => s.unsubscribe());
    this.session?.dispose();
    this.session = null;
  }

  ngOnDestroy(): void {
    this.stop();
  }
}
