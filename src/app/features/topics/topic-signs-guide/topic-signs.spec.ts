import { SIGNS_GUIDES, SPEAKING_PART_GUIDES, exampleItems, signPieces } from './topic-signs';
import { buildReadingText } from '../../games/reading-model';
import { buildSpeakingTest } from '../../games/speaking-model';
import { paragraphIndexes, tokenizeSentence } from '../../games/writing-text';
import { parseTaskItem } from '../../games/reading-tasks';

// The guide's examples are what teachers copy, so each one must play in its game exactly as the
// guide says. These run them through the games' own parsers.
const guide = (id: string) => SIGNS_GUIDES.find(g => g.id === id)!;
const items = (lines: readonly string[]) => exampleItems(lines).map(text => ({ text }));

describe('topic-signs (the 📘 guide)', () => {
  it('reading example: paragraphs, a trick heading, key words, a gap and every task play in Reading Detective', () => {
    const text = buildReadingText(items(guide('reading').example));
    expect(text.paragraphs.length).toBe(3);
    expect(text.headings.map(h => h.paragraph >= 0)).toEqual([true, true, true, false]);
    expect(text.keys.map(k => k.text)).toEqual(['grandmother', 'river', 'sad']);
    expect(text.gaps.length).toBe(1);
    expect(text.extras).toEqual(['We went swimming in the sea.']);
    expect(text.statements.map(s => s.answer)).toEqual(['no', 'ng', 'yes']);
    // Every proof quote is really in the text.
    expect(text.statements.filter(s => s.answer !== 'ng').every(s => s.proof >= 0)).toBe(true);
    expect(text.choices.length).toBe(1);
    expect(text.choices[0].proof).toBeGreaterThanOrEqual(0);
    expect(text.choices[0].options.find(o => o.correct)?.text).toBe('Near a river');
    expect(text.wordTasks.map(w => w.key.text)).toEqual(['sad']);
  });

  it('reading signs: every task example is a task the game understands', () => {
    const tasks = guide('reading').steps.flatMap(step => step.signs).map(row => row.example).filter(line => line.startsWith('?'));
    expect(tasks.map(line => parseTaskItem(line)?.tag)).toEqual(['TFNG', 'YNNG', 'MC', 'WORD', 'EXTRA']);
  });

  it('writing example: three paragraphs, two open gaps and one with a known answer', () => {
    const texts = exampleItems(guide('writing').example);
    expect(paragraphIndexes(texts)).toEqual([0, 0, 1, 1, 2, 2]);
    const gaps = texts.flatMap(tokenizeSentence).filter(token => token.kind === 'gap');
    expect(gaps.length).toBe(4);
    expect(gaps.filter(gap => gap.kind === 'gap' && gap.answer).map(gap => gap.kind === 'gap' && gap.answer)).toEqual(['walked']);
  });

  it('speaking example: an interview, a cue card and a discussion, with power words', () => {
    const parts = buildSpeakingTest(items(guide('speaking').example));
    expect(parts.map(part => part.type)).toEqual(['ASK', 'CUE', 'DISCUSS']);
    expect(parts[0].turns.length).toBe(3);
    expect(parts[0].powerWords).toContain('I really enjoy');
    expect(parts.every(part => part.powerWords.length > 0)).toBe(true);
  });

  it('every part card that can be added as text builds its own Talk Show part', () => {
    for (const part of SPEAKING_PART_GUIDES.filter(p => !p.pictures)) {
      const built = buildSpeakingTest(items(part.example));
      expect(built.map(p => p.type)).toEqual([part.type]);
      expect(built[0].turns.length).toBeGreaterThan(0);
    }
  });

  it('every part type has a card, and picture parts are not added as bare text', () => {
    expect(SPEAKING_PART_GUIDES.length).toBe(11);
    expect(SPEAKING_PART_GUIDES.filter(p => p.pictures).map(p => p.type).sort())
      .toEqual(['DIFF', 'PHOTO', 'PICTURE', 'POINT', 'STORY']);
  });

  it('colours each sign of a line', () => {
    expect(signPieces('? MC Why? {*A | B | "proof"}').map(p => p.kind)).toEqual(['mark', 'plain', 'plain', 'brace']);
    expect(signPieces('# ASK Free time')[0]).toEqual({ text: '# ASK', kind: 'mark' });
    expect(signPieces('# Learning to fish')[0]).toEqual({ text: '#', kind: 'mark' });
    expect(signPieces('We swam and _ fish.').map(p => p.kind)).toEqual(['plain', 'gap', 'plain']);
    expect(signPieces('the [river].').map(p => p.kind)).toEqual(['plain', 'key', 'plain']);
  });

  it('leaves the "(picture)" notes out when an example becomes items', () => {
    expect(exampleItems(['# STORY The lost kite', '(picture 1) Tom went out.', '(picture 2)'])).toEqual(['# STORY The lost kite', 'Tom went out.']);
  });
});
