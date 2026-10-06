import { NgZone } from '@angular/core';
import { vi } from 'vitest';
import { LESSON_PACK_BOXES } from './ai-topic-recipes';
import { DEFAULT_READING_TASKS } from './ai-topic-prompt';
import { AiTopicError } from './ai-topic.service';
import { LessonPackRequest, LessonPackService } from './lesson-pack.service';

const draftItem = (text: string) => ({
  text, imageKind: 'none', imageQuery: '', imageStyle: 'photo', imagePage: -1,
  imageCrop: { x: 0, y: 0, width: 0, height: 0 }, audioText: text
});

describe('LessonPackService', () => {
  let ai: { generateDraft: ReturnType<typeof vi.fn> };
  let media: { resolveImage: ReturnType<typeof vi.fn>; resolveAudio: ReturnType<typeof vi.fn>; voiceLanguageFor: ReturnType<typeof vi.fn> };
  let db: { createTopic: ReturnType<typeof vi.fn>; addItems: ReturnType<typeof vi.fn> };
  let service: LessonPackService;
  const zone = { run: (fn: () => unknown) => fn() } as unknown as NgZone;

  const request: LessonPackRequest = {
    provider: 'gemini',
    pages: [new Blob(['page'])],
    level: 'A2',
    teacherLanguage: 'English',
    images: 'auto',
    audio: 'auto',
    voiceLanguage: 'en-GB',
    readingTasks: { ...DEFAULT_READING_TASKS },
    promptFor: box => `prompt for ${box.id}`,
    cardColors: texts => texts.map(() => '#000')
  };

  beforeEach(() => {
    ai = {
      generateDraft: vi.fn(async (_provider, req) => ({
        topicName: 'Unit 5 - Food',
        language: 'en-GB',
        notes: req.recipe === 'writing' ? ['written by AI'] : [],
        items: req.recipe === 'reading' ? [] : [draftItem(`${req.recipe} 1`), draftItem(`${req.recipe} 2`)]
      }))
    };
    media = {
      resolveImage: vi.fn(async () => ({ blob: new Blob(['img']), choice: null })),
      resolveAudio: vi.fn(async () => new Blob(['mp3'])),
      voiceLanguageFor: vi.fn(() => 'en-GB')
    };
    db = { createTopic: vi.fn(async (name: string) => name.length), addItems: vi.fn(async () => {}) };
    service = new LessonPackService(ai as never, media as never, db as never, zone);
  });

  const settle = () => new Promise(resolve => setTimeout(resolve, 0));

  it('makes one request per box with its recipe, then fills pictures and audio', async () => {
    const run = service.start(LESSON_PACK_BOXES, request, () => {});
    await vi.waitFor(() => expect(run.canSave).toBe(true));

    const calls = ai.generateDraft.mock.calls.map(call => call[1]);
    expect(calls.map(c => c.recipe)).toEqual(['pages', 'sentences', 'reading', 'writing']);
    expect(calls[0].prompt).toBe('prompt for vocabulary');
    expect(calls[2].readingTasks).toEqual(DEFAULT_READING_TASKS);
    expect(calls[0].readingTasks).toBeNull();
    expect(run.cards[0].items.every(item => item.image && item.audio)).toBe(true);
    expect(run.cards[3].notes).toEqual(['written by AI']);
    expect(run.cards[2].status).toBe('ready'); // no items: ready straight away
    expect(run.suggestedName).toBe('Unit 5 - Food');
  });

  it('a failing box fails alone and can be retried', async () => {
    ai.generateDraft.mockImplementationOnce(async () => { throw new AiTopicError('quota'); });
    const run = service.start(LESSON_PACK_BOXES.slice(0, 2), request, () => {});
    await vi.waitFor(() => expect(run.cards[1].status).toBe('ready'));
    expect(run.cards[0].status).toBe('failed');
    expect(run.cards[0].error).toBe('quota');
    expect(run.canSave).toBe(false);

    run.retry(run.cards[0]);
    await vi.waitFor(() => expect(run.canSave).toBe(true));
  });

  it('a removed box no longer blocks saving', async () => {
    ai.generateDraft.mockImplementationOnce(async () => { throw new Error('x'); });
    const run = service.start(LESSON_PACK_BOXES.slice(0, 2), request, () => {});
    await vi.waitFor(() => expect(run.cards[1].status).toBe('ready'));
    run.remove(run.cards[0]);
    expect(run.canSave).toBe(true);
    expect(run.activeCards).toEqual([run.cards[1]]);
  });

  it('ignores answers that arrive after cancel', async () => {
    let resolve!: (value: unknown) => void;
    ai.generateDraft.mockImplementationOnce(() => new Promise(r => { resolve = r; }));
    const run = service.start(LESSON_PACK_BOXES.slice(0, 1), request, () => {});
    run.cancel();
    resolve({ topicName: 'late', language: 'en', notes: [], items: [draftItem('a')] });
    await settle();
    expect(run.cards[0].status).toBe('generating');
    expect(media.resolveImage).not.toHaveBeenCalled();
  });

  it('saves each card as its own topic with the level and the media', async () => {
    const run = service.start(LESSON_PACK_BOXES.slice(0, 2), request, () => {});
    await vi.waitFor(() => expect(run.canSave).toBe(true));
    const ids = await service.save(run.activeCards.map(card => ({ card, name: `Unit 5 · ${card.box.id}` })), 'B1');

    expect(db.createTopic.mock.calls).toEqual([['Unit 5 · vocabulary', 'B1'], ['Unit 5 · sentences', 'B1']]);
    expect(ids.length).toBe(2);
    const [, items] = db.addItems.mock.calls[0];
    const { text, audioText, audioPitch, audioSpeed } = items[0];
    expect({ text, audioText, audioPitch, audioSpeed }).toEqual({ text: 'pages 1', audioText: 'pages 1', audioPitch: 0, audioSpeed: 1 });
    expect(items[0].image).toBeInstanceOf(Blob);
  });
});
