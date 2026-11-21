import { CUT_SAMPLE_RATE, audioPeaks, cutSamples } from './audio-wav';

describe('cutting a part of a recording', () => {
  // 10 seconds at 8 kHz where every sample holds its own second (0, 1, 2, ...) as a value / 10.
  const rate = 8000;
  const samples = new Float32Array(rate * 10).map((_, index) => Math.floor(index / rate) / 10);

  it('keeps only the chosen part, at the saved rate', () => {
    const part = cutSamples(samples, rate, 3, 5);
    expect(part.length).toBe(2 * CUT_SAMPLE_RATE);
    // The middle of the part is from seconds 3 and 4, nothing from before or after.
    expect(part[Math.floor(part.length * 0.25)]).toBeCloseTo(0.3, 5);
    expect(part[Math.floor(part.length * 0.75)]).toBeCloseTo(0.4, 5);
  });

  it('fades in and out so the cut never clicks', () => {
    const part = cutSamples(samples, rate, 3, 5);
    expect(part[0]).toBe(0);
    expect(Math.abs(part[part.length - 1])).toBeLessThan(0.01);
  });

  it('accepts flags the wrong way round and outside the recording', () => {
    expect(cutSamples(samples, rate, 5, 3).length).toBe(2 * CUT_SAMPLE_RATE);
    expect(cutSamples(samples, rate, 9, 30).length).toBe(1 * CUT_SAMPLE_RATE);
    expect(cutSamples(samples, rate, 4, 4).length).toBe(0);
  });

  it('draws loudness bars scaled to the loudest', () => {
    const peaks = audioPeaks(samples, 10);
    expect(peaks.length).toBe(10);
    expect(peaks[9]).toBe(1);
    expect(peaks[0]).toBe(0);
    expect(peaks[4]).toBeCloseTo(4 / 9, 5);
  });
});
