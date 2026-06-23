import { Injectable } from '@angular/core';
import { SoundTouchNode } from '@soundtouchjs/audio-worklet';

const PROCESSOR_URL = 'assets/soundtouch/soundtouch-processor.js';

@Injectable({ providedIn: 'root' })
export class GuidePitchService {
  private context: AudioContext | null = null;
  private registrationPromise: Promise<void> | null = null;

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
    if (!pitchSemitones) return () => {};

    try {
      const ctx = this.getContext();
      await this.ensureRegistered(ctx);
      await ctx.resume();

      const source = ctx.createMediaElementSource(audio);
      const node = new SoundTouchNode({ context: ctx });
      node.pitchSemitones.value = pitchSemitones;
      node.playbackRate.value = playbackRate;

      source.connect(node);
      node.connect(ctx.destination);

      return () => {
        try { source.disconnect(); } catch { /* already disconnected */ }
        try { node.disconnect(); } catch { /* already disconnected */ }
      };
    } catch {
      return () => {};
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

  private ensureRegistered(ctx: AudioContext): Promise<void> {
    if (!this.registrationPromise) {
      this.registrationPromise = SoundTouchNode.register(ctx, PROCESSOR_URL).catch(() => {
        this.registrationPromise = null;
      });
    }
    return this.registrationPromise!;
  }
}
