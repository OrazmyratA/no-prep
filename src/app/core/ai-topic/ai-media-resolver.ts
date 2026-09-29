import { Injectable } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import imageCompression from 'browser-image-compression';
import { PixabayImage, PixabayService } from '../pixabay';
import { AudioVoiceService, VOICE_LANGUAGES } from '../audio-voice';
import { renderTextImage } from '../../shared/text-image';
import { AiItemDraft } from './ai-topic-draft';

// Same output as the image uploader's defaults, so AI images look and weigh like hand-picked ones.
const ITEM_IMAGE_MAX_MB = 0.2;
const ITEM_IMAGE_MAX_SIDE = 800;
// Same size and default colour as the image uploader's text image.
const WORD_CARD_WIDTH = 640;
const WORD_CARD_HEIGHT = 360;
const WORD_CARD_BACKGROUND = '#1d4ed8';
// Save stays disabled while media loads, so one stuck request must not block it for good.
const MEDIA_TIMEOUT_MS = 20000;
// Search results kept per item for "another picture".
const SEARCH_RESULTS = 6;
const WORD_CARD_INDEX = -1;

/** An AI item's picture options: search results plus a word card. */
export interface AiImageChoice {
  query: string;
  style: 'photo' | 'illustration';
  cardText: string;
  hits: PixabayImage[] | null;  // null = not searched yet
  index: number;                // shown search result, or WORD_CARD_INDEX
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
  constructor(private pixabay: PixabayService, private voice: AudioVoiceService) {}

  get canMakeAudio(): boolean {
    return this.voice.canSynthesize;
  }

  /**
   * Finds or draws the item's picture. A failed search falls back to a word card. The returned
   * choice remembers the other search results so `nextImage` can offer "another picture".
   */
  async resolveImage(item: AiItemDraft): Promise<{ blob: Blob | null; choice: AiImageChoice | null }> {
    if (item.imageKind === 'none') return { blob: null, choice: null };
    const cardText = item.imageKind === 'wordCard' ? item.imageQuery : item.text;
    const choice: AiImageChoice = {
      query: item.imageKind === 'search' ? item.imageQuery : cardText,
      style: item.imageStyle,
      cardText,
      hits: null,
      index: WORD_CARD_INDEX
    };
    if (item.imageKind === 'search') {
      choice.hits = await this.searchHits(choice);
      for (let i = 0; i < choice.hits.length; i++) {
        const photo = await this.downloadHit(choice.hits[i]);
        if (photo) {
          choice.index = i;
          return { blob: photo, choice };
        }
      }
    }
    return { blob: cardText ? await this.renderWordCard(cardText) : null, choice };
  }

  /**
   * The next picture for an item: the remaining search results, then the word card, then round
   * again. Items that started as a word card are searched the first time this is used.
   */
  async nextImage(choice: AiImageChoice): Promise<Blob | null> {
    if (!choice.hits) {
      choice.hits = choice.query ? await this.searchHits(choice) : [];
    }
    const order = choice.hits.map((_, i) => i);
    if (choice.cardText) order.push(WORD_CARD_INDEX);
    const current = order.indexOf(choice.index);
    for (let step = 1; step <= order.length; step++) {
      const index = order[(current + step) % order.length];
      const blob = index === WORD_CARD_INDEX
        ? await this.renderWordCard(choice.cardText)
        : await this.downloadHit(choice.hits[index]);
      if (blob) {
        choice.index = index;
        return blob;
      }
    }
    return null;
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
    const search = firstValueFrom(this.pixabay.searchImages(choice.query, {
      imageType: choice.style,
      safeSearch: true,
      perPage: SEARCH_RESULTS
    }));
    const response = await withTimeout(search, MEDIA_TIMEOUT_MS);
    const hits = response?.hits ?? [];
    if (!hits.length) {
      console.warn(`AI topic: no picture found for "${choice.query}", using a word card instead.`);
    }
    return hits;
  }

  private downloadHit(hit: PixabayImage): Promise<Blob | null> {
    const download = async () => {
      const response = await fetch(hit.webformatURL);
      if (!response.ok) return null;
      const blob = await response.blob();
      const file = new File([blob], `pixabay-${hit.id}.jpg`, { type: blob.type || 'image/jpeg' });
      return imageCompression(file, {
        maxSizeMB: ITEM_IMAGE_MAX_MB,
        maxWidthOrHeight: ITEM_IMAGE_MAX_SIDE,
        useWebWorker: true,
        fileType: 'image/jpeg'
      });
    };
    return withTimeout(download(), MEDIA_TIMEOUT_MS);
  }

  private renderWordCard(text: string): Promise<Blob> {
    return renderTextImage(text, {
      width: WORD_CARD_WIDTH,
      height: WORD_CARD_HEIGHT,
      background: WORD_CARD_BACKGROUND
    });
  }
}
