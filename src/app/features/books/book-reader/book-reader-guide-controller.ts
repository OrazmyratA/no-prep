import {
  BookElement,
  BookPage,
  GuideAudioTrack,
  GuideTimelinePin
} from '../../../core/book.model';
import {
  getGuideTracks,
  getOrderedGuidePins
} from '../../../core/guide-timeline';
import {
  clamp,
  getGuideTextDelay
} from './book-reader-geometry';

export class BookReaderGuideController {
  constructor(private readonly reader: any) {}

  get currentSpeechSpeed(): number {
    return this.reader.speechSpeeds[this.reader.speechSpeedIndex] ?? 1;
  }

  cycleSpeechSpeed(): void {
    this.reader.speechSpeedIndex = (this.reader.speechSpeedIndex + 1) % this.reader.speechSpeeds.length;
    if (this.reader.activeAudio) {
      this.reader.activeAudio.playbackRate = this.currentSpeechSpeed;
    }
    this.reader.forceUiRefresh();
  }

  toggleGuideAudioPlayback(): void {
    if (!this.reader.activeAudio) return;
    if (this.reader.activeAudio.paused) {
      this.reader.guideAudioPaused = false;
      this.reader.pausedGuideElementId = null;
      void this.reader.activeAudio.play().catch(() => {
        this.reader.guideAudioPaused = true;
        this.reader.pausedGuideElementId = this.reader.playingGuideElementId;
        this.reader.forceUiRefresh();
      });
    } else {
      this.reader.activeAudio.pause();
      this.reader.guideAudioPaused = true;
      this.reader.pausedGuideElementId = this.reader.playingGuideElementId;
    }
    this.reader.forceUiRefresh();
  }

  seekGuideAudio(event: Event): void {
    if (!this.reader.activeAudio) return;
    const input = event.target as HTMLInputElement | null;
    const value = Number(input?.value);
    if (!Number.isFinite(value)) return;
    this.reader.activeAudio.currentTime = clamp(value, 0, this.reader.guideAudioDuration || this.reader.activeAudio.duration || 0);
    this.reader.guideAudioCurrentTime = this.reader.activeAudio.currentTime;
    if (this.reader.activeGuideElement && this.reader.activeGuidePage && this.reader.activeGuideTrackIndex >= 0) {
      this.applyReaderGuideState(
        this.reader.activeGuideElement,
        this.reader.activeGuidePage,
        this.reader.activeGuideTrackIndex,
        this.reader.guideAudioCurrentTime,
        true
      );
    }
    this.reader.forceUiRefresh();
  }

  setGuideAudioVolume(event: Event): void {
    const input = event.target as HTMLInputElement | null;
    const value = Number(input?.value);
    if (!Number.isFinite(value)) return;
    this.reader.guideAudioVolume = clamp(value, 0, 1);
    if (this.reader.activeAudio) {
      this.reader.activeAudio.volume = this.reader.guideAudioVolume;
    }
  }

  toggleGuideBubble(event?: MouseEvent): void {
    event?.preventDefault();
    event?.stopPropagation();
    if (!this.reader.guideBubbleText) return;
    this.reader.guideBubbleExpanded = !this.reader.guideBubbleExpanded;
  }

  async playGuideDot(element: BookElement, page = this.reader.currentPage): Promise<void> {
    if (!page || element.type !== 'guideDot' || !this.isGuideDotEnabled(element, page)) return;
    this.stopGuideAudio();
    const token = ++this.reader.guidePlaybackToken;
    this.reader.playingGuideElementId = element.id;
    this.reader.pausedGuideElementId = null;
    const tracks = getGuideTracks(element);
    const hasTimedPins = getOrderedGuidePins(element).length > 0;
    this.reader.guideBubbleText = hasTimedPins ? '' : String(element.data['text'] || '');
    this.reader.guideBubbleExpanded = false;
    this.reader.activeGuideElement = element;
    this.reader.activeGuidePage = page;
    this.reader.activeGuidePinId = null;
    this.setGuideOverlayImage('');
    this.reader.moveOwlToElement(element, page);
    this.reader.owlTeaching = true;
    this.reader.owlImage = 'assets/gifs/owl-teaching.gif';
    this.reader.forceUiRefresh();
    await this.wait(360);
    if (token !== this.reader.guidePlaybackToken) return;

    this.reader.guideSegmentCount = tracks.length;
    this.reader.guideSegmentIndex = -1;
    if (tracks.length) {
      for (const [index, track] of tracks.entries()) {
        if (token !== this.reader.guidePlaybackToken) return;
        this.reader.guideSegmentIndex = index;
        this.reader.activeGuideTrackIndex = index;
        this.applyReaderGuideState(element, page, index, 0, true);
        await this.playAudioTrack(track, element, page, index, token);
      }
    } else {
      await this.wait(getGuideTextDelay(this.reader.guideBubbleText));
    }
    if (token !== this.reader.guidePlaybackToken) return;

    this.finishGuideDot(element, page);
  }

  isGuideDotEnabled(element: BookElement, page = this.reader.currentPage): boolean {
    if (!page || element.type !== 'guideDot') return false;
    if (this.isPageInActiveSpread(page)) {
      const dots = this.getActiveSpreadGuideDots();
      const index = dots.findIndex((item) => item.element.id === element.id && item.page.id === page.id);
      return index >= 0 && index <= (this.reader.guideProgress[this.getActiveSpreadGuideProgressKey()] ?? 0);
    }
    const dots = this.getGuideDots(page);
    const index = dots.findIndex((dot) => dot.id === element.id);
    return index >= 0 && index <= (this.reader.guideProgress[page.id] ?? 0);
  }

  stopGuideAudio(): void {
    this.reader.guidePlaybackToken++;
    if (this.reader.activeAudio) {
      this.reader.activeAudio.pause();
      this.reader.activeAudio = null;
    }
    this.reader.activePitchCleanup?.();
    this.reader.activePitchCleanup = null;
    this.reader.guideAudioResolver?.();
    this.reader.guideAudioResolver = null;
    this.reader.playingGuideElementId = null;
    this.reader.pausedGuideElementId = null;
    this.reader.guideBubbleText = '';
    this.reader.guideBubbleExpanded = false;
    this.reader.guideAudioVisible = false;
    this.reader.guideAudioPaused = false;
    this.reader.guideAudioCurrentTime = 0;
    this.reader.guideAudioDuration = 0;
    this.reader.guideSegmentIndex = -1;
    this.reader.guideSegmentCount = 0;
    this.reader.activeGuideElement = null;
    this.reader.activeGuidePage = null;
    this.reader.activeGuideTrackIndex = -1;
    this.reader.activeGuidePinId = null;
    this.setGuideOverlayImage('');
  }

  stopGuideAudioAndReturnHome(): void {
    const hadGuideAudio = !!this.reader.playingGuideElementId
      || this.reader.guideAudioVisible
      || !!this.reader.guideBubbleText
      || this.reader.owlTeaching;
    this.stopGuideAudio();
    if (hadGuideAudio) {
      this.reader.moveOwlToCorner();
      this.reader.forceUiRefresh();
    }
  }

  cancelGuideOverlayPositionFrame(): void {
    if (!this.reader.guideOverlayPositionFrame) return;
    cancelAnimationFrame(this.reader.guideOverlayPositionFrame);
    this.reader.guideOverlayPositionFrame = 0;
  }

  refreshGuideAudioControls(): void {
    if (this.reader.guideAudioUiFrame) return;
    this.reader.guideAudioUiFrame = requestAnimationFrame(() => {
      this.reader.guideAudioUiFrame = 0;
      this.reader.zone.run(() => this.reader.cdr.detectChanges());
    });
  }

  private async playAudioTrack(
    track: GuideAudioTrack,
    element: BookElement,
    page: BookPage,
    trackIndex: number,
    token = this.reader.guidePlaybackToken
  ): Promise<void> {
    if (!this.reader.book) return;

    const audio = new Audio(this.reader.getCachedAssetFileUrl(track.src));
    audio.playbackRate = this.currentSpeechSpeed;
    audio.volume = this.reader.guideAudioVolume;

    const semitones = track.pitchSemitones ?? 0;
    if (semitones) {
      const cleanup = await this.reader.guidePitch.connect(audio, semitones, this.currentSpeechSpeed);
      if (this.reader.guidePlaybackToken !== token) { cleanup(); return; }
      this.reader.activePitchCleanup = cleanup;
    }

    this.reader.activeAudio = audio;
    return new Promise((resolve) => {
      this.reader.guideAudioVisible = true;
      this.reader.guideAudioPaused = false;
      this.reader.guideAudioCurrentTime = 0;
      this.reader.guideAudioDuration = 0;
      this.reader.guideAudioResolver = resolve;
      audio.onloadedmetadata = () => {
        if (token !== this.reader.guidePlaybackToken) return;
        this.reader.guideAudioDuration = Number.isFinite(audio.duration) ? audio.duration : 0;
        if (this.reader.guideAudioDuration > 0) {
          track.duration = this.reader.guideAudioDuration;
        }
        this.refreshGuideAudioControls();
      };
      audio.ontimeupdate = () => {
        if (token !== this.reader.guidePlaybackToken) return;
        this.reader.guideAudioCurrentTime = Number.isFinite(audio.currentTime) ? audio.currentTime : 0;
        if (!this.reader.guideAudioDuration && Number.isFinite(audio.duration)) {
          this.reader.guideAudioDuration = audio.duration;
        }
        this.applyReaderGuideState(element, page, trackIndex, this.reader.guideAudioCurrentTime);
        this.refreshGuideAudioControls();
      };
      audio.onplay = () => {
        if (token !== this.reader.guidePlaybackToken) return;
        this.reader.guideAudioPaused = false;
        this.reader.pausedGuideElementId = null;
        this.refreshGuideAudioControls();
      };
      audio.onpause = () => {
        if (token !== this.reader.guidePlaybackToken || audio.ended) return;
        this.reader.guideAudioPaused = true;
        this.reader.pausedGuideElementId = this.reader.playingGuideElementId;
        this.refreshGuideAudioControls();
      };
      audio.onended = () => {
        if (token !== this.reader.guidePlaybackToken) return;
        this.applyReaderGuideState(element, page, trackIndex, audio.duration || this.reader.guideAudioDuration, true);
        this.reader.guideAudioResolver = null;
        this.reader.activeAudio = null;
        this.reader.guideAudioCurrentTime = 0;
        this.reader.guideAudioDuration = 0;
        this.reader.guideAudioPaused = false;
        resolve();
      };
      audio.onerror = () => {
        if (token !== this.reader.guidePlaybackToken) return;
        this.reader.guideAudioResolver = null;
        this.reader.activeAudio = null;
        this.reader.guideAudioCurrentTime = 0;
        this.reader.guideAudioDuration = 0;
        this.reader.guideAudioPaused = false;
        resolve();
      };
      void audio.play().catch(() => {
        this.reader.guideAudioResolver = null;
        this.reader.activeAudio = null;
        this.reader.guideAudioVisible = false;
        this.reader.guideAudioCurrentTime = 0;
        this.reader.guideAudioDuration = 0;
        this.reader.guideAudioPaused = false;
        resolve();
      });
    });
  }

  private applyReaderGuideState(
    element: BookElement,
    page: BookPage,
    trackIndex: number,
    time: number,
    force = false
  ): void {
    const tracks = getGuideTracks(element);
    let activePin: GuideTimelinePin | null = null;
    for (let index = 0; index <= trackIndex && index < tracks.length; index++) {
      const limit = index < trackIndex ? Number.POSITIVE_INFINITY : time + 0.01;
      const pin = [...(tracks[index].pins || [])]
        .sort((a, b) => a.time - b.time)
        .filter((candidate) => candidate.time <= limit)
        .pop();
      if (pin) activePin = pin;
    }

    if (!activePin) {
      if (!getOrderedGuidePins(element).length) {
        this.reader.guideBubbleText = String(element.data['text'] || '');
      } else {
        this.reader.guideBubbleText = '';
      }
      this.reader.guideBubbleExpanded = false;
      this.setGuideOverlayImage('');
      this.reader.moveOwlToElement(element, page);
      this.reader.activeGuidePinId = null;
      return;
    }

    if (!force && activePin.id === this.reader.activeGuidePinId) return;
    this.reader.activeGuidePinId = activePin.id;
    this.reader.guideBubbleText = activePin.text || '';
    this.reader.guideBubbleExpanded = false;
    const imageUrl = activePin.imageSrc ? this.reader.getCachedAssetUrl(activePin.imageSrc) : '';
    if (imageUrl) {
      this.setGuideOverlayImage(imageUrl);
    } else {
      this.cancelGuideOverlayPositionFrame();
      this.reader.moveOwlToGuidePin(activePin, page);
      this.setGuideOverlayImage('');
    }
    this.reader.forceUiRefresh();
  }

  private setGuideOverlayImage(url: string): void {
    if (this.reader.guideOverlayTimer !== null) {
      window.clearTimeout(this.reader.guideOverlayTimer);
      this.reader.guideOverlayTimer = null;
    }
    if (!url) {
      this.cancelGuideOverlayPositionFrame();
      this.reader.guideOverlayVisible = false;
      if (this.reader.guideOverlayImageUrl) {
        this.reader.guideOverlayTimer = window.setTimeout(() => {
          this.reader.guideOverlayTimer = null;
          this.reader.guideOverlayImageUrl = '';
          this.reader.forceUiRefresh();
        }, 240);
      }
      return;
    }
    if (url === this.reader.guideOverlayImageUrl) {
      this.reader.guideOverlayVisible = true;
      this.reader.forceUiRefresh();
      this.scheduleOwlAtGuideOverlayCorner();
      return;
    }
    this.reader.guideOverlayVisible = false;
    this.reader.guideOverlayTimer = window.setTimeout(() => {
      this.reader.guideOverlayTimer = null;
      this.reader.guideOverlayImageUrl = url;
      this.reader.guideOverlayVisible = true;
      this.reader.forceUiRefresh();
      this.scheduleOwlAtGuideOverlayCorner();
    }, 120);
  }

  private scheduleOwlAtGuideOverlayCorner(): void {
    this.cancelGuideOverlayPositionFrame();
    this.reader.guideOverlayPositionFrame = requestAnimationFrame(() => {
      this.reader.guideOverlayPositionFrame = requestAnimationFrame(() => {
        this.reader.guideOverlayPositionFrame = 0;
        this.moveOwlToGuideOverlayCorner();
      });
    });
  }

  private moveOwlToGuideOverlayCorner(): void {
    const frame = this.reader.guidePinMediaFrame?.nativeElement;
    if (!frame) return;
    const rect = frame.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const owlSize = clamp(window.innerWidth * 0.09, 68, 112);
    const bounds = this.reader.getOwlVisibleBounds(true);
    const targetX = rect.left + owlSize * 0.5;
    const targetY = rect.bottom;
    this.reader.owlX = clamp(targetX, bounds.minX, bounds.maxX);
    this.reader.owlY = clamp(targetY, bounds.minY, bounds.maxY);
    this.reader.forceUiRefresh();
  }

  private finishGuideDot(element: BookElement, page = this.reader.currentPage): void {
    this.completeGuideDot(element, page);
    this.stopGuideAudioAndReturnHome();
    this.reader.forceUiRefresh();
  }

  private completeGuideDot(element: BookElement, page = this.reader.currentPage): void {
    if (!page) return;
    if (this.isPageInActiveSpread(page)) {
      const dots = this.getActiveSpreadGuideDots();
      const index = dots.findIndex((item) => item.element.id === element.id && item.page.id === page.id);
      if (index >= 0) {
        const key = this.getActiveSpreadGuideProgressKey();
        this.reader.guideProgress[key] = Math.max(this.reader.guideProgress[key] ?? 0, index + 1);
      }
    }

    const dots = this.getGuideDots(page);
    const index = dots.findIndex((dot) => dot.id === element.id);
    if (index < 0) return;
    this.reader.guideProgress[page.id] = Math.max(this.reader.guideProgress[page.id] ?? 0, index + 1);
  }

  private getGuideDots(page: BookPage): BookElement[] {
    return page.elements
      .map((element, index) => ({ element, index }))
      .filter(({ element }) => element.type === 'guideDot')
      .sort((a, b) => Number(a.element.data['stepNumber'] ?? a.index) - Number(b.element.data['stepNumber'] ?? b.index))
      .map(({ element }) => element);
  }

  private isPageInActiveSpread(page: BookPage): boolean {
    return this.reader.twoPageMode && !!this.reader.companionPage && [this.reader.currentPage?.id, this.reader.companionPage.id].includes(page.id);
  }

  private getActiveSpreadGuideDots(): { page: BookPage; element: BookElement }[] {
    const pages = [this.reader.currentPage, this.reader.companionPage].filter((page): page is BookPage => !!page);
    return pages.flatMap((page) => this.getGuideDots(page).map((element) => ({ page, element })));
  }

  private getActiveSpreadGuideProgressKey(): string {
    return `spread:${this.reader.pageSource}:${this.reader.currentPage?.id || ''}:${this.reader.companionPage?.id || ''}`;
  }

  private wait(ms: number): Promise<void> {
    return new Promise((resolve) => window.setTimeout(resolve, ms / this.currentSpeechSpeed));
  }
}
