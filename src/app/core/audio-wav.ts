export function encodeWavBlob(samples: Float32Array, sampleRate: number): Blob {
  const bytesPerSample = 2;
  const headerBytes = 44;
  const buffer = new ArrayBuffer(headerBytes + samples.length * bytesPerSample);
  const view = new DataView(buffer);
  writeWavHeader(view, samples.length * bytesPerSample, sampleRate);

  let offset = headerBytes;
  for (const sample of samples) {
    const clamped = Math.max(-1, Math.min(1, sample));
    view.setInt16(offset, clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff, true);
    offset += bytesPerSample;
  }
  return new Blob([buffer], { type: 'audio/wav' });
}

export function audioBufferToMono(buffer: AudioBuffer): Float32Array {
  const mono = new Float32Array(buffer.length);
  for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
    const data = buffer.getChannelData(channel);
    for (let index = 0; index < data.length; index++) {
      mono[index] += data[index] / buffer.numberOfChannels;
    }
  }
  return mono;
}

/** 16-bit mono PCM header. */
function writeWavHeader(view: DataView, dataBytes: number, sampleRate: number): void {
  writeAscii(view, 0, 'RIFF');
  view.setUint32(4, 36 + dataBytes, true);
  writeAscii(view, 8, 'WAVE');
  writeAscii(view, 12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeAscii(view, 36, 'data');
  view.setUint32(40, dataBytes, true);
}

/**
 * The sound inside a WAV file (its "data" chunk only) and its rate, or null when `bytes` is not a
 * WAV file. Chunks after the sound, like the C2PA "made by AI" signature Gemini adds, are left out.
 */
export function wavPcm(bytes: Uint8Array): { pcm: Uint8Array; sampleRate: number } | null {
  const ascii = (at: number) => String.fromCharCode(...bytes.subarray(at, at + 4));
  if (bytes.length < 12 || ascii(0) !== 'RIFF' || ascii(8) !== 'WAVE') return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let sampleRate = 24000;
  for (let at = 12; at + 8 <= bytes.length;) {
    const size = view.getUint32(at + 4, true);
    if (ascii(at) === 'fmt ' && at + 12 <= bytes.length) sampleRate = view.getUint32(at + 12, true);
    if (ascii(at) === 'data') return { pcm: bytes.subarray(at + 8, Math.min(bytes.length, at + 8 + size)), sampleRate };
    at += 8 + size + (size & 1);
  }
  return null;
}

/**
 * A Gemini voice clip saved with a second WAV header around Gemini's own WAV file (before
 * 1.19.0): it played Gemini's header as a click and its C2PA chunk as loud noise at the end.
 * Returns the clean clip, or null when `blob` is not one of those.
 */
export async function unwrapDoubleWav(blob: Blob): Promise<Blob | null> {
  const outer = wavPcm(new Uint8Array(await blob.arrayBuffer()));
  const inner = outer && wavPcm(outer.pcm);
  if (!inner) return null;
  const buffer = new ArrayBuffer(44 + inner.pcm.length);
  writeWavHeader(new DataView(buffer), inner.pcm.length, inner.sampleRate);
  new Uint8Array(buffer, 44).set(inner.pcm);
  return new Blob([buffer], { type: 'audio/wav' });
}

function writeAscii(view: DataView, offset: number, value: string): void {
  for (let index = 0; index < value.length; index++) {
    view.setUint8(offset + index, value.charCodeAt(index));
  }
}

export async function decodeAudioBlobToMonoWav(blob: Blob): Promise<Blob> {
  const audioContext = new AudioContext();
  try {
    const arrayBuffer = await blob.arrayBuffer();
    const decoded = await audioContext.decodeAudioData(arrayBuffer);
    const mono = audioBufferToMono(decoded);
    return encodeWavBlob(mono, decoded.sampleRate);
  } finally {
    void audioContext.close();
  }
}
