import {
  groupParagraphs,
  headingText,
  isHeading,
  isRemovedSentence,
  isTaskItem,
  plainText,
  readingSentence,
  sameAnswer,
  paragraphColor,
  paragraphIndexes,
  startsParagraph,
  stripParagraphMark,
  tokenKey,
  tokenLabel,
  tokenizeSentence
} from './writing-text';

describe('writing-text', () => {
  describe('stripParagraphMark', () => {
    it('removes a leading star with or without a space', () => {
      expect(stripParagraphMark('* Every morning')).toBe('Every morning');
      expect(stripParagraphMark('*Every morning')).toBe('Every morning');
      expect(stripParagraphMark('  *  Every morning')).toBe('Every morning');
    });

    it('leaves other stars and plain text alone', () => {
      expect(stripParagraphMark('Rated 5* by guests')).toBe('Rated 5* by guests');
      expect(stripParagraphMark('apple')).toBe('apple');
      expect(stripParagraphMark(undefined)).toBeUndefined();
    });
  });

  describe('paragraphs', () => {
    it('starts a new paragraph at every star after the first item', () => {
      const texts = ['* A.', 'B.', '* C.', 'D.', 'E.', '*F.'];
      expect(paragraphIndexes(texts)).toEqual([0, 0, 1, 1, 1, 2]);
    });

    it('treats a topic without stars as one paragraph', () => {
      expect(paragraphIndexes(['A.', 'B.', undefined, 'C.'])).toEqual([0, 0, 0, 0]);
    });

    it('groups items in order', () => {
      const items = [{ text: 'A.' }, { text: '* B.' }, { text: 'C.' }];
      expect(groupParagraphs(items)).toEqual([[items[0]], [items[1], items[2]]]);
      expect(groupParagraphs([])).toEqual([]);
    });

    it('detects the mark', () => {
      expect(startsParagraph(' * x')).toBe(true);
      expect(startsParagraph('x * y')).toBe(false);
      expect(startsParagraph(undefined)).toBe(false);
    });

    it('cycles through the palette', () => {
      expect(paragraphColor(0)).toBe(paragraphColor(8));
      expect(paragraphColor(0)).not.toBe(paragraphColor(1));
    });
  });

  describe('tokenizeSentence', () => {
    it('splits words and keeps punctuation attached', () => {
      expect(tokenizeSentence('* She lives in a  village.')).toEqual([
        { kind: 'word', text: 'She' },
        { kind: 'word', text: 'lives' },
        { kind: 'word', text: 'in' },
        { kind: 'word', text: 'a' },
        { kind: 'word', text: 'village.' }
      ]);
    });

    it('turns underscores into gaps, with surrounding punctuation', () => {
      expect(tokenizeSentence('We _ and ___ (_), "_?"')).toEqual([
        { kind: 'word', text: 'We' },
        { kind: 'gap', prefix: '', suffix: '' },
        { kind: 'word', text: 'and' },
        { kind: 'gap', prefix: '', suffix: '' },
        { kind: 'gap', prefix: '(', suffix: '),' },
        { kind: 'gap', prefix: '"', suffix: '?"' }
      ]);
      expect(tokenizeSentence('We swam and _.')[3]).toEqual({ kind: 'gap', prefix: '', suffix: '.' });
    });

    it('keeps words that only contain an underscore as words', () => {
      expect(tokenizeSentence('snake_case')).toEqual([{ kind: 'word', text: 'snake_case' }]);
    });

    it('gives equal keys to interchangeable tokens', () => {
      const [a, , b, , c] = tokenizeSentence('_ the _ the _.');
      expect(tokenKey(a)).toBe(tokenKey(b));
      expect(tokenKey(a)).not.toBe(tokenKey(c));
      expect(tokenLabel(c)).toBe('___.');
    });
  });

  describe('headings', () => {
    it('detects a leading #', () => {
      expect(isHeading('# A day by the river')).toBe(true);
      expect(isHeading('#Learning to fish')).toBe(true);
      expect(isHeading('## Not a heading')).toBe(false);
      expect(isHeading('#')).toBe(false);
      expect(isHeading('We are #1')).toBe(false);
      expect(headingText('#  A [day] out ')).toBe('A day out');
    });

    it('starts a paragraph at a heading, and a * right after it does not start another', () => {
      expect(paragraphIndexes(['# H1', 'A.', '* B.', '# H2', '* C.', 'D.', '# Extra', '# Extra 2'])).toEqual([0, 0, 1, 2, 2, 2, 3, 4]);
      expect(paragraphIndexes(['A.', '# H2', 'B.'])).toEqual([0, 1, 1]);
    });

    it('gives the plain text without marks or brackets', () => {
      expect(plainText('* We walked to the [river].')).toBe('We walked to the river.');
      expect(plainText('# The [big] day')).toBe('The big day');
    });
  });

  describe('Reading Detective task and gap marks', () => {
    it('tells task items and taken-out sentences apart', () => {
      expect(isTaskItem('? TFNG It is cold. {True}')).toBe(true);
      expect(isTaskItem('Is it cold?')).toBe(false);
      expect(isRemovedSentence('~ She lives here.')).toBe(true);
      expect(isRemovedSentence('About ~5 km away.')).toBe(false);
    });

    it('strips ~ (and a * after it) from what students see', () => {
      expect(plainText('~ * She lives [here].')).toBe('She lives here.');
      expect(startsParagraph('~ * She lives here.')).toBe(true);
      expect(tokenizeSentence('~ We go.').map(t => t.kind === 'word' ? t.text : '_')).toEqual(['We', 'go.']);
    });
  });

  describe('key-word gaps', () => {
    it('turns [word] into a gap that knows its answer, punctuation outside', () => {
      expect(tokenizeSentence('We went to the [river].')).toEqual([
        { kind: 'word', text: 'We' },
        { kind: 'word', text: 'went' },
        { kind: 'word', text: 'to' },
        { kind: 'word', text: 'the' },
        { kind: 'gap', prefix: '', suffix: '.', answer: 'river' }
      ]);
    });

    it('keeps a bracketed phrase as one gap', () => {
      const tokens = tokenizeSentence('She lives in a [small  village], "[far away]!"');
      expect(tokens.slice(3)).toEqual([
        { kind: 'word', text: 'a' },
        { kind: 'gap', prefix: '', suffix: ',', answer: 'small village' },
        { kind: 'gap', prefix: '"', suffix: '!"', answer: 'far away' }
      ]);
    });

    it('drops stray and empty brackets', () => {
      expect(tokenizeSentence('grand[mother] [] went')).toEqual([
        { kind: 'word', text: 'grandmother' },
        { kind: 'word', text: 'went' }
      ]);
    });

    it('compares answers loosely', () => {
      expect(sameAnswer(' River ', 'river')).toBe(true);
      expect(sameAnswer('small   village.', 'small village')).toBe(true);
      expect(sameAnswer('don’t', "don't")).toBe(true);
      expect(sameAnswer('lake', 'river')).toBe(false);
      expect(sameAnswer('', '')).toBe(false);
    });
  });

  describe('readingSentence', () => {
    it('marks the words inside brackets with their key number', () => {
      const result = readingSentence('* Every morning we walked to the [river], then [went fishing].');
      expect(result.keys).toEqual(['river', 'went fishing']);
      expect(result.words.map(w => w.text).join(' ')).toBe('Every morning we walked to the river, then went fishing.');
      expect(result.words.filter(w => w.key === 0).map(w => w.text)).toEqual(['river,']);
      expect(result.words.filter(w => w.key === 1).map(w => w.text)).toEqual(['went', 'fishing.']);
    });

    it('ignores empty brackets and closes an unclosed one at the end', () => {
      const result = readingSentence('A [] b [c d');
      expect(result.keys).toEqual(['c d']);
      expect(result.words.map(w => w.key)).toEqual([-1, -1, 0, 0]);
    });
  });
});
