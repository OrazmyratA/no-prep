import { clamp } from './book-reader-geometry';

export class BookReaderVideoController {
  constructor(private readonly reader: any) {}

  closeExpandedElement(): void {
    void this.exitExpandedVideoFullscreen();
    this.reader.expandedElement = null;
  }

  async toggleExpandedVideoFullscreen(event?: Event): Promise<void> {
    event?.preventDefault();
    event?.stopPropagation();
    if (this.reader.videoFullscreen) {
      await this.exitExpandedVideoFullscreen();
      return;
    }

    this.reader.videoFullscreen = true;
    this.reader.forceUiRefresh();
    const frame = this.reader.expandedVideoFrame?.nativeElement as (HTMLElement & {
      webkitRequestFullscreen?: () => Promise<void> | void;
    }) | undefined;
    try {
      if (frame?.requestFullscreen) {
        await frame.requestFullscreen();
      } else {
        await frame?.webkitRequestFullscreen?.();
      }
    } catch {
      // The fixed viewport layout remains as a platform-independent fallback.
    }
  }

  onExpandedVideoPointerUp(event: PointerEvent): void {
    if (!this.isElectronRuntime() || this.reader.videoFullscreen) return;
    const video = this.reader.expandedVideo?.nativeElement;
    if (!video || !this.isPointInVideoFullscreenControl(event, video)) return;

    event.preventDefault();
    event.stopPropagation();
    void this.requestExpandedVideoFullscreen(video);
  }

  onExpandedVideoFullscreenHotspotClick(event: MouseEvent): void {
    if (!this.shouldHandleVideoFullscreenHotspot(event)) return;
    this.requestExpandedVideoFullscreenFromHotspot(event);
  }

  onExpandedVideoFullscreenHotspotPointerDown(event: PointerEvent): void {
    event.preventDefault();
    event.stopPropagation();
  }

  onExpandedVideoFullscreenHotspotPointerUp(event: PointerEvent): void {
    if (!this.shouldHandleVideoFullscreenHotspot(event)) return;
    this.requestExpandedVideoFullscreenFromHotspot(event);
  }

  onExpandedVideoFullscreenChange(): void {
    this.syncExpandedVideoFullscreenState();
  }

  onExpandedVideoWebkitFullscreenChange(): void {
    this.syncExpandedVideoFullscreenState();
  }

  onExpandedNativeVideoFullscreenChange(): void {
    this.syncExpandedVideoFullscreenState();
  }

  onExpandedVideoEscape(): void {
    if (this.reader.videoFullscreen) void this.exitExpandedVideoFullscreen();
  }

  isElectronRuntime(): boolean {
    return !!(window as any)?.electronAPI;
  }

  skipExpandedVideo(seconds: number): void {
    const video = this.reader.expandedVideo?.nativeElement;
    if (!video) return;
    const duration = Number.isFinite(video.duration) ? video.duration : 0;
    const maxTime = duration > 0 ? duration : Number.MAX_SAFE_INTEGER;
    video.currentTime = clamp(video.currentTime + seconds, 0, maxTime);
  }

  private shouldHandleVideoFullscreenHotspot(event: Event): boolean {
    event.preventDefault();
    event.stopPropagation();
    const now = Date.now();
    if (now - this.reader.lastVideoFullscreenHotspotAt < 450) {
      return false;
    }
    this.reader.lastVideoFullscreenHotspotAt = now;
    return true;
  }

  private requestExpandedVideoFullscreenFromHotspot(event: Event): void {
    if (this.reader.videoFullscreen) {
      void this.exitExpandedVideoFullscreen();
      return;
    }
    if (this.isElectronRuntime()) {
      void this.enterElectronVideoFullscreenFallback();
      return;
    }
    const video = this.reader.expandedVideo?.nativeElement;
    if (video) {
      void this.requestExpandedVideoFullscreen(video);
      return;
    }
    void this.toggleExpandedVideoFullscreen(event);
  }

  private async exitExpandedVideoFullscreen(): Promise<void> {
    this.reader.videoFullscreen = false;
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      const webkitDocument = document as Document & {
        webkitFullscreenElement?: Element | null;
        webkitExitFullscreen?: () => Promise<void> | void;
      };
      if (webkitDocument.webkitFullscreenElement) await webkitDocument.webkitExitFullscreen?.();
    } catch {
      // CSS fullscreen has already been removed.
    }
    await this.exitElectronVideoFullscreenFallback();
    this.reader.forceUiRefresh();
  }

  private async requestExpandedVideoFullscreen(video: HTMLVideoElement): Promise<void> {
    const fullscreenVideo = video as HTMLVideoElement & {
      webkitRequestFullscreen?: () => Promise<void> | void;
      webkitEnterFullscreen?: () => void;
    };
    const frame = this.reader.expandedVideoFrame?.nativeElement as (HTMLElement & {
      webkitRequestFullscreen?: () => Promise<void> | void;
    }) | undefined;

    try {
      if (fullscreenVideo.requestFullscreen) {
        await fullscreenVideo.requestFullscreen();
      } else if (fullscreenVideo.webkitRequestFullscreen) {
        await fullscreenVideo.webkitRequestFullscreen();
      } else if (fullscreenVideo.webkitEnterFullscreen) {
        fullscreenVideo.webkitEnterFullscreen();
      } else if (frame?.requestFullscreen) {
        await frame.requestFullscreen();
      } else {
        await frame?.webkitRequestFullscreen?.();
      }
      this.syncExpandedVideoFullscreenState();
      this.ensureElectronVideoFullscreenFallback();
    } catch {
      void this.enterElectronVideoFullscreenFallback();
    }
  }

  private ensureElectronVideoFullscreenFallback(): void {
    if (!this.isElectronRuntime()) return;
    requestAnimationFrame(() => {
      const webkitDocument = document as Document & { webkitFullscreenElement?: Element | null };
      if (document.fullscreenElement || webkitDocument.webkitFullscreenElement) return;
      void this.enterElectronVideoFullscreenFallback();
    });
  }

  private async enterElectronVideoFullscreenFallback(): Promise<void> {
    const api = (window as any)?.electronAPI;
    this.reader.videoFullscreen = true;
    this.reader.forceUiRefresh();
    if (!api?.setAppFullscreen) return;
    try {
      this.reader.electronVideoFullscreenWasActive = typeof api.isAppFullscreen === 'function'
        ? !!(await api.isAppFullscreen())
        : false;
      if (!this.reader.electronVideoFullscreenWasActive) {
        await api.setAppFullscreen(true);
      }
      this.reader.electronVideoFullscreenFallbackActive = true;
    } catch {
      // The fixed viewport video layout remains usable even if the window cannot be promoted.
    }
  }

  private async exitElectronVideoFullscreenFallback(): Promise<void> {
    if (!this.reader.electronVideoFullscreenFallbackActive) return;
    const shouldRestoreWindow = !this.reader.electronVideoFullscreenWasActive;
    this.reader.electronVideoFullscreenFallbackActive = false;
    this.reader.electronVideoFullscreenWasActive = false;
    const api = (window as any)?.electronAPI;
    if (!shouldRestoreWindow || !api?.setAppFullscreen) return;
    try {
      await api.setAppFullscreen(false);
    } catch {
      // Leaving the CSS fullscreen state is still enough to recover the reader layout.
    }
  }

  private isPointInVideoFullscreenControl(event: PointerEvent, video: HTMLVideoElement): boolean {
    const rect = video.getBoundingClientRect();
    if (!rect.width || !rect.height) return false;
    const controlHeight = clamp(rect.height * 0.16, 42, 58);
    const controlWidth = clamp(rect.width * 0.12, 54, 78);
    return event.clientX >= rect.right - controlWidth
      && event.clientX <= rect.right
      && event.clientY >= rect.bottom - controlHeight
      && event.clientY <= rect.bottom;
  }

  private syncExpandedVideoFullscreenState(): void {
    if (this.reader.electronVideoFullscreenFallbackActive) {
      this.reader.videoFullscreen = true;
      this.reader.forceUiRefresh();
      return;
    }
    const webkitDocument = document as Document & { webkitFullscreenElement?: Element | null };
    const fullscreenElement = document.fullscreenElement || webkitDocument.webkitFullscreenElement || null;
    const activeVideo = this.reader.expandedVideo?.nativeElement;
    const activeFrame = this.reader.expandedVideoFrame?.nativeElement;
    this.reader.videoFullscreen = !!fullscreenElement && (
      fullscreenElement === activeVideo ||
      fullscreenElement === activeFrame ||
      !!activeFrame?.contains(fullscreenElement)
    );
    this.reader.forceUiRefresh();
  }
}
