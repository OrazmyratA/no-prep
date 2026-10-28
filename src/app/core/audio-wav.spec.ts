import { unwrapDoubleWav, wavPcm } from './audio-wav';

/** A 16-bit mono WAV around `sound`, with `after` (like Gemini's C2PA chunk) behind the sound. */
function wav(sound: Uint8Array, sampleRate: number, after = new Uint8Array(0)): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(44 + sound.length + after.length);
  const view = new DataView(bytes.buffer);
  const ascii = (at: number, text: string) => [...text].forEach((c, i) => (bytes[at + i] = c.charCodeAt(0)));
  ascii(0, 'RIFF'); view.setUint32(4, 36 + sound.length + after.length, true); ascii(8, 'WAVE');
  ascii(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true); view.setUint32(28, sampleRate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
  ascii(36, 'data'); view.setUint32(40, sound.length, true);
  bytes.set(sound, 44);
  bytes.set(after, 44 + sound.length);
  return bytes;
}

describe('audio-wav', () => {
  // jsdom's Blob has no arrayBuffer() (browsers and Electron do).
  beforeAll(() => {
    if (typeof Blob.prototype.arrayBuffer === 'function') return;
    Blob.prototype.arrayBuffer = function (this: Blob) {
      return new Promise<ArrayBuffer>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as ArrayBuffer);
        reader.onerror = () => reject(reader.error);
        reader.readAsArrayBuffer(this);
      });
    };
  });

  const sound = new Uint8Array([1, 0, 2, 0, 3, 0]);
  const c2pa = new TextEncoder().encode('C2PA\u0004\u0000\u0000\u0000jumb');

  it('reads only the sound of a WAV file, without what follows it', () => {
    const found = wavPcm(wav(sound, 24000, c2pa))!;
    expect([...found.pcm]).toEqual([...sound]);
    expect(found.sampleRate).toBe(24000);
    expect(wavPcm(sound)).toBeNull();
  });

  it('repairs a Gemini clip saved inside a second WAV header', async () => {
    const saved = new Blob([wav(wav(sound, 24000, c2pa), 24000)], { type: 'audio/wav' });
    const clean = (await unwrapDoubleWav(saved))!;
    const bytes = new Uint8Array(await clean.arrayBuffer());
    expect(bytes.length).toBe(44 + sound.length);
    expect([...bytes.subarray(44)]).toEqual([...sound]);
  });

  it('leaves a normal clip alone', async () => {
    expect(await unwrapDoubleWav(new Blob([wav(sound, 24000)]))).toBeNull();
  });
});
