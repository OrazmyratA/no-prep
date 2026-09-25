import { Injectable } from '@angular/core';
import type { SoundTouchNode } from '@soundtouchjs/audio-worklet';

const PROCESSOR_URL = 'assets/soundtouch/soundtouch-processor.js';

export interface GuidePitchConnection {
  /** Disconnects the nodes. */
  cleanup: () => void;
  /** Changes the pitch of the already-playing audio (no restart). No-op if no node was built. */
  setPitch: (semitones: number) => void;
}

@Injectable({ providedIn: 'root' })
export class GuidePitchService {
  private context: AudioContext | null = null;
  private registrationPromise: Promise<void> | null = null;
  // Loaded on first use: the library extends AudioWorkletNode at module-evaluation time and is
  // only ever needed once a pitch-shifted clip actually plays, so it stays out of the books bundle.
  private soundTouchModule: Promise<typeof import('@soundtouchjs/audio-worklet')> | null = null;

  /**
   * Connects an HTMLAudioElement through a SoundTouch pitch-shift node.
   * Returns a cleanup function that disconnects the nodes.
   * Falls back silently to plain playback if AudioWorklet is unsupported.
   */
  async connect(
    audio: HTMLAudioElement,
    pitchSemitones: number,
    playbackRate = 1
  ): Promise<() => void> {
    return (await this.connectControlled(audio, pitchSemitones, playbackRate)).cleanup;
  }

  /**
   * Same as connect(), but also hands back a live pitch setter so a slider can retune audio
   * that is already playing instead of tearing the whole audio graph down on every tick.
   */
  async connectControlled(
    audio: HTMLAudioElement,
    pitchSemitones: number,
    playbackRate = 1
  ): Promise<GuidePitchConnection> {
    const noop: GuidePitchConnection = { cleanup: () => {}, setPitch: () => {} };
    if (!pitchSemitones) return noop;

    let ctx: AudioContext;
    let source: MediaElementAudioSourceNode;
    try {
      ctx = this.getContext();
      source = ctx.createMediaElementSource(audio);
    } catch {
      return noop;
    }

    // createMediaElementSource() permanently reroutes this <audio> element's output
    // into the Web Audio graph — from here on it only makes sound through whatever
    // this node is connected to. Connect straight to the destination immediately so
    // playback is never silent, then upgrade to the pitch-shifted path below if it
    // succeeds; if the worklet fails to load, this direct connection is what's left.
    source.connect(ctx.destination);

    try {
      const { SoundTouchNode: SoundTouch } = await this.loadSoundTouch();
      await this.ensureRegistered(ctx);
      await ctx.resume();

      const node = new SoundTouch({ context: ctx });
      node.pitchSemitones.value = pitchSemitones;
      node.playbackRate.value = playbackRate;

      source.disconnect(ctx.destination);
      source.connect(node);
      node.connect(ctx.destination);

      return {
        cleanup: () => {
          try { source.disconnect(); } catch { /* already disconnected */ }
          try { node.disconnect(); } catch { /* already disconnected */ }
        },
        setPitch: (semitones: number) => this.setPitch(node, semitones)
      };
    } catch {
      return {
        cleanup: () => {
          try { source.disconnect(); } catch { /* already disconnected */ }
        },
        setPitch: () => {}
      };
    }
  }

  /** Updates pitch on the active node returned from connect(). Faster than reconnecting. */
  setPitch(node: SoundTouchNode, semitones: number): void {
    node.pitchSemitones.value = semitones;
  }

  private getContext(): AudioContext {
    if (!this.context || this.context.state === 'closed') {
      this.context = new AudioContext();
      this.registrationPromise = null;
    }
    return this.context;
  }

  private loadSoundTouch(): Promise<typeof import('@soundtouchjs/audio-worklet')> {
    if (!this.soundTouchModule) {
      this.soundTouchModule = import('@soundtouchjs/audio-worklet').catch((error) => {
        this.soundTouchModule = null;
        throw error;
      });
    }
    return this.soundTouchModule;
  }

  private ensureRegistered(ctx: AudioContext): Promise<void> {
    // Assigned synchronously so two concurrent callers share one registration.
    if (!this.registrationPromise) {
      this.registrationPromise = this.loadSoundTouch()
        .then(({ SoundTouchNode: SoundTouch }) => SoundTouch.register(ctx, PROCESSOR_URL))
        .catch(() => {
          this.registrationPromise = null;
        });
    }
    return this.registrationPromise!;
  }
}
