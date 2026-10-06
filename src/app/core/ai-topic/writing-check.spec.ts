import { buildWritingCheckUserText, gapFeedbackKey, parseWritingCheck } from './writing-check';

describe('writing-check', () => {
  it('numbers sentences across paragraphs and marks every gap with the answer', () => {
    const text = buildWritingCheckUserText({
      feedbackLanguage: 'Turkmen',
      paragraphs: [
        [{ parts: ['I', 'like', 'tea.'] }],
        [
          { parts: ['We', { answer: ' go ', prefix: '', suffix: '' }, 'and', { answer: '', prefix: '(', suffix: ').' }] },
          { parts: ['It', 'was', { answer: 'fun', prefix: '', suffix: '!' }] }
        ]
      ]
    });
    expect(text).toBe([
      'Feedback language: Turkmen',
      '',
      'Paragraph 1:',
      'Sentence 1: I like tea.',
      '',
      'Paragraph 2:',
      'Sentence 2: We [GAP 1: "go"] and ([GAP 2: ""]).',
      'Sentence 3: It was [GAP 1: "fun"]!'
    ].join('\n'));
  });

  it('shows the teacher\'s word for a [word] gap', () => {
    const text = buildWritingCheckUserText({
      feedbackLanguage: 'English',
      paragraphs: [[{ parts: ['To', 'the', { answer: 'stream', prefix: '', suffix: '.', expected: 'river' }] }]]
    });
    expect(text).toContain('Sentence 1: To the [GAP 1: "stream" (teacher\'s word: "river")].');
  });

  it('maps 1-based numbers to 0-based keys and drops gaps that do not exist', () => {
    const result = parseWritingCheck(JSON.stringify({
      overall: '  Good   work! ',
      gaps: [
        { sentence: 2, gap: 1, ok: false, suggestion: 'went', why: 'Past tense.' },
        { sentence: 2, gap: 2, ok: true, suggestion: 'x', why: 'y' },
        { sentence: 1, gap: 1, ok: false, suggestion: 'a', why: 'b' }, // sentence 1 has no gaps
        { sentence: 9, gap: 1, ok: true, suggestion: '', why: '' }
      ]
    }), [0, 2]);
    expect(result.overall).toBe('Good work!');
    expect(result.gaps.size).toBe(2);
    expect(result.gaps.get(gapFeedbackKey(1, 0))).toEqual({ ok: false, suggestion: 'went', why: 'Past tense.' });
    expect(result.gaps.get(gapFeedbackKey(1, 1))).toEqual({ ok: true, suggestion: '', why: '' });
  });

  it('treats "not ok" without a suggestion as ok, and reads fenced JSON', () => {
    const result = parseWritingCheck('```json\n{"overall":"","gaps":[{"sentence":1,"gap":1,"ok":false,"suggestion":"","why":"hm"}]}\n```', [1]);
    expect(result.gaps.get('0-0')).toEqual({ ok: true, suggestion: '', why: '' });
  });

  it('throws when nothing usable came back', () => {
    expect(() => parseWritingCheck('{"overall":"","gaps":[]}', [1])).toThrow();
    expect(() => parseWritingCheck('not json', [1])).toThrow();
  });
});
