import {
  BookElement,
  BookPage,
  GuideAudioTrack,
  GuideTimelinePin,
  InteractiveBook
} from './book.model';

export interface OrderedGuidePin {
  track: GuideAudioTrack;
  trackIndex: number;
  pin: GuideTimelinePin;
  pinIndex: number;
  sequence: number;
}

export function getGuideTracks(element: BookElement | null | undefined): GuideAudioTrack[] {
  if (!element || element.type !== 'guideDot') return [];
  return Array.isArray(element.data?.['guideTracks'])
    ? element.data['guideTracks'] as GuideAudioTrack[]
    : [];
}

export function syncLegacyGuideAudioFiles(element: BookElement): void {
  if (element.type !== 'guideDot') return;
  element.data['audioFiles'] = getGuideTracks(element).map((track) => track.src).filter(Boolean);
}

export function normalizeGuideElement(element: BookElement): boolean {
  if (element.type !== 'guideDot') return false;

  let changed = false;
  const legacyAudio = Array.isArray(element.data?.['audioFiles'])
    ? (element.data['audioFiles'] as unknown[]).map(String).filter(Boolean)
    : [];
  let tracks = getGuideTracks(element);

  if (!tracks.length && legacyAudio.length) {
    tracks = legacyAudio.map((src, index) => ({
      id: `${element.id}-track-${index + 1}`,
      src,
      pins: []
    }));
    changed = true;
  }

  const normalizedTracks = tracks
    .filter((track) => !!track && typeof track === 'object' && !!String(track.src || '').trim())
    .map((track, trackIndex) => {
      const pins = Array.isArray(track.pins) ? track.pins : [];
      const normalizedPins = pins
        .filter((pin) => !!pin && typeof pin === 'object')
        .map((pin, pinIndex) => normalizePin(pin, element.id, trackIndex, pinIndex))
        .sort((a, b) => a.time - b.time);
      const duration = Number(track.duration);
      const pitchSemitones = Number(track.pitchSemitones);
      return {
        id: String(track.id || `${element.id}-track-${trackIndex + 1}`),
        src: String(track.src || ''),
        ...(Number.isFinite(duration) && duration > 0 ? { duration } : {}),
        ...(Number.isFinite(pitchSemitones) && pitchSemitones !== 0 ? { pitchSemitones } : {}),
        pins: normalizedPins
      } satisfies GuideAudioTrack;
    });

  if (JSON.stringify(tracks) !== JSON.stringify(normalizedTracks)) {
    changed = true;
  }
  element.data['guideTracks'] = normalizedTracks;
  const mirroredAudio = normalizedTracks.map((track) => track.src);
  if (JSON.stringify(legacyAudio) !== JSON.stringify(mirroredAudio)) {
    changed = true;
  }
  element.data['audioFiles'] = mirroredAudio;
  return changed;
}

export function normalizeBookGuideTimelines(book: InteractiveBook | null | undefined): boolean {
  if (!book) return false;
  let changed = false;
  for (const page of collectPages(book)) {
    for (const element of page.elements || []) {
      changed = normalizeGuideElement(element) || changed;
    }
  }
  return changed;
}

export function getOrderedGuidePins(element: BookElement | null | undefined): OrderedGuidePin[] {
  const ordered: OrderedGuidePin[] = [];
  for (const [trackIndex, track] of getGuideTracks(element).entries()) {
    const pins = [...(track.pins || [])].sort((a, b) => a.time - b.time);
    for (const [pinIndex, pin] of pins.entries()) {
      ordered.push({ track, trackIndex, pin, pinIndex, sequence: ordered.length + 1 });
    }
  }
  return ordered;
}

function normalizePin(
  pin: GuideTimelinePin,
  elementId: string,
  trackIndex: number,
  pinIndex: number
): GuideTimelinePin {
  return {
    id: String(pin.id || `${elementId}-pin-${trackIndex + 1}-${pinIndex + 1}`),
    time: Math.max(0, finiteNumber(pin.time, 0)),
    x: clamp(finiteNumber(pin.x, 0.5), 0, 1),
    y: clamp(finiteNumber(pin.y, 0.5), 0, 1),
    text: String(pin.text || ''),
    ...(pin.imageSrc ? { imageSrc: String(pin.imageSrc) } : {})
  };
}

function collectPages(book: InteractiveBook): BookPage[] {
  const pages = [...(book.pages || [])];
  for (const workbook of book.workbooks || []) {
    pages.push(...(workbook.pages || []));
  }
  return pages;
}

function finiteNumber(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
