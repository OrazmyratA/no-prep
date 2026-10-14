import { buildSpeakingFeedbackUserText, parseSpeakingFeedback, suggestableCriteria } from './speaking-feedback';

describe('speaking-feedback', () => {
  it('never asks for pronunciation and gives the AI the answers with timing', () => {
    expect(suggestableCriteria('pet')).toEqual(['grammarVocab', 'discourse', 'interaction', 'global']);
    const text = buildSpeakingFeedbackUserText({
      exam: 'ielts',
      feedbackLanguage: 'Russian',
      candidates: [{
        label: 'Aylar',
        powerWords: ['breathtaking', 'I would love to'],
        powerWordsUsed: ['breathtaking'],
        turns: [
          { part: 'Part 1 · Interview', prompt: 'Where do you live?', transcript: 'I live in Ashgabat, it is a white city.', seconds: 12 },
          { part: 'Part 1 · Interview', prompt: 'Do you like it?', transcript: '', seconds: 3 }
        ]
      }]
    });
    expect(text).toContain('Scale for every criterion: 1 to 9');
    expect(text).toContain('- fluency:');
    expect(text).not.toContain('- pronunciation');
    expect(text).toContain('Spoke 9 words in 15 seconds (36 words per minute).');
    expect(text).toContain('Power words used: 1 of 2 (breathtaking).');
    expect(text).toContain('(no transcript)');
    expect(text).toContain('Feedback language: Russian');
  });

  it('reads marks onto the exam scale and drops what it may not suggest', () => {
    const feedback = parseSpeakingFeedback(JSON.stringify({
      candidates: [
        {
          candidate: 2,
          marks: [
            { criterion: 'fluency', mark: 6.4, reason: 'Long answers with some pauses.' },
            { criterion: 'lexical', mark: 12, reason: 'Wide range.' },
            { criterion: 'pronunciation', mark: 5, reason: 'Should be ignored.' },
            { criterion: 'humour', mark: 9, reason: 'Unknown.' }
          ],
          strengths: ['Gives reasons', ' ', 'Uses linking words', 'Extra', 'Too many'],
          tips: ['Use the past tense for stories']
        },
        { candidate: 7, marks: [{ criterion: 'fluency', mark: 3, reason: 'x' }], strengths: [], tips: [] }
      ]
    }), 'ielts', 2);
    expect(feedback[0].marks).toEqual([null, null, null, null]);
    expect(feedback[1].marks).toEqual([6, 9, null, null]);
    expect(feedback[1].reasons[0]).toBe('Long answers with some pauses.');
    expect(feedback[1].reasons[3]).toBe('');
    expect(feedback[1].strengths).toEqual(['Gives reasons', 'Uses linking words', 'Extra']);
    expect(feedback[1].tips).toEqual(['Use the past tense for stories']);
  });

  it('throws when nothing usable came back', () => {
    expect(() => parseSpeakingFeedback('{"candidates": []}', 'ket', 1)).toThrow();
    expect(() => parseSpeakingFeedback('not json', 'ket', 1)).toThrow();
  });
});
