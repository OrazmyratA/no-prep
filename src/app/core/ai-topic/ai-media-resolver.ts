import { Injectable } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import imageCompression from 'browser-image-compression';
import { PixabayImage, PixabaySearchOptions, PixabayService } from '../pixabay';
import { AudioVoiceService, VOICE_LANGUAGES } from '../audio-voice';
import { renderTextImage } from '../../shared/text-image';
import { AiCropBox, AiItemDraft } from './ai-topic-draft';
import { AiTopicProviderId, AiTopicService } from './ai-topic.service';

// Same output as the image uploader's defaults, so AI images look and weigh like hand-picked ones.
const ITEM_IMAGE_MAX_MB = 0.2;
const ITEM_IMAGE_MAX_SIDE = 800;
// Same size and default colour as the image uploader's text image.
const WORD_CARD_WIDTH = 640;
const WORD_CARD_HEIGHT = 360;
const WORD_CARD_BACKGROUND = '#1d4ed8';
// Save stays disabled while media loads, so one stuck request must not block it for good.
const MEDIA_TIMEOUT_MS = 20000;
// Search results kept per item for "another picture" — split between the AI's preferred style
// (shown first, so the initial pick still honours its judgment) and a flat cartoon/vector pool
// (Pixabay's own 'vector' category — distinct from 'illustration', which can be painterly/3D),
// always fetched too so a cartoon alternative is reliably there to cycle to, not just hoped for.
const SEARCH_RESULTS = 6;
const STYLE_SEARCH_RESULTS = 4;
const VECTOR_SEARCH_RESULTS = 3;
const WORD_CARD_INDEX = -1;
const PAGE_CROP_INDEX = -2;
const GENERATED_INDEX = -3;
// The AI's crop box is approximate, not pixel-perfect — pad it a little so a slightly-off box
// still captures the whole picture instead of clipping an edge.
const CROP_PADDING = 0.06;
// Below this, cropping from the source photo would upscale a handful of pixels into mush.
const MIN_CROP_SOURCE_PX = 32;

interface PageCropSource {
  blob: Blob;
  box: AiCropBox;
}

/** An AI item's picture options: an optional page crop, search results, a generated image, a word card. */
export interface AiImageChoice {
  query: string;
  style: 'photo' | 'illustration';
  cardText: string;
  cardBackground: string;           // word card colour (Writing Workshop paragraphs get their own)
  pageCrop: PageCropSource | null;  // set only when the AI found the picture on an attached page
  hits: PixabayImage[] | null;      // null = not searched yet
  generated: Blob | null;           // set once "Generate a picture" has been used, then cached
  index: number;                    // shown search result, or one of the *_INDEX sentinels above
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | null> {
  return new Promise(resolve => {
    const timer = setTimeout(() => resolve(null), ms);
    promise.then(
      value => { clearTimeout(timer); resolve(value); },
      () => { clearTimeout(timer); resolve(null); }
    );
  });
}

@Injectable({ providedIn: 'root' })
export class AiMediaResolverService {
  constructor(private pixabay: PixabayService, private voice: AudioVoiceService, private aiTopic: AiTopicService) {}

  get canMakeAudio(): boolean {
    return this.voice.canSynthesize;
  }

  /**
   * Draws a fresh AI picture for this item, on explicit teacher request only — never called
   * automatically, since unlike a page crop or a Pixabay search it costs real money per call
   * (see ai-topic-generation design notes). Caches the result on `choice` so cycling back to it
   * with "another picture" afterwards is free; calling this again always generates a new one.
   */
  async generateImage(choice: AiImageChoice, provider: AiTopicProviderId): Promise<Blob | null> {
    const subject = choice.cardText || choice.query;
    if (!subject) return null;
    const styleHint = choice.style === 'illustration'
      ? 'a simple, friendly illustration, plain background'
      : 'a clear, realistic photo, plain background';
    const prompt = `${styleHint}, showing: ${subject}. Suitable for a school flashcard, no text or watermark.`;
    try {
      const raw = await this.aiTopic.generateImage(provider, prompt);
      const blob = await this.compressItemImage(raw, 'ai-generated.png');
      choice.generated = blob;
      choice.index = GENERATED_INDEX;
      return blob;
    } catch (error) {
      console.debug('AI topic: image generation failed:', error);
      return null;
    }
  }

  /**
   * Finds, crops or draws the item's picture. `pages` are the book-page photos the teacher
   * attached (same order as `imagePage` refers to); pass [] when there were none. A failed page
   * crop or search falls back down the chain to a word card. The returned choice remembers the
   * other options so `nextImage` can offer "another picture" and `generateImage` can cache a
   * generated one alongside them. `cardBackground` colours the word card (default blue).
   */
  async resolveImage(
    item: AiItemDraft,
    pages: Blob[] = [],
    cardBackground = WORD_CARD_BACKGROUND
  ): Promise<{ blob: Blob | null; choice: AiImageChoice | null }> {
    if (item.imageKind === 'none') return { blob: null, choice: null };
    const cardText = item.imageKind === 'wordCard' ? item.imageQuery : item.text;
    const pageCrop: PageCropSource | null =
      item.imageKind === 'pageCrop' && item.imagePage >= 0 && item.imagePage < pages.length
        ? { blob: pages[item.imagePage], box: item.imageCrop }
        : null;
    const choice: AiImageChoice = {
      query: item.imageKind === 'wordCard' ? cardText : item.imageQuery,
      style: item.imageStyle,
      cardText,
      cardBackground,
      pageCrop,
      hits: null,
      generated: null,
      index: WORD_CARD_INDEX
    };
    if (pageCrop) {
      const cropped = await this.cropPageImage(pageCrop.blob, pageCrop.box);
      if (cropped) {
        choice.index = PAGE_CROP_INDEX;
        return { blob: cropped, choice };
      }
    }
    if ((item.imageKind === 'search' || item.imageKind === 'pageCrop') && choice.query) {
      choice.hits = await this.searchHits(choice);
      for (let i = 0; i < choice.hits.length; i++) {
        const photo = await this.downloadHit(choice.hits[i]);
        if (photo) {
          choice.index = i;
          return { blob: photo, choice };
        }
      }
    }
    return { blob: cardText ? await this.renderWordCard(cardText, cardBackground) : null, choice };
  }

  /**
   * The next picture for an item: page crop, remaining search results, a cached generated image,
   * then the word card, then round again. Items that started as a word card are searched the
   * first time this is used.
   */
  async nextImage(choice: AiImageChoice): Promise<Blob | null> {
    if (!choice.hits) {
      choice.hits = choice.query ? await this.searchHits(choice) : [];
    }
    const order: number[] = [];
    if (choice.pageCrop) order.push(PAGE_CROP_INDEX);
    choice.hits.forEach((_, i) => order.push(i));
    if (choice.generated) order.push(GENERATED_INDEX);
    if (choice.cardText) order.push(WORD_CARD_INDEX);
    const current = order.indexOf(choice.index);
    for (let step = 1; step <= order.length; step++) {
      const index = order[(current + step) % order.length];
      const blob = await this.resolveByIndex(choice, index);
      if (blob) {
        choice.index = index;
        return blob;
      }
    }
    return null;
  }

  private resolveByIndex(choice: AiImageChoice, index: number): Promise<Blob | null> {
    if (index === WORD_CARD_INDEX) return this.renderWordCard(choice.cardText, choice.cardBackground);
    if (index === PAGE_CROP_INDEX) {
      return choice.pageCrop ? this.cropPageImage(choice.pageCrop.blob, choice.pageCrop.box) : Promise.resolve(null);
    }
    if (index === GENERATED_INDEX) return Promise.resolve(choice.generated);
    return this.downloadHit(choice.hits![index]);
  }

  async resolveAudio(text: string, voiceLanguage: string): Promise<Blob | null> {
    if (!text || !this.voice.canSynthesize) return null;
    return withTimeout(this.voice.synthesize(text, voiceLanguage), MEDIA_TIMEOUT_MS);
  }

  /**
   * Picks the closest supported voice for the AI's content language ("en-GB", "tr", ...), or
   * `fallback` when none matches.
   */
  voiceLanguageFor(contentLanguage: string, fallback: string): string {
    const wanted = contentLanguage.trim().toLowerCase();
    if (!wanted) return fallback;
    const exact = VOICE_LANGUAGES.find(lang => lang.code.toLowerCase() === wanted);
    if (exact) return exact.code;
    const base = wanted.split('-')[0];
    const fallbackBase = fallback.toLowerCase().split('-')[0];
    if (fallbackBase === base) return fallback;
    return VOICE_LANGUAGES.find(lang => lang.code.toLowerCase().startsWith(`${base}-`))?.code ?? fallback;
  }

  private async searchHits(choice: AiImageChoice): Promise<PixabayImage[]> {
    const [styleHits, vectorHits] = await Promise.all([
      this.searchPixabay(choice.query, choice.style, STYLE_SEARCH_RESULTS),
      this.searchPixabay(choice.query, 'vector', VECTOR_SEARCH_RESULTS)
    ]);
    const merged: PixabayImage[] = [];
    const seenIds = new Set<number>();
    for (const hit of [...styleHits, ...vectorHits]) {
      if (seenIds.has(hit.id)) continue;
      seenIds.add(hit.id);
      merged.push(hit);
      if (merged.length >= SEARCH_RESULTS) break;
    }
    if (!merged.length) {
      console.warn(`AI topic: no picture found for "${choice.query}", using a word card instead.`);
    }
    return merged;
  }

  private async searchPixabay(
    query: string,
    imageType: PixabaySearchOptions['imageType'],
    perPage: number
  ): Promise<PixabayImage[]> {
    const search = firstValueFrom(this.pixabay.searchImages(query, { imageType, safeSearch: true, perPage }));
    const response = await withTimeout(search, MEDIA_TIMEOUT_MS);
    return response?.hits ?? [];
  }

  private downloadHit(hit: PixabayImage): Promise<Blob | null> {
    const download = async () => {
      const response = await fetch(hit.webformatURL);
      if (!response.ok) return null;
      const blob = await response.blob();
      return this.compressItemImage(blob, `pixabay-${hit.id}.jpg`);
    };
    return withTimeout(download(), MEDIA_TIMEOUT_MS);
  }

  /**
   * Crops the box out of an attached page photo (with a little padding, since the AI's box is
   * approximate) and compresses it the same way a downloaded picture is. Runs entirely on-device
   * — the photo is already in memory from when the teacher attached it, no network involved.
   */
  private cropPageImage(pageBlob: Blob, box: AiCropBox): Promise<Blob | null> {
    const crop = async () => {
      let bitmap: ImageBitmap;
      try {
        bitmap = await createImageBitmap(pageBlob);
      } catch (error) {
        console.debug('AI topic: could not decode the page photo to crop:', error);
        return null;
      }
      try {
        const padX = box.width * CROP_PADDING;
        const padY = box.height * CROP_PADDING;
        const x0 = Math.max(0, box.x - padX);
        const y0 = Math.max(0, box.y - padY);
        const x1 = Math.min(1, box.x + box.width + padX);
        const y1 = Math.min(1, box.y + box.height + padY);
        const sx = Math.round(x0 * bitmap.width);
        const sy = Math.round(y0 * bitmap.height);
        const sw = Math.round((x1 - x0) * bitmap.width);
        const sh = Math.round((y1 - y0) * bitmap.height);
        if (sw < MIN_CROP_SOURCE_PX || sh < MIN_CROP_SOURCE_PX) return null;

        const canvas = document.createElement('canvas');
        canvas.width = sw;
        canvas.height = sh;
        const ctx = canvas.getContext('2d');
        if (!ctx) return null;
        ctx.drawImage(bitmap, sx, sy, sw, sh, 0, 0, sw, sh);

        const cropped = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.92));
        return cropped ? await this.compressItemImage(cropped, 'page-crop.jpg') : null;
      } finally {
        bitmap.close?.();
      }
    };
    return withTimeout(crop(), MEDIA_TIMEOUT_MS);
  }

  private compressItemImage(blob: Blob, fileName: string): Promise<Blob> {
    const file = new File([blob], fileName, { type: blob.type || 'image/jpeg' });
    return imageCompression(file, {
      maxSizeMB: ITEM_IMAGE_MAX_MB,
      maxWidthOrHeight: ITEM_IMAGE_MAX_SIDE,
      useWebWorker: true,
      fileType: 'image/jpeg'
    });
  }

  private renderWordCard(text: string, background = WORD_CARD_BACKGROUND): Promise<Blob> {
    return renderTextImage(text, {
      width: WORD_CARD_WIDTH,
      height: WORD_CARD_HEIGHT,
      background
    });
  }
}
