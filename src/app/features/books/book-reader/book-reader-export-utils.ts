import { BookSpeakingAttempt } from '../../../core/book.model';

export function getAudioExtension(mimeType: string | undefined): string {
  const type = String(mimeType || '').toLowerCase();
  if (type.includes('mp4') || type.includes('aac')) return 'm4a';
  if (type.includes('ogg')) return 'ogg';
  if (type.includes('wav')) return 'wav';
  return 'webm';
}

export async function createSpeakingSessionAudioBlob(attempts: BookSpeakingAttempt[]): Promise<Blob | null> {
  const clips: Blob[] = [];
  for (const attempt of attempts) {
    if (attempt.audio) clips.push(attempt.audio);
    if (attempt.responseAudio) clips.push(attempt.responseAudio);
  }
  if (!clips.length) return null;

  const audioContext = new AudioContext();
  try {
    const decoded: AudioBuffer[] = [];
    for (const clip of clips) {
      try {
        const buffer = await clip.arrayBuffer();
        decoded.push(await audioContext.decodeAudioData(buffer.slice(0)));
      } catch {
        // Keep exporting the session report even if one clip cannot be decoded.
      }
    }
    if (!decoded.length) return null;

    const sampleRate = decoded[0].sampleRate || 44100;
    const gapFrames = Math.round(sampleRate * 0.35);
    const totalFrames = decoded.reduce((total, buffer, index) => (
      total + resampledFrameCount(buffer, sampleRate) + (index > 0 ? gapFrames : 0)
    ), 0);
    const combined = audioContext.createBuffer(1, totalFrames, sampleRate);
    const output = combined.getChannelData(0);
    let offset = 0;

    for (const [index, buffer] of decoded.entries()) {
      if (index > 0) offset += gapFrames;
      const mono = audioBufferToMono(buffer);
      if (buffer.sampleRate === sampleRate) {
        output.set(mono.subarray(0, Math.min(mono.length, output.length - offset)), offset);
        offset += mono.length;
      } else {
        offset += writeResampledAudio(mono, buffer.sampleRate, output, offset, sampleRate);
      }
    }

    return encodeWavBlob(output, sampleRate);
  } finally {
    void audioContext.close();
  }
}

function audioBufferToMono(buffer: AudioBuffer): Float32Array {
  const mono = new Float32Array(buffer.length);
  for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
    const data = buffer.getChannelData(channel);
    for (let index = 0; index < data.length; index++) {
      mono[index] += data[index] / buffer.numberOfChannels;
    }
  }
  return mono;
}

function resampledFrameCount(buffer: AudioBuffer, targetSampleRate: number): number {
  return buffer.sampleRate === targetSampleRate
    ? buffer.length
    : Math.ceil(buffer.length * targetSampleRate / buffer.sampleRate);
}

function writeResampledAudio(
  source: Float32Array,
  sourceSampleRate: number,
  target: Float32Array,
  offset: number,
  targetSampleRate: number
): number {
  const frameCount = Math.min(Math.ceil(source.length * targetSampleRate / sourceSampleRate), target.length - offset);
  const ratio = sourceSampleRate / targetSampleRate;
  for (let index = 0; index < frameCount; index++) {
    const sourceIndex = index * ratio;
    const left = Math.floor(sourceIndex);
    const right = Math.min(left + 1, source.length - 1);
    const amount = sourceIndex - left;
    target[offset + index] = source[left] * (1 - amount) + source[right] * amount;
  }
  return frameCount;
}

function encodeWavBlob(samples: Float32Array, sampleRate: number): Blob {
  const bytesPerSample = 2;
  const headerBytes = 44;
  const buffer = new ArrayBuffer(headerBytes + samples.length * bytesPerSample);
  const view = new DataView(buffer);
  writeAscii(view, 0, 'RIFF');
  view.setUint32(4, 36 + samples.length * bytesPerSample, true);
  writeAscii(view, 8, 'WAVE');
  writeAscii(view, 12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * bytesPerSample, true);
  view.setUint16(32, bytesPerSample, true);
  view.setUint16(34, 8 * bytesPerSample, true);
  writeAscii(view, 36, 'data');
  view.setUint32(40, samples.length * bytesPerSample, true);

  let offset = headerBytes;
  for (const sample of samples) {
    const clamped = Math.max(-1, Math.min(1, sample));
    view.setInt16(offset, clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff, true);
    offset += bytesPerSample;
  }
  return new Blob([buffer], { type: 'audio/wav' });
}

function writeAscii(view: DataView, offset: number, value: string): void {
  for (let index = 0; index < value.length; index++) {
    view.setUint8(offset + index, value.charCodeAt(index));
  }
}

export async function createZipBlob(entries: { name: string; data: Blob | string }[]): Promise<Blob> {
  const encoder = new TextEncoder();
  const localParts: BlobPart[] = [];
  const centralParts: BlobPart[] = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBytes = encoder.encode(sanitizeZipEntryName(entry.name));
    const data = typeof entry.data === 'string'
      ? encoder.encode(entry.data)
      : new Uint8Array(await entry.data.arrayBuffer());
    const crc = getCrc32(data);
    const { dosTime, dosDate } = getZipTimestamp(new Date());

    const localHeader = new Uint8Array(30 + nameBytes.length);
    const localView = new DataView(localHeader.buffer);
    localView.setUint32(0, 0x04034b50, true);
    localView.setUint16(4, 20, true);
    localView.setUint16(6, 0, true);
    localView.setUint16(8, 0, true);
    localView.setUint16(10, dosTime, true);
    localView.setUint16(12, dosDate, true);
    localView.setUint32(14, crc, true);
    localView.setUint32(18, data.byteLength, true);
    localView.setUint32(22, data.byteLength, true);
    localView.setUint16(26, nameBytes.length, true);
    localHeader.set(nameBytes, 30);
    localParts.push(localHeader, data);

    const centralHeader = new Uint8Array(46 + nameBytes.length);
    const centralView = new DataView(centralHeader.buffer);
    centralView.setUint32(0, 0x02014b50, true);
    centralView.setUint16(4, 20, true);
    centralView.setUint16(6, 20, true);
    centralView.setUint16(8, 0, true);
    centralView.setUint16(10, 0, true);
    centralView.setUint16(12, dosTime, true);
    centralView.setUint16(14, dosDate, true);
    centralView.setUint32(16, crc, true);
    centralView.setUint32(20, data.byteLength, true);
    centralView.setUint32(24, data.byteLength, true);
    centralView.setUint16(28, nameBytes.length, true);
    centralView.setUint32(42, offset, true);
    centralHeader.set(nameBytes, 46);
    centralParts.push(centralHeader);

    offset += localHeader.byteLength + data.byteLength;
  }

  const centralOffset = offset;
  const centralSize = centralParts.reduce((total, part) => total + (part as Uint8Array).byteLength, 0);
  const endRecord = new Uint8Array(22);
  const endView = new DataView(endRecord.buffer);
  endView.setUint32(0, 0x06054b50, true);
  endView.setUint16(8, entries.length, true);
  endView.setUint16(10, entries.length, true);
  endView.setUint32(12, centralSize, true);
  endView.setUint32(16, centralOffset, true);

  return new Blob([...localParts, ...centralParts, endRecord], { type: 'application/zip' });
}

function sanitizeZipEntryName(name: string): string {
  return String(name || 'file')
    .replace(/\\/g, '/')
    .replace(/^\/+/, '')
    .replace(/\.\.\//g, '')
    || 'file';
}

function getZipTimestamp(date: Date): { dosTime: number; dosDate: number } {
  const year = Math.max(1980, date.getFullYear());
  const dosTime = (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2);
  const dosDate = ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  return { dosTime, dosDate };
}

function getCrc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

export function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
