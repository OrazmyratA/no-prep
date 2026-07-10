import {
  BookElement,
  GuideAudioTrack,
  GuideTimelinePin
} from '../../../core/book.model';
import { getOrderedGuidePins } from '../../../core/guide-timeline';

export class BookCreatorGuidePreviewController {
  constructor(private readonly creator: any) {}

  async toggleGuideTrackPreview(element: BookElement): Promise<void> {
    if (!this.creator.book || element.type !== 'guideDot') return;
    const track = this.creator.getSelectedGuideTrack(element) ?? this.creator.getGuideDotTracks(element)[0];
    if (!track) return;
    this.selectGuideTrack(element, track);

    if (this.creator.activePreviewAudio && this.creator.previewGuideTrackId === track.id) {
      if (this.creator.activePreviewAudio.paused) {
        const duration = this.creator.getGuideTrackDuration(track);
        if (duration > 0 && this.creator.activePreviewAudio.currentTime >= duration - 0.05) {
          this.creator.activePreviewAudio.currentTime = 0;
          this.creator.previewGuideCurrentTime = 0;
          this.creator.guideTrackSeekTimes[track.id] = 0;
          this.applyCreatorGuideState(element, track, 0);
        }
        await this.creator.activePreviewAudio.play().catch(() => {});
      } else {
        this.creator.activePreviewAudio.pause();
      }
      return;
    }

    const duration = this.creator.getGuideTrackDuration(track);
    const startTime = duration > 0 && this.creator.previewGuideCurrentTime >= duration - 0.05
      ? 0
      : this.creator.previewGuideCurrentTime;
    this.startGuideTrackPreview(element, track, startTime);
  }

  stopGuidePreview(): void {
    if (this.creator.previewGuideTrackId) {
      const time = this.creator.activePreviewAudio
        ? this.creator.activePreviewAudio.currentTime
        : this.creator.previewGuideCurrentTime;
      this.creator.guideTrackSeekTimes[this.creator.previewGuideTrackId] = Math.max(0, Number(time) || 0);
    }
    this.creator.previewToken++;
    if (this.creator.activePreviewAudio) {
      this.creator.activePreviewAudio.pause();
      this.creator.activePreviewAudio = null;
    }
    this.creator.previewPitchCleanup?.();
    this.creator.previewPitchCleanup = null;
    this.creator.previewGuideElementId = null;
    this.creator.previewGuideTrackId = null;
    this.creator.previewBubbleText = '';
    this.creator.previewGuideImageUrl = '';
    this.creator.previewGuideCurrentTime = 0;
    this.creator.previewGuideDuration = 0;
    this.creator.previewGuidePaused = true;
    this.creator.previewOwlImage = 'assets/gifs/owl-corner.gif';
  }

  selectGuideTrack(element: BookElement, track: GuideAudioTrack): void {
    if (element.type !== 'guideDot') return;
    if (this.creator.activePreviewAudio && this.creator.previewGuideTrackId !== track.id) {
      this.stopGuidePreview();
    }
    const wasPreviewingTrack = this.creator.previewGuideTrackId === track.id;
    this.creator.selectedGuideTrackId = track.id;
    this.creator.selectedGuidePinId = null;
    this.creator.placingGuidePin = false;
    const rememberedTime = this.creator.guideTrackSeekTimes[track.id] ?? 0;
    this.creator.previewGuideCurrentTime = wasPreviewingTrack
      ? this.creator.activePreviewAudio?.currentTime ?? this.creator.previewGuideCurrentTime
      : this.creator.clamp(rememberedTime, 0, this.creator.getGuideTrackDuration(track));
    this.creator.previewGuideDuration = track.duration || 0;
    this.creator.previewGuideElementId = element.id;
    this.creator.previewGuideTrackId = track.id;
    this.creator.previewGuidePaused = this.creator.activePreviewAudio?.paused ?? true;
    this.applyCreatorGuideState(element, track, this.creator.previewGuideCurrentTime);
    void this.ensureGuideTrackDuration(track);
  }

  setGuideTrackPitch(element: BookElement, track: GuideAudioTrack, event: Event): void {
    const semitones = Number((event.target as HTMLInputElement).value);
    this.creator.captureHistory();
    track.pitchSemitones = semitones || undefined;
    this.creator.markBookDirty();
    if (this.creator.activePreviewAudio && this.creator.previewGuideTrackId === track.id) {
      this.stopGuidePreview();
      this.startGuideTrackPreview(element, track, this.creator.previewGuideCurrentTime);
    }
  }

  selectGuidePin(element: BookElement, track: GuideAudioTrack, pin: GuideTimelinePin, event?: Event): void {
    event?.stopPropagation();
    this.creator.selectedGuideTrackId = track.id;
    this.creator.selectedGuidePinId = pin.id;
    this.creator.placingGuidePin = false;
    this.seekGuideTrackTo(element, track, pin.time);
  }

  armGuidePinPlacement(element: BookElement): void {
    const track = this.creator.getSelectedGuideTrack(element);
    if (!track) return;
    if (this.creator.activePreviewAudio && !this.creator.activePreviewAudio.paused) {
      this.creator.activePreviewAudio.pause();
    }
    this.creator.placingGuidePin = !this.creator.placingGuidePin;
  }

  deleteSelectedGuidePin(element: BookElement): void {
    const track = this.creator.getSelectedGuideTrack(element);
    const pinIndex = track?.pins.findIndex((pin: GuideTimelinePin) => pin.id === this.creator.selectedGuidePinId) ?? -1;
    if (!track || pinIndex < 0) return;
    this.creator.captureHistory();
    track.pins.splice(pinIndex, 1);
    this.creator.selectedGuidePinId = null;
    this.applyCreatorGuideState(element, track, this.creator.previewGuideCurrentTime);
  }

  adjustSelectedGuidePinTime(element: BookElement, delta: number): void {
    const track = this.creator.getSelectedGuideTrack(element);
    const pin = this.creator.getSelectedGuidePin(element);
    if (!track || !pin) return;
    this.creator.captureHistory();
    pin.time = this.creator.clamp(pin.time + delta, 0, this.creator.getGuideTrackDuration(track));
    this.sortGuidePins(track);
    this.creator.previewGuideCurrentTime = pin.time;
    this.seekGuideTrackTo(element, track, pin.time);
  }

  async onGuidePinImageSelected(blob: Blob | null, element: BookElement): Promise<void> {
    if (!this.creator.book) return;
    const pin = this.creator.getSelectedGuidePin(element);
    if (!pin) return;
    if (!blob) {
      this.creator.captureHistory();
      delete pin.imageSrc;
      this.creator.previewGuideImageUrl = '';
      return;
    }
    const dataUrl = await this.creator.blobToDataUrl(blob);
    const saved = await this.creator.bookLibrary.saveAssetData(this.creator.book.id, 'images', dataUrl, 'guide-pin');
    if (!saved) return;
    this.creator.captureHistory();
    pin.imageSrc = saved.relativePath;
    this.creator.previewGuideImageUrl = saved.assetUrl || this.creator.getCachedAssetUrl(saved.relativePath);
  }

  getGuidePinImageUrl(pin: GuideTimelinePin | null): string {
    return pin?.imageSrc ? this.creator.getCachedAssetUrl(pin.imageSrc) : '';
  }

  prepareGuideTrackSeek(event: Event, element: BookElement, track: GuideAudioTrack): void {
    event.stopPropagation();
    this.selectGuideTrack(element, track);
    void this.ensureGuideTrackDuration(track);
  }

  seekGuideTrack(event: Event, element: BookElement, track: GuideAudioTrack): void {
    event.stopPropagation();
    const input = event.target as HTMLInputElement;
    this.selectGuideTrack(element, track);
    this.seekGuideTrackTo(element, track, Number(input.value));
  }

  startGuideTrackSeekDrag(event: PointerEvent, element: BookElement, track: GuideAudioTrack): void {
    if ((event.target as HTMLElement).closest('.guide-timeline-pin')) return;
    event.preventDefault();
    event.stopPropagation();
    const timeline = event.currentTarget as HTMLElement;
    const rect = timeline.getBoundingClientRect();
    if (!rect.width) return;
    this.selectGuideTrack(element, track);
    void this.ensureGuideTrackDuration(track);
    this.creator.guideTrackSeekDragState = {
      elementId: element.id,
      trackId: track.id,
      left: rect.left,
      width: rect.width,
      duration: this.creator.getGuideTrackDuration(track)
    };
    this.updateGuideTrackSeekFromPointer(event.clientX);
  }

  startGuideTimelinePinDrag(
    event: PointerEvent,
    element: BookElement,
    track: GuideAudioTrack,
    pin: GuideTimelinePin
  ): void {
    event.preventDefault();
    event.stopPropagation();
    const timeline = (event.currentTarget as HTMLElement).closest<HTMLElement>('.guide-track-timeline');
    const rect = timeline?.getBoundingClientRect();
    if (!rect?.width) return;
    this.selectGuidePin(element, track, pin);
    this.creator.activePreviewAudio?.pause();
    this.creator.beginHistoryCapture();
    this.creator.timelinePinDragState = {
      elementId: element.id,
      trackId: track.id,
      pinId: pin.id,
      left: rect.left,
      width: rect.width,
      duration: this.creator.getGuideTrackDuration(track)
    };
    this.updateTimelinePinFromPointer(event.clientX);
  }

  startGuidePagePinDrag(event: PointerEvent, element: BookElement, pin: GuideTimelinePin): void {
    event.preventDefault();
    event.stopPropagation();
    const track = this.creator.getGuideDotTracks(element).find((item: GuideAudioTrack) =>
      item.pins.some((candidate) => candidate.id === pin.id)
    );
    if (!track) return;
    this.selectGuidePin(element, track, pin);
    this.creator.beginHistoryCapture();
    this.creator.pagePinDragState = { elementId: element.id, pinId: pin.id };
    this.updatePagePinFromPointer(event.clientX, event.clientY);
  }

  startGuideTrackPreview(element: BookElement, track: GuideAudioTrack, startTime: number): void {
    if (!this.creator.book) return;
    this.stopGuidePreview();
    const token = ++this.creator.previewToken;
    const audio = new Audio(this.creator.bookLibrary.getAssetUrl(this.creator.book.id, track.src));
    this.creator.activePreviewAudio = audio;
    this.creator.previewGuideTrackId = track.id;
    const semitones = track.pitchSemitones ?? 0;
    if (semitones) {
      void this.creator.guidePitch.connect(audio, semitones).then((cleanup: () => void) => {
        if (this.creator.previewGuideTrackId === track.id) {
          this.creator.previewPitchCleanup = cleanup;
        } else {
          cleanup();
        }
      });
    }
    this.creator.previewGuideElementId = element.id;
    this.creator.previewOwlImage = 'assets/gifs/owl-teaching.gif';
    this.creator.previewGuidePaused = false;
    this.creator.previewGuideDuration = track.duration || 0;
    this.creator.previewGuideCurrentTime = Math.max(0, startTime);
    this.applyCreatorGuideState(element, track, this.creator.previewGuideCurrentTime);

    audio.onloadedmetadata = () => {
      if (token !== this.creator.previewToken) return;
      const duration = this.getUsableAudioDuration(audio);
      if (duration > 0) {
        track.duration = duration;
        this.creator.previewGuideDuration = duration;
        audio.currentTime = this.creator.clamp(startTime, 0, duration);
      }
    };
    audio.ontimeupdate = () => {
      if (token !== this.creator.previewToken) return;
      this.creator.previewGuideCurrentTime = Number.isFinite(audio.currentTime) ? audio.currentTime : 0;
      this.creator.guideTrackSeekTimes[track.id] = this.creator.previewGuideCurrentTime;
      const duration = this.getUsableAudioDuration(audio);
      if (duration > 0) {
        track.duration = duration;
        this.creator.previewGuideDuration = duration;
      }
      this.applyCreatorGuideState(element, track, this.creator.previewGuideCurrentTime);
    };
    audio.onplay = () => {
      if (token === this.creator.previewToken) this.creator.previewGuidePaused = false;
    };
    audio.onpause = () => {
      if (token === this.creator.previewToken && !audio.ended) this.creator.previewGuidePaused = true;
    };
    audio.onended = () => {
      if (token !== this.creator.previewToken) return;
      this.creator.previewGuidePaused = true;
      this.creator.previewGuideCurrentTime = this.creator.previewGuideDuration;
      this.creator.guideTrackSeekTimes[track.id] = this.creator.previewGuideCurrentTime;
    };
    audio.onerror = () => {
      if (token === this.creator.previewToken) this.creator.previewGuidePaused = true;
    };
    void audio.play().catch(() => {
      if (token === this.creator.previewToken) this.creator.previewGuidePaused = true;
    });
  }

  seekGuideTrackTo(element: BookElement, track: GuideAudioTrack, value: number): void {
    const time = this.creator.clamp(Number(value) || 0, 0, this.creator.getGuideTrackDuration(track));
    const isActiveTrack = this.creator.previewGuideTrackId === track.id;
    this.creator.previewGuideCurrentTime = time;
    this.creator.guideTrackSeekTimes[track.id] = time;
    this.creator.previewGuideDuration = this.creator.getGuideTrackDuration(track);
    this.creator.previewGuideElementId = element.id;
    this.creator.previewGuideTrackId = track.id;
    this.creator.previewOwlImage = 'assets/gifs/owl-teaching.gif';
    if (this.creator.activePreviewAudio && isActiveTrack) {
      this.creator.activePreviewAudio.currentTime = time;
    }
    this.applyCreatorGuideState(element, track, time);
  }

  applyCreatorGuideState(element: BookElement, track: GuideAudioTrack, time: number): void {
    const pin = [...(track.pins || [])]
      .sort((a, b) => a.time - b.time)
      .filter((candidate) => candidate.time <= time + 0.01)
      .pop() ?? null;
    this.creator.previewGuideX = pin?.x ?? element.x + (element.width || 0.08) / 2;
    this.creator.previewGuideY = pin?.y ?? element.y + (element.height || 0.08) / 2;
    this.creator.previewBubbleText = pin?.text || '';
    this.creator.previewGuideImageUrl = pin?.imageSrc ? this.creator.getCachedAssetUrl(pin.imageSrc) : '';
  }

  async ensureGuideTrackDuration(track: GuideAudioTrack): Promise<void> {
    if (!this.creator.book || (track.duration || 0) > 0) return;
    const audio = new Audio(this.creator.bookLibrary.getAssetUrl(this.creator.book.id, track.src));
    const duration = await new Promise<number>((resolve) => {
      let resolved = false;
      const finish = (value = 0) => {
        if (resolved) return;
        resolved = true;
        audio.onloadedmetadata = null;
        audio.ondurationchange = null;
        audio.onerror = null;
        resolve(value);
      };
      audio.preload = 'metadata';
      audio.onloadedmetadata = () => {
        const duration = this.getUsableAudioDuration(audio);
        if (duration > 0) {
          finish(duration);
          return;
        }
        this.seekToDiscoverDuration(audio);
      };
      audio.ondurationchange = () => {
        const duration = this.getUsableAudioDuration(audio);
        if (duration > 0) finish(duration);
      };
      audio.onerror = () => finish(0);
      window.setTimeout(() => finish(this.getUsableAudioDuration(audio)), 1500);
      audio.load();
    });
    if (duration > 0) {
      track.duration = duration;
      if (this.creator.selectedGuideTrackId === track.id) {
        this.creator.previewGuideDuration = duration;
      }
      this.creator.markBookDirty?.();
    }
  }

  updateTimelinePinFromPointer(clientX: number): void {
    const drag = this.creator.timelinePinDragState;
    const element = this.creator.selectedElement;
    if (!drag || !element || element.id !== drag.elementId) return;
    const track = this.creator.getGuideDotTracks(element).find((item: GuideAudioTrack) => item.id === drag.trackId);
    const pin = track?.pins.find((item: GuideTimelinePin) => item.id === drag.pinId);
    if (!track || !pin) return;
    const ratio = this.creator.clamp((clientX - drag.left) / drag.width, 0, 1);
    pin.time = ratio * drag.duration;
    this.creator.previewGuideCurrentTime = pin.time;
    if (this.creator.activePreviewAudio && this.creator.previewGuideTrackId === track.id) {
      this.creator.activePreviewAudio.currentTime = pin.time;
    }
    this.applyCreatorGuideState(element, track, pin.time);
  }

  updateGuideTrackSeekFromPointer(clientX: number): void {
    const drag = this.creator.guideTrackSeekDragState;
    const element = this.creator.selectedElement;
    if (!drag || !element || element.id !== drag.elementId) return;
    const track = this.creator.getGuideDotTracks(element).find((item: GuideAudioTrack) => item.id === drag.trackId);
    if (!track) return;
    const duration = this.creator.getGuideTrackDuration(track);
    const safeDuration = duration > 0 ? duration : drag.duration;
    const ratio = this.creator.clamp((clientX - drag.left) / drag.width, 0, 1);
    this.seekGuideTrackTo(element, track, ratio * safeDuration);
  }

  updatePagePinFromPointer(clientX: number, clientY: number): void {
    const drag = this.creator.pagePinDragState;
    const element = this.creator.selectedElement;
    const rect = this.creator.editorCanvas?.nativeElement.getBoundingClientRect();
    if (!drag || !element || element.id !== drag.elementId || !rect?.width || !rect.height) return;
    const pin = this.getOrderedGuidePinById(element, drag.pinId);
    if (!pin) return;
    pin.x = this.creator.clamp((clientX - rect.left) / rect.width, 0, 1);
    pin.y = this.creator.clamp((clientY - rect.top) / rect.height, 0, 1);
    this.creator.previewGuideX = pin.x;
    this.creator.previewGuideY = pin.y;
  }

  scheduleGuidePinDragFrame(): void {
    if (this.creator.guidePinDragFrame) return;
    this.creator.guidePinDragFrame = requestAnimationFrame(() => {
      this.creator.guidePinDragFrame = 0;
      this.applyPendingGuidePinPointer();
    });
  }

  flushGuidePinDragFrame(): void {
    if (this.creator.guidePinDragFrame) {
      cancelAnimationFrame(this.creator.guidePinDragFrame);
      this.creator.guidePinDragFrame = 0;
    }
    this.applyPendingGuidePinPointer();
  }

  applyPendingGuidePinPointer(): void {
    const point = this.creator.pendingGuidePinPointer;
    if (!point) return;
    this.creator.pendingGuidePinPointer = null;
    if (this.creator.guideTrackSeekDragState) {
      this.updateGuideTrackSeekFromPointer(point.x);
    } else if (this.creator.timelinePinDragState) {
      this.updateTimelinePinFromPointer(point.x);
    } else if (this.creator.pagePinDragState) {
      this.updatePagePinFromPointer(point.x, point.y);
    }
  }

  getOrderedGuidePinById(element: BookElement, pinId: string): GuideTimelinePin | null {
    return getOrderedGuidePins(element).find((item) => item.pin.id === pinId)?.pin ?? null;
  }

  sortGuidePins(track: GuideAudioTrack): void {
    track.pins.sort((a, b) => a.time - b.time);
  }

  private getUsableAudioDuration(audio: HTMLAudioElement): number {
    const duration = Number(audio.duration);
    return Number.isFinite(duration) && duration > 0 ? duration : 0;
  }

  private seekToDiscoverDuration(audio: HTMLAudioElement): void {
    try {
      audio.currentTime = Number.MAX_SAFE_INTEGER;
    } catch {
      // Some formats simply do not expose duration metadata until playback.
    }
  }
}
