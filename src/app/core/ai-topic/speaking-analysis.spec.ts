import { SPEAKING_PART_MAX, buildSpeakingAnalysisUserText, parseSpeakingAnalysis, speakingItemCount } from './speaking-analysis';

describe('speaking-analysis', () => {
  it('reads the exam and the parts, merging repeats and dropping unknown types', () => {
    const analysis = parseSpeakingAnalysis(JSON.stringify({
      exam: 'flyers',
      parts: [
        { type: 'diff', count: 6 },
        { type: 'STORY', count: 5 },
        { type: 'SING', count: 2 },
        { type: 'DIFF', count: 1 },
        { type: 'ASK', count: 40 }
      ],
      notes: ['Page 2 is blurry.', '  ']
    }));
    expect(analysis.exam).toBe('flyers');
    expect(analysis.parts).toEqual([
      { type: 'DIFF', count: 7 },
      { type: 'STORY', count: 5 },
      { type: 'ASK', count: SPEAKING_PART_MAX }
    ]);
    expect(analysis.notes).toEqual(['Page 2 is blurry.']);
  });

  it('keeps a long interview found in the book (more than 10 questions)', () => {
    const analysis = parseSpeakingAnalysis({ exam: 'ielts', parts: [{ type: 'ASK', count: 14 }], notes: [] });
    expect(analysis.parts).toEqual([{ type: 'ASK', count: 14 }]);
  });

  it('counts the items a test makes: questions, headings, power words and lead pictures', () => {
    // ASK 20 + 2; DIFF 6 + 2 + 2 pictures.
    expect(speakingItemCount([{ type: 'ASK', count: 20 }, { type: 'DIFF', count: 6 }])).toBe(32);
  });

  it('gives no exam for "unknown" and survives a wrapped answer', () => {
    const analysis = parseSpeakingAnalysis('Here you go: {"exam":"unknown","parts":[],"notes":[]}');
    expect(analysis.exam).toBeNull();
    expect(analysis.parts).toEqual([]);
  });

  it('tells the AI what it has to read', () => {
    const text = buildSpeakingAnalysisUserText({ prompt: '', pageCount: 2, teacherLanguage: 'Russian' });
    expect(text).toContain('(none - use the attached pages)');
    expect(text).toContain('Attached page photos: 2');
    expect(text).toContain('Russian');
  });
});
