import { Injectable, NgZone } from '@angular/core';
import { BehaviorSubject } from 'rxjs';

declare const window: any;

/** A PowerPoint presentation in the teacher's library (desktop only; PowerPoint plays and edits it). */
export interface PresentationItem {
  id: string;
  title: string;
  fileName: string;
  slideCount: number;
  createdAt: string;
  updatedAt: string;
  thumbVersion: number;
}

/** The stage the slideshow is placed over, in page pixels. */
export interface StageRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type PointerTool = 'arrow' | 'pen' | 'laser' | 'eraser';

type Result<T> = { ok: true; result: T } | { ok: false; error: string; message?: string };

@Injectable({ providedIn: 'root' })
export class PresentationService {
  readonly items$ = new BehaviorSubject<PresentationItem[]>([]);
  /** Presentations open in PowerPoint for editing right now. */
  readonly editing$ = new BehaviorSubject<Set<string>>(new Set());
  private readonly thumbs = new Map<string, string | null>();
  private available: boolean | null = null;
  private listening = false;

  constructor(private zone: NgZone) {}

  private get api(): any {
    return window?.electronAPI?.presentations ?? null;
  }

  /** The desktop app (Presentations need PowerPoint on Windows, through the desktop app). */
  get isDesktop(): boolean {
    return !!this.api;
  }

  /** Whether Microsoft PowerPoint is installed. */
  async isPowerPointAvailable(): Promise<boolean> {
    if (!this.api) return false;
    if (this.available === null) {
      const response: Result<{ available: boolean }> = await this.api.status();
      this.available = response.ok && response.result.available;
    }
    return this.available;
  }

  async refresh(): Promise<void> {
    if (!this.api) return;
    this.listen();
    const response: Result<{ items: PresentationItem[]; editing: string[] }> = await this.api.list();
    if (!response.ok) return;
    this.zone.run(() => {
      this.items$.next(response.result.items);
      this.editing$.next(new Set(response.result.editing));
    });
  }

  private listen(): void {
    if (this.listening || !this.api) return;
    this.listening = true;
    this.api.onChanged(() => void this.refresh());
  }

  /**
   * Picks .ppt/.pptx files and adds copies of them. `busy`: PowerPoint was waiting on one of its
   * question boxes, so the new cards get their picture and slide count a little later.
   */
  async importFiles(): Promise<{ added: number; failed: string[]; canceled: boolean; busy: boolean }> {
    const response: Result<{ added: PresentationItem[]; failed: string[]; canceled?: boolean; busy?: boolean }> = await this.api.importFiles();
    await this.refresh();
    if (!response.ok) return { added: 0, failed: [response.message || response.error], canceled: false, busy: false };
    return { added: response.result.added.length, failed: response.result.failed, canceled: !!response.result.canceled, busy: !!response.result.busy };
  }

  /** A new presentation, opened in PowerPoint to be made. */
  async createBlank(title: string): Promise<boolean> {
    const response: Result<unknown> = await this.api.createBlank(title);
    await this.refresh();
    return response.ok;
  }

  async rename(id: string, title: string): Promise<void> {
    await this.api.rename(id, title);
    await this.refresh();
  }

  async remove(id: string): Promise<boolean> {
    const response: Result<unknown> = await this.api.remove(id);
    this.thumbs.delete(id);
    await this.refresh();
    return response.ok;
  }

  /**
   * Opens it in PowerPoint; the card's picture updates when the teacher closes it there.
   * Returns null when it worked, else the reason (e.g. POWERPOINT_BUSY).
   */
  async edit(id: string): Promise<string | null> {
    const response: Result<unknown> = await this.api.edit(id);
    await this.refresh();
    return response.ok ? null : response.error;
  }

  /**
   * Closes it in PowerPoint after editing, so it can play in No-Prep. Returns null when it worked,
   * else the reason: PRESENTATION_UNSAVED (PowerPoint is brought forward to save) or POWERPOINT_BUSY.
   */
  async release(id: string): Promise<string | null> {
    const response: Result<unknown> = await this.api.release(id);
    await this.refresh();
    return response.ok ? null : response.error;
  }

  /** The first slide's picture (cached per version). */
  async thumbnail(item: PresentationItem): Promise<string | null> {
    const key = `${item.id}:${item.thumbVersion}`;
    if (this.thumbs.has(key)) return this.thumbs.get(key) ?? null;
    const response: Result<{ dataUrl: string | null }> = await this.api.thumbnail(item.id);
    const url = response.ok ? response.result.dataUrl : null;
    this.thumbs.set(key, url);
    return url;
  }

  // ---------- The player ----------

  play(id: string, rect: StageRect, slide = 1): Promise<Result<{ slides: number; slide: number }>> {
    return this.api.play(id, rect, slide);
  }

  move(rect: StageRect): Promise<unknown> {
    return this.api.move(rect);
  }

  command(command: 'next' | 'prev' | 'goto' | 'hide' | 'show', slide = 0): Promise<unknown> {
    return this.api.command(command, slide);
  }

  async state(): Promise<{ running: boolean; slide?: number; slides?: number }> {
    const response: Result<{ running: boolean; slide?: number; slides?: number }> = await this.api.state();
    return response.ok ? response.result : { running: false };
  }

  async snapshot(width: number): Promise<string | null> {
    const response: Result<{ dataUrl: string | null }> = await this.api.snapshot(width);
    return response.ok ? response.result.dataUrl : null;
  }

  /** Small pictures of every slide of the playing presentation (null where one failed). */
  /** Pictures of slides from..to of the playing presentation (and how many slides it has). */
  async slidePictures(from: number, to: number): Promise<{ slides: number; pictures: (string | null)[] }> {
    const response: Result<{ slides: number; pictures: (string | null)[] }> = await this.api.slidePictures(from, to);
    return response.ok ? response.result : { slides: 0, pictures: [] };
  }

  /** The teacher's drawing tool on the slide ('clear' wipes this slide's drawings). */
  pointer(tool: PointerTool | 'clear'): Promise<unknown> {
    return this.api.command('pointer', 0, tool);
  }

  /** Gets PowerPoint ready in the background (the Presentations tab was opened). */
  warm(): void {
    void this.api?.warm?.();
  }

  stop(): Promise<unknown> {
    return this.api?.stop() ?? Promise.resolve();
  }
}
