// The slide of a cup across the table, made here instead of from a clip so it always lasts exactly
// as long as the swap, whichever speed the teacher chose: a soft sweep of noise, then a light tap
// as the cup lands.
const SLIDE_VOLUME = 0.55;
const TAP_VOLUME = 0.3;
const TAP_SECONDS = 0.07;

export class CupSlideSound {
  private context: AudioContext | null = null;
  private noise: AudioBuffer | null = null;

  /** Call from the teacher's press: browsers only allow sound to start after one. */
  unlock(): void {
    if (typeof AudioContext === 'undefined') return;
    this.context ??= new AudioContext();
    this.context.resume().catch(e => console.debug('Sound error:', e));
  }

  play(seconds: number): void {
    if (this.context) this.schedule(this.context, seconds);
  }

  schedule(context: BaseAudioContext, seconds: number): void {
    const start = context.currentTime;
    const end = start + seconds;

    const source = context.createBufferSource();
    source.buffer = this.noiseFor(context);
    source.loop = true;
    const filter = context.createBiquadFilter();
    filter.type = 'bandpass';
    filter.Q.value = 0.8;
    filter.frequency.setValueAtTime(500, start);
    filter.frequency.linearRampToValueAtTime(1400, start + seconds * 0.5);
    filter.frequency.linearRampToValueAtTime(600, end);
    const slide = context.createGain();
    slide.gain.setValueAtTime(0.0001, start);
    slide.gain.linearRampToValueAtTime(SLIDE_VOLUME, start + seconds * 0.35);
    slide.gain.linearRampToValueAtTime(0.0001, end);
    source.connect(filter).connect(slide).connect(context.destination);
    source.start(start);
    source.stop(end);

    const tap = context.createOscillator();
    tap.frequency.setValueAtTime(190, end - TAP_SECONDS);
    tap.frequency.exponentialRampToValueAtTime(90, end);
    const tapGain = context.createGain();
    tapGain.gain.setValueAtTime(TAP_VOLUME, end - TAP_SECONDS);
    tapGain.gain.exponentialRampToValueAtTime(0.0001, end);
    tap.connect(tapGain).connect(context.destination);
    tap.start(end - TAP_SECONDS);
    tap.stop(end);
  }

  dispose(): void {
    this.context?.close().catch(e => console.debug('Sound error:', e));
    this.context = null;
    this.noise = null;
  }

  private noiseFor(context: BaseAudioContext): AudioBuffer {
    if (this.noise?.sampleRate === context.sampleRate) return this.noise;
    const buffer = context.createBuffer(1, context.sampleRate, context.sampleRate);
    const samples = buffer.getChannelData(0);
    for (let i = 0; i < samples.length; i++) samples[i] = Math.random() * 2 - 1;
    this.noise = buffer;
    return buffer;
  }
}
