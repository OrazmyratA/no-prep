// "📘 How to write it" in the topic form: the signs Reading Detective, Writing Workshop and Talk Show
// read in item texts (docs/reading-detective.md §1 §7, docs/writing-workshop.md §2,
// docs/talk-show.md §2 §8), as friendly steps with a tiny example each, plus whole examples a
// teacher can start from. The examples are checked by the games' own parsers in topic-signs.spec.ts,
// so they always play. Examples stay English: that is the language being taught.
import { SpeakingTaskType } from '../../../core/speaking-exams';

export type SignsGuideTab = 'reading' | 'writing' | 'speaking';

/** One sign: how it looks, what it means, one example line. */
export interface SignRow {
  sign: string;
  meaningKey: string;
  example: string;
}

/** One step of a tab: what to do, and the signs it uses (none = plain text). */
export interface SignStep {
  titleKey: string;
  hintKey: string;
  signs: SignRow[];
}

export interface SignsGuide {
  id: SignsGuideTab;
  icon: string;
  titleKey: string;
  gameKey: string;
  steps: SignStep[];
  /** A small complete topic, one item per line, and its name (used when the topic has none yet). */
  example: string[];
  exampleName: string;
}

export const SIGNS_GUIDES: SignsGuide[] = [
  {
    id: 'reading',
    icon: '📖',
    titleKey: 'signsTabReading',
    gameKey: 'signsGameReading',
    exampleName: 'A summer at grandma\'s',
    steps: [
      { titleKey: 'signsReadStep1', hintKey: 'signsReadStep1Hint', signs: [] },
      {
        titleKey: 'signsReadStep2', hintKey: 'signsReadStep2Hint',
        signs: [{ sign: '#', meaningKey: 'signsReadHeading', example: '# Learning to fish' }]
      },
      {
        titleKey: 'signsReadStep3', hintKey: 'signsReadStep3Hint',
        signs: [{ sign: '[ ]', meaningKey: 'signsReadKey', example: 'Every morning we walked to the [river].' }]
      },
      {
        titleKey: 'signsReadStep4', hintKey: 'signsReadStep4Hint',
        signs: [
          { sign: '? TFNG', meaningKey: 'signsReadTfng', example: '? TFNG The writer stayed for two weeks. {False | "four weeks"}' },
          { sign: '? YNNG', meaningKey: 'signsReadYnng', example: '? YNNG The writer wants to visit again. {Yes | "hope to go back"}' },
          { sign: '? MC', meaningKey: 'signsReadMc', example: '? MC Where does grandma live? {*Near a river | In a big city | "by a river"}' },
          { sign: '? WORD', meaningKey: 'signsReadWord', example: '? WORD Find a word in paragraph 3 that means "unhappy". {sad}' },
          { sign: '~', meaningKey: 'signsReadRemoved', example: '~ Grandma showed me how to be patient.' },
          { sign: '? EXTRA', meaningKey: 'signsReadExtra', example: '? EXTRA We went swimming in the sea.' }
        ]
      }
    ],
    example: [
      '# A summer at grandma\'s',
      'Last summer I visited my [grandmother].',
      'She lives in a small village by a river.',
      'I stayed there for four weeks.',
      '# Learning to fish',
      'Every morning we walked to the [river].',
      '~ Grandma showed me how to be patient.',
      'At first I caught nothing, but I didn\'t give up.',
      '# Saying goodbye',
      'On the last day I felt [sad].',
      'I hope to go back next summer.',
      '# A trip to the city',
      '? TFNG The writer stayed for two weeks. {False | "four weeks"}',
      '? TFNG Grandma has a dog. {Not given}',
      '? YNNG The writer wants to visit again. {Yes | "hope to go back"}',
      '? MC Where does grandma live? {*Near a river | In a big city | By the sea | "by a river"}',
      '? WORD Find a word in paragraph 3 that means "unhappy". {sad}',
      '? EXTRA We went swimming in the sea.'
    ]
  },
  {
    id: 'writing',
    icon: '📓',
    titleKey: 'signsTabWriting',
    gameKey: 'signsGameWriting',
    exampleName: 'My summer holiday',
    steps: [
      { titleKey: 'signsWriteStep1', hintKey: 'signsWriteStep1Hint', signs: [] },
      {
        titleKey: 'signsWriteStep2', hintKey: 'signsWriteStep2Hint',
        signs: [
          { sign: '*', meaningKey: 'signsWriteStar', example: '* Every morning we walked to the river.' },
          { sign: '#', meaningKey: 'signsWriteHeading', example: '# My best holiday' }
        ]
      },
      {
        titleKey: 'signsWriteStep3', hintKey: 'signsWriteStep3Hint',
        signs: [
          { sign: '_', meaningKey: 'signsWriteGap', example: 'We swam and _ fish.' },
          { sign: '[ ]', meaningKey: 'signsWriteKnownGap', example: 'Every morning we [walked] to the river.' }
        ]
      }
    ],
    example: [
      'Last summer I visited my grandmother.',
      'She _ in a small village by a river.',
      '* Every morning we [walked] to the river.',
      'We swam and _ fish.',
      '* On the last day I felt _.',
      'I hope to go back next summer.'
    ]
  },
  {
    id: 'speaking',
    icon: '🗣️',
    titleKey: 'signsTabSpeaking',
    gameKey: 'signsGameSpeaking',
    exampleName: 'Speaking test: free time and travel',
    steps: [
      {
        titleKey: 'signsSpeakStep1', hintKey: 'signsSpeakStep1Hint',
        signs: [{ sign: '# TAG', meaningKey: 'signsSpeakHeading', example: '# ASK Free time' }]
      },
      {
        titleKey: 'signsSpeakStep2', hintKey: 'signsSpeakStep2Hint',
        signs: [
          { sign: '{ }', meaningKey: 'signsSpeakBraces', example: 'What do you do at weekends? {Why? | Who with?}' },
          { sign: '[ ]', meaningKey: 'signsSpeakPower', example: '[I really enjoy] [because] [at the weekend]' }
        ]
      },
      { titleKey: 'signsSpeakStep3', hintKey: 'signsSpeakStep3Hint', signs: [] }
    ],
    example: [
      '# ASK Free time',
      'What do you do at weekends? {Why? | Who with?}',
      'Do you like sport? {Which one?}',
      'What did you do last summer?',
      '[I really enjoy] [because] [at the weekend]',
      '# CUE Describe a place you visited {Would you like to go back there?}',
      'where it is',
      'when you went there',
      'what you did there',
      'and explain why you liked it',
      '[breathtaking] [I\'d love to go back]',
      '# DISCUSS Travel',
      'Why do people like travelling? {Is it always good?}',
      'How has travel changed in the last 50 years?',
      '[On the one hand] [However] [In my opinion]'
    ]
  }
];

/** One Talk Show part type: what to write under its heading, and a small example. */
export interface SpeakingPartGuide {
  type: SpeakingTaskType;
  whatKey: string;
  /** Lines in brackets, like "(picture)", stand for a picture the teacher adds. */
  example: string[];
  /** The part needs pictures, so its example can't simply be added as text. */
  pictures: boolean;
}

export const SPEAKING_PART_GUIDES: SpeakingPartGuide[] = [
  {
    type: 'ASK', whatKey: 'signsPartAsk', pictures: false,
    example: ['# ASK Free time', 'What do you do at weekends? {Why? | Who with?}', 'Do you like sport? {Which one?}', 'What did you do last summer?', '[I really enjoy] [because]']
  },
  {
    type: 'ODD', whatKey: 'signsPartOdd', pictures: false,
    example: ['# ODD Which one is different?', '*bus | plane | bird | kite {The others can fly.}', 'apple | banana | *carrot | pear {The others are fruit.}']
  },
  {
    type: 'INFO', whatKey: 'signsPartInfo', pictures: false,
    example: ['# INFO Sam\'s holiday', 'Where / go? {Paris}', 'How / travel? {by train}', 'Who did you go with?', 'What did you see there?']
  },
  {
    type: 'DECIDE', whatKey: 'signsPartDecide', pictures: false,
    example: ['# DECIDE A present for a friend', 'Which is the best present for a friend? {Why? | Which is the worst?}', 'a book', 'a football', 'a computer game', 'a T-shirt', '[I think] [What about] [I agree]']
  },
  {
    type: 'CUE', whatKey: 'signsPartCue', pictures: false,
    example: ['# CUE Describe a place you visited {Would you like to go back there?}', 'where it is', 'when you went there', 'what you did there', 'and explain why you liked it']
  },
  {
    type: 'DISCUSS', whatKey: 'signsPartDiscuss', pictures: false,
    example: ['# DISCUSS Travel', 'Why do people like travelling? {Is it always good?}', 'How has travel changed in the last 50 years?']
  },
  {
    type: 'PICTURE', whatKey: 'signsPartPicture', pictures: true,
    example: ['# PICTURE At the park', '(the scene picture, no text)', 'How many birds are there? {three}', 'What is the boy doing? {flying a kite}']
  },
  {
    type: 'POINT', whatKey: 'signsPartPoint', pictures: true,
    example: ['# POINT At the park', '(the scene picture, no text)', 'Where is the ball? Point to it.', '(a cat picture) Put the cat on the chair.']
  },
  {
    type: 'DIFF', whatKey: 'signsPartDiff', pictures: true,
    example: ['# DIFF Two kitchens', '(picture A, no text)', '(picture B, no text)', 'In my picture the cat is black. {In my picture it\'s white.}']
  },
  {
    type: 'STORY', whatKey: 'signsPartStory', pictures: true,
    example: ['# STORY The lost kite', '(picture 1) Tom and Sue went to the park with their kite.', '(picture 2)', '(picture 3)', '(picture 4)']
  },
  {
    type: 'PHOTO', whatKey: 'signsPartPhoto', pictures: true,
    example: ['# PHOTO A day out', '(a photo) Tell me what you can see in the photo.']
  }
];

/** A piece of an example line, with what kind of sign it is (for colouring). */
export interface SignPiece {
  text: string;
  kind: 'plain' | 'mark' | 'key' | 'brace' | 'gap' | 'note';
}

/**
 * Splits a line into its signs and plain words: the leading mark (`#`, `# TAG`, `*`, `~`, `? TAG`),
 * `[key words]`, `{answers}`, `_` gaps and "(picture)" notes, so the guide can colour each sign.
 */
export function signPieces(line: string): SignPiece[] {
  const pieces: SignPiece[] = [];
  let rest = line;
  const lead = rest.match(/^(\?\s*[A-Z]+|#\s*(?:[A-Z]{3,}(?=\s|$))?|\*|~)\s*/);
  if (lead && lead[0].trim()) {
    pieces.push({ text: lead[0].trimEnd(), kind: 'mark' });
    pieces.push({ text: ' ', kind: 'plain' });
    rest = rest.slice(lead[0].length);
  }
  for (const part of rest.split(/(\[[^\]]*\]|\{[^}]*\}|_+|\([^)]*\))/)) {
    if (!part) continue;
    if (part.startsWith('[')) pieces.push({ text: part, kind: 'key' });
    else if (part.startsWith('{')) pieces.push({ text: part, kind: 'brace' });
    else if (part.startsWith('_')) pieces.push({ text: part, kind: 'gap' });
    else if (part.startsWith('(')) pieces.push({ text: part, kind: 'note' });
    else pieces.push({ text: part, kind: 'plain' });
  }
  return pieces;
}

/** The lines of an example that become items: picture notes are left out. */
export function exampleItems(lines: readonly string[]): string[] {
  return lines.map(line => line.replace(/^\([^)]*\)\s*/, '').trim()).filter(Boolean);
}
