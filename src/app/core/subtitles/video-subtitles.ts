import { Injectable, NgZone } from '@angular/core';
import Dexie, { Table } from 'dexie';
import { BehaviorSubject } from 'rxjs';

import { Coverage, PIECE_SECONDS, SubtitleLine, mergeLines, takePiece } from './subtitle-lines';
import type { RawSegment, SubtitleWorkerReply } from './subtitle-worker-messages';

export type SubtitlePhase = 'idle' | 'downloading' | 'listening' | 'done' | 'error';

export interface SubtitleState {
  phase: SubtitlePhase;
  /** 0–1 while the speech model downloads (first time only). */
  progress: number;
}

interface StoredSubtitles {
  key: string;
  lines: SubtitleLine[];
  ranges: [number, number][];
  duration: number;
  updatedAt: number;
}

/** Subtitles made on this computer, per video, so the next lesson shows them at once. */
class SubtitleDb extends Dexie {
  videos!: Table<StoredSubtitles, string>;
  constructor() {
    super('noprep-subtitles');
    this.version(1).stores({ videos: 'key' });
  }
}

/** The video's sound as Whisper wants it: one channel, 16 000 samples a second. */
async function readSound(url: string): Promise<Float32Array> {
  const data = await (await fetch(url)).arrayBuffer();
  const context = new AudioContext();
  let decoded: AudioBuffer;
  try {
    decoded = await context.decodeAudioData(data);
  } finally {
    void context.close();
  }
  const offline = new OfflineAudioContext(1, Math.max(1, Math.ceil(decoded.duration * 16000)), 16000);
  const source = offline.createBufferSource();
  source.buffer = decoded;
  source.connect(offline.destination);
  source.start();
  return (await offline.startRendering()).getChannelData(0);
}

/**
 * One video's subtitles: made piece by piece, ahead of where the video is playing. Lines arrive
 * on lines$; the playhead (setPlayhead) decides which piece comes next.
 */
export class SubtitleSession {
  readonly lines$ = new BehaviorSubject<SubtitleLine[]>([]);
  readonly state$ = new BehaviorSubject<SubtitleState>({ phase: 'idle', progress: 0 });
  private coverage = new Coverage();
  private sound: Float32Array | null = null;
  private duration = 0;
  private playhead = 0;
  private running = false;
  private disposed = false;

  constructor(private service: VideoSubtitlesService, readonly key: string, private url: string, private language: string) {}

  get lines(): SubtitleLine[] {
    return this.lines$.value;
  }

  /** Lines saved earlier for this video (no model needed to show them). */
  async restore(): Promise<boolean> {
    const stored = await this.service.db.videos.get(this.key).catch(() => undefined);
    if (!stored) return false;
    this.coverage = new Coverage(stored.ranges);
    this.duration = stored.duration;
    this.lines$.next(stored.lines);
    if (this.coverage.nextStart(0, stored.duration) === null) this.setState('done');
    return true;
  }

  setPlayhead(time: number): void {
    this.playhead = Math.max(0, time);
  }

  /** Starts (or carries on) making the lines; safe to call again. */
  async start(): Promise<void> {
    if (this.running || this.disposed || this.state$.value.phase === 'done') return;
    this.running = true;
    try {
      if (!(await this.service.modelDownloaded())) {
        this.setState('downloading', 0);
        await this.service.loadModel((progress) => this.setState('downloading', progress));
      }
      this.setState('listening');
      this.sound ??= await readSound(this.url);
      this.duration = this.sound.length / 16000;
      await this.work();
    } catch (error) {
      console.warn('Subtitles stopped:', error);
      if (!this.disposed) this.setState('error');
    } finally {
      this.running = false;
    }
  }

  private async work(): Promise<void> {
    const sound = this.sound!;
    while (!this.disposed) {
      // Carry on from what is playing now; a jump ahead starts there, the gap is filled later.
      const from = this.coverage.covers(this.playhead) ? this.playhead : Math.max(0, this.playhead - 0.5);
      const pieceStart = this.coverage.nextStart(from, this.duration);
      if (pieceStart === null) {
        this.setState('done');
        await this.save();
        return;
      }
      const length = Math.min(PIECE_SECONDS, this.duration - pieceStart);
      const startSample = Math.floor(pieceStart * 16000);
      const piece = sound.slice(startSample, startSample + Math.ceil(length * 16000));
      const segments = await this.service.transcribe(piece, this.language);
      if (this.disposed) return;
      const isLast = pieceStart + length >= this.duration - 0.25;
      const { lines, next } = takePiece(segments, pieceStart, length, isLast);
      this.coverage.add(pieceStart, isLast ? this.duration : next);
      this.lines$.next(mergeLines(this.lines, lines));
      await this.save();
    }
  }

  private async save(): Promise<void> {
    await this.service.db.videos.put({
      key: this.key,
      lines: this.lines,
      ranges: this.coverage.ranges,
      duration: this.duration,
      updatedAt: Date.now()
    }).catch(() => undefined);
  }

  private setState(phase: SubtitlePhase, progress = 0): void {
    this.service.zone.run(() => this.state$.next({ phase, progress }));
  }

  dispose(): void {
    this.disposed = true;
    this.sound = null;
  }
}

/**
 * Subtitles for book videos, made on this computer by an open speech model (Whisper base, all
 * languages). Nothing leaves the computer; the model (~77 MB) downloads the first time a teacher
 * turns subtitles on, and is kept for next time.
 */
@Injectable({ providedIn: 'root' })
export class VideoSubtitlesService {
  readonly db = new SubtitleDb();
  private worker: Worker | null = null;
  private nextId = 1;
  private waiting = new Map<number, { resolve: (s: RawSegment[]) => void; reject: (e: Error) => void }>();
  private onModelProgress: ((progress: number) => void) | null = null;
  private onModelLoaded: (() => void) | null = null;
  private onModelFailed: ((e: Error) => void) | null = null;
  private downloaded: boolean | null = null;
  private checking: ((downloaded: boolean) => void)[] = [];

  constructor(public zone: NgZone) {}

  open(key: string, url: string, language = 'en'): SubtitleSession {
    return new SubtitleSession(this, key, url, language);
  }

  private get wasmBase(): string {
    return new URL('assets/ort/', document.baseURI).href;
  }

  private ensureWorker(): Worker {
    if (this.worker) return this.worker;
    const worker = new Worker(new URL('./subtitle.worker', import.meta.url), { type: 'module' });
    worker.addEventListener('message', (event: MessageEvent<SubtitleWorkerReply>) => this.handle(event.data));
    worker.addEventListener('error', (event) => this.failAll(new Error(event.message || 'Subtitle worker failed')));
    this.worker = worker;
    return worker;
  }

  private handle(reply: SubtitleWorkerReply): void {
    switch (reply.type) {
      case 'checked':
        this.downloaded = reply.downloaded;
        this.checking.splice(0).forEach((done) => done(reply.downloaded));
        break;
      case 'model-progress':
        if (reply.total > 0) this.onModelProgress?.(reply.loaded / reply.total);
        break;
      case 'loaded':
        this.downloaded = true;
        this.onModelLoaded?.();
        break;
      case 'transcribed':
        this.waiting.get(reply.id)?.resolve(reply.segments);
        this.waiting.delete(reply.id);
        break;
      case 'failed':
        if (reply.id !== undefined && this.waiting.has(reply.id)) {
          this.waiting.get(reply.id)!.reject(new Error(reply.message));
          this.waiting.delete(reply.id);
        } else {
          this.onModelFailed?.(new Error(reply.message));
        }
        break;
    }
  }

  private failAll(error: Error): void {
    this.waiting.forEach(({ reject }) => reject(error));
    this.waiting.clear();
    this.onModelFailed?.(error);
  }

  /** The model is on this computer already (so subtitles can start without asking). */
  modelDownloaded(): Promise<boolean> {
    if (this.downloaded !== null) return Promise.resolve(this.downloaded);
    return new Promise((resolve) => {
      this.checking.push(resolve);
      this.ensureWorker().postMessage({ type: 'check' });
    });
  }

  loadModel(onProgress: (progress: number) => void): Promise<void> {
    return new Promise((resolve, reject) => {
      this.onModelProgress = onProgress;
      this.onModelLoaded = () => resolve();
      this.onModelFailed = reject;
      this.ensureWorker().postMessage({ type: 'load', wasmBase: this.wasmBase });
    });
  }

  transcribe(audio: Float32Array, language: string): Promise<RawSegment[]> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.waiting.set(id, { resolve, reject });
      this.ensureWorker().postMessage({ type: 'transcribe', id, wasmBase: this.wasmBase, audio, language }, [audio.buffer]);
    });
  }
}
