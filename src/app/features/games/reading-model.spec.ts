import { buildReadingText, findKeyAt, headingSeconds, wordDelayMs } from './reading-model';

const image = new Blob(['q']);

describe('reading-model', () => {
  describe('buildReadingText', () => {
    it('builds paragraphs from # headings, keeps distractors, numbers words across the text', () => {
      const text = buildReadingText([
        { text: '# A summer by the river' },
        { text: 'Last summer I visited my [grandmother].', image },
        { text: 'She lives in a small village.' },
        { text: '# Learning to fish' },
        { text: 'Every morning we walked to the [river].', image },
        { text: '# Shopping in the city' }
      ]);
      expect(text.paragraphs.length).toBe(2);
      expect(text.headings.map(h => [h.text, h.paragraph])).toEqual([
        ['A summer by the river', 0],
        ['Learning to fish', 1],
        ['Shopping in the city', -1]
      ]);
      expect(text.paragraphs.map(p => p.heading)).toEqual([0, 1]);
      expect(text.sentences.map(s => s.hasQuestion)).toEqual([true, false, true]);
      expect(text.keys.map(k => [k.text, k.paragraph])).toEqual([['grandmother', 0], ['river', 1]]);
      expect(text.words.map(w => w.id)).toEqual(text.words.map((_, i) => i));
      expect(text.words[5]).toEqual({ id: 5, text: 'grandmother.', core: 'grandmother', key: 0, sentence: 0 });
    });

    it('works without headings: * paragraphs, no heading matching', () => {
      const text = buildReadingText([{ text: 'One two.' }, { text: '* Three four.' }, { text: '   ' }]);
      expect(text.paragraphs.length).toBe(2);
      expect(text.paragraphs.every(p => p.heading === -1)).toBe(true);
      expect(text.headings).toEqual([]);
    });

    it('drops a key that has no letters', () => {
      const text = buildReadingText([{ text: 'Hello [!] world [there].' }]);
      expect(text.keys.map(k => k.text)).toEqual(['there']);
    });
  });

  describe('tasks and gaps', () => {
    const text = buildReadingText([
      { text: '# A visit' },
      { text: 'Last summer I spent four weeks with my grandmother.' },
      { text: '~ She lives in a small stone house.' },
      { text: '# Fishing' },
      { text: 'Grandma showed me how to be patient and quiet.' },
      { text: '? TFNG The writer stayed for a month. {False | "four weeks"}' },
      { text: '? TFNG Grandma has a dog. {Not given}' },
      { text: '? YNNG The writer liked it. {Yes | "not in the text"}' },
      { text: '? TFNG Broken answer. {Maybe}' },
      { text: '? MC How long did the writer stay? {*Four weeks | Two days | "four weeks"}' },
      { text: '? WORD Find a word in paragraph 2 that means calm. {quiet}' },
      { text: '? WORD Not in the text. {elephant}' },
      { text: '? EXTRA The weather was bad.' }
    ]);

    it('keeps task items out of the text and finds the ~ gaps', () => {
      expect(text.sentences.length).toBe(3);
      expect(text.paragraphs.length).toBe(2);
      expect(text.gaps).toEqual([1]);
      expect(text.sentences[1].words[0].text).toBe('She');
      expect(text.extras).toEqual(['The weather was bad.']);
    });

    it('finds the proof sentence from the quote; Not given and missing quotes have none', () => {
      expect(text.statements.map(s => [s.kind, s.answer, s.proof])).toEqual([
        ['tfng', 'no', 0],
        ['tfng', 'ng', -1],
        ['ynng', 'yes', -1]
      ]);
      expect(text.choices[0].proof).toBe(0);
      expect(text.choices[0].options[0].correct).toBe(true);
    });

    it('keeps only find-the-word tasks whose word is in the text', () => {
      expect(text.wordTasks.length).toBe(1);
      expect(text.wordTasks[0].key).toEqual({ id: -1, text: 'quiet', words: ['quiet'], paragraph: 1 });
    });
  });

  describe('findKeyAt', () => {
    const text = buildReadingText([
      { text: 'We [went fishing] at dawn.' },
      { text: 'Later we went fishing again.' }
    ]);
    const key = text.keys[0];

    it('finds the phrase from any of its words, bracketed or not', () => {
      expect(findKeyAt(text.words, key, 1)).toEqual([1, 2]);
      expect(findKeyAt(text.words, key, 2)).toEqual([1, 2]);
      expect(findKeyAt(text.words, key, 7)).toEqual([7, 8]);
    });

    it('rejects other words', () => {
      expect(findKeyAt(text.words, key, 0)).toBeNull();
      expect(findKeyAt(text.words, key, 4)).toBeNull();
    });
  });

  describe('timing', () => {
    it('pauses longer after commas and full stops', () => {
      expect(wordDelayMs('cat', 100)).toBe(600);
      expect(wordDelayMs('cat,', 100)).toBe(900);
      expect(wordDelayMs('cat.', 100)).toBe(1320);
      expect(wordDelayMs('"Really?"', 100)).toBe(1320);
      expect(wordDelayMs('extraordinary', 100)).toBe(720);
    });

    it('gives about 10 s + 1 s per 5 words, scaled by level, within 15-45 s', () => {
      expect(headingSeconds(50, 'B1')).toBe(20);
      expect(headingSeconds(50, 'A2')).toBe(26);
      expect(headingSeconds(10, 'C2')).toBe(15);
      expect(headingSeconds(200, 'A1')).toBe(45);
    });
  });
});
