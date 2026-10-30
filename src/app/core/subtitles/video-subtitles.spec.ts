import { bookVideoSubtitles } from './video-subtitles';

describe('bookVideoSubtitles', () => {
  it('a video without subtitles: English, no lines', () => {
    expect(bookVideoSubtitles({ src: 'assets/videos/a.mp4' })).toEqual({ language: 'en', lines: [] });
    expect(bookVideoSubtitles(undefined)).toEqual({ language: 'en', lines: [] });
  });

  it('keeps the teacher\'s language and good lines, drops broken ones', () => {
    const data = {
      subtitles: {
        language: 'ru',
        lines: [
          { start: 1, end: 3, text: 'Привет!' },
          { start: 'x', end: 4, text: 'broken' },
          null,
          { start: 5, end: 6 }
        ]
      }
    };
    expect(bookVideoSubtitles(data as Record<string, unknown>)).toEqual({ language: 'ru', lines: [{ start: 1, end: 3, text: 'Привет!' }] });
  });
});
