import {
  buildSpeakingTest, findPowerWords, formatArea, hasSpeakingParts, isInArea, itemArea, parseArea, parseSpeakingHeading,
  setItemArea, splitBraces, takePowerWords
} from './speaking-model';
import { examForLevel, examinerIntro, overallScore, turnSeconds } from '../../core/speaking-exams';

const image = new Blob(['p']);

describe('speaking-model', () => {
  it('splits braces and power words', () => {
    expect(splitBraces('Where do you live? {Why? | Tell me more}')).toEqual({ text: 'Where do you live?', extras: ['Why?', 'Tell me more'] });
    expect(splitBraces('No braces')).toEqual({ text: 'No braces', extras: [] });
    expect(takePowerWords('It was [breathtaking] there.')).toEqual({ text: 'It was breathtaking there.', words: ['breathtaking'], onlyWords: false });
    expect(takePowerWords("[breathtaking] [I'd love to go back]").onlyWords).toBe(true);
  });

  it('reads part headings, case-insensitive, and ignores other headings', () => {
    expect(parseSpeakingHeading('# cue Describe a place {Would you go back?}'))
      .toEqual({ type: 'CUE', title: 'Describe a place', extras: ['Would you go back?'] });
    expect(parseSpeakingHeading('# A summer by the river')).toBeNull();
    expect(parseSpeakingHeading('What is your name?')).toBeNull();
    expect(hasSpeakingParts(['Hello', '# ODD Sets'])).toBe(true);
    expect(hasSpeakingParts(['Hello', '# Heading'])).toBe(false);
  });

  it('makes an ASK part from plain questions, with follow-ups and power words', () => {
    const parts = buildSpeakingTest([
      { text: 'What do you do at weekends? {Why?}' },
      { text: 'Tell me about your [favourite] food.' },
      { text: '[because] [I really like]' }
    ]);
    expect(parts.length).toBe(1);
    expect(parts[0].type).toBe('ASK');
    expect(parts[0].turns.map(t => [t.prompt, t.followUps])).toEqual([
      ['What do you do at weekends?', ['Why?']],
      ['Tell me about your favourite food.', []]
    ]);
    expect(parts[0].powerWords).toEqual(['favourite', 'because', 'I really like']);
  });

  it('builds every task type in topic order', () => {
    const p = (text: string) => ({ text, image });
    const parts = buildSpeakingTest([
      { text: '# PICTURE The park' },
      { text: '', image },
      { text: 'How many birds are there? {three}' },
      p('What is this? {a kite}'),
      { text: '# DIFF' },
      p(''),
      p(''),
      { text: 'In my picture the cat is black. {In my picture it is white.}' },
      { text: '# STORY The lost kite {What happened next?}' },
      p('Tom and Sue went to the park.'),
      p('The wind took the kite.'),
      p(''),
      { text: '# ODD' },
      { text: '*bus | plane | bird | kite {The others can fly.}' },
      { text: '# INFO Harry\'s holiday' },
      p(''),
      { text: 'Where / go? {Paris}' },
      { text: 'Who did you go with?' },
      { text: '# PHOTO' },
      p(''),
      { text: '# DECIDE A school trip {Which is best?}' },
      { text: 'Which place is the most fun for a class trip? {Why?}' },
      p('museum'),
      p('zoo'),
      { text: '# CUE Describe a place you visited {Would you go back?}' },
      { text: 'where it is' },
      { text: 'and explain why you liked it' },
      { text: '# DISCUSS' },
      { text: 'Why do people travel?' },
      { text: '? TFNG not a speaking item {True}' }
    ]);
    expect(parts.map(part => part.type)).toEqual(['PICTURE', 'DIFF', 'STORY', 'ODD', 'INFO', 'PHOTO', 'DECIDE', 'CUE', 'DISCUSS']);
    const [picture, diff, story, odd, info, photo, decide, cue, discuss] = parts;

    expect(picture.turns.map(t => [t.prompt, t.answer, !!t.item])).toEqual([
      ['How many birds are there?', 'three', true],
      ['What is this?', 'a kite', true]
    ]);
    expect(diff.turns[0].pictures.length).toBe(2);
    expect(diff.turns[0].differences).toEqual([{ statement: 'In my picture the cat is black.', answer: 'In my picture it is white.' }]);
    expect(story.title).toBe('The lost kite');
    expect(story.turns[0].prompt).toBe('Tom and Sue went to the park.');
    expect(story.turns[0].captions).toEqual(['', 'The wind took the kite.', '']);
    expect(story.turns[0].followUps).toEqual(['What happened next?']);
    expect(odd.turns[0].options).toEqual([
      { text: 'bus', odd: true }, { text: 'plane', odd: false }, { text: 'bird', odd: false }, { text: 'kite', odd: false }
    ]);
    expect(odd.turns[0].answer).toBe('The others can fly.');
    expect(info.turns.map(t => [t.role, t.prompt, t.answer, !!t.item])).toEqual([
      ['ask', 'Where / go?', 'Paris', true],
      ['answer', 'Who did you go with?', '', true]
    ]);
    expect(photo.turns[0].prompt).toBe('Tell me what you can see in the photograph.');
    expect(decide.turns.length).toBe(1);
    expect(decide.turns[0].prompt).toBe('Which place is the most fun for a class trip?');
    expect(decide.turns[0].captions).toEqual(['museum', 'zoo']);
    expect(decide.turns[0].followUps).toEqual(['Why?', 'Which is best?']);
    expect(cue.turns[0].prompt).toBe('Describe a place you visited');
    expect(cue.turns[0].points).toEqual(['where it is', 'and explain why you liked it']);
    expect(cue.turns[0].followUps).toEqual(['Would you go back?']);
    expect(discuss.turns.map(t => t.prompt)).toEqual(['Why do people travel?']);
  });

  it('drops parts with nothing to answer and treats other headings as interview parts', () => {
    const parts = buildSpeakingTest([{ text: '# STORY' }, { text: 'no pictures here' }, { text: '# Food' }, { text: 'Do you like pizza?' }]);
    expect(parts.map(part => [part.type, part.title])).toEqual([['ASK', 'Food']]);
  });

  it('reads, writes and checks point & place answer areas', () => {
    expect(parseArea('@100,200,300,500')).toEqual({ x: 0.2, y: 0.1, width: 0.3, height: 0.2 });
    expect(parseArea('@100,200,105,205')).toBeNull(); // too small
    expect(parseArea('Why?')).toBeNull();
    expect(formatArea({ x: 0.2, y: 0.1, width: 0.3, height: 0.2 })).toBe('@100,200,300,500');
    expect(setItemArea('Point to the ball.', { x: 0.2, y: 0.1, width: 0.3, height: 0.2 })).toBe('Point to the ball. {@100,200,300,500}');
    expect(setItemArea('Point to the ball. {@1,1,500,500 | Good!}', null)).toBe('Point to the ball. {Good!}');
    expect(itemArea('Ball {Good! | @0,0,500,500}')).toEqual({ x: 0, y: 0, width: 0.5, height: 0.5 });
    const area = { x: 0.2, y: 0.2, width: 0.1, height: 0.1 };
    expect(isInArea({ x: 0.25, y: 0.25 }, area)).toBe(true);
    expect(isInArea({ x: 0.32, y: 0.25 }, area)).toBe(true); // a little give
    expect(isInArea({ x: 0.5, y: 0.5 }, area)).toBe(false);
  });

  it('builds point & place turns: point without a card, place with one', () => {
    const scene = { text: '', image };
    const [part] = buildSpeakingTest([
      { text: '# POINT At the park' },
      scene,
      { text: 'Where is the ball? Point to it. {@100,200,300,500}' },
      { text: 'Put the cat under the table.', image }
    ]);
    expect(part.type).toBe('POINT');
    expect(part.turns.map(t => [t.prompt, t.item === scene, !!t.card, !!t.area])).toEqual([
      ['Where is the ball? Point to it.', true, false, true],
      ['Put the cat under the table.', true, true, false]
    ]);
    expect(buildSpeakingTest([{ text: '# POINT' }, { text: 'Point to the ball.' }])).toEqual([]);
  });

  it('finds power words in a transcript', () => {
    expect(findPowerWords("Well, it was BREATHTAKING, and I'd love to go back!", ['breathtaking', "I’d love to go back", 'stunning']))
      .toEqual(['breathtaking', "I’d love to go back"]);
    expect(findPowerWords('the cathedral', ['cat'])).toEqual([]);
  });
});

describe('speaking-exams', () => {
  it('scores each exam its own way', () => {
    expect(overallScore('movers', [4, 5, 4])).toBe(4);
    expect(overallScore('ket', [3, 4, null, 5])).toBe(12);
    expect(overallScore('ielts', [6, 7, 6, 6])).toBe(6.5);
    expect(overallScore('ielts', [6, 6, 6, 6.5])).toBe(6);
    expect(overallScore('pet', [null, null])).toBeNull();
  });

  it('picks timings, examiner lines and a default exam', () => {
    expect(turnSeconds('ielts', 'CUE')).toBe(120);
    expect(turnSeconds('pet', 'PHOTO')).toBe(60);
    expect(examinerIntro('ket', 'ASK', 'your school')).toContain('about your school');
    expect(examForLevel('B1')).toBe('pet');
    expect(examForLevel(undefined)).toBe('ket');
  });
});
