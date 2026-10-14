// The speaking exams Talk Show runs as mock tests (docs/talk-show.md): their parts, timings,
// examiner lines and mark sheets. Shared by the game, the topic form and the ✨ AI dialog.
import { CefrLevel, SPEAKING_EXAM_IDS, SpeakingExam } from './db.model';

/** The kinds of speaking task (a part's heading tag: `# TAG title`). */
export const SPEAKING_TASK_TYPES = ['POINT', 'ASK', 'PICTURE', 'DIFF', 'STORY', 'ODD', 'INFO', 'PHOTO', 'DECIDE', 'CUE', 'DISCUSS'] as const;
export type SpeakingTaskType = typeof SPEAKING_TASK_TYPES[number];

export type SpeakingCriterion =
  | 'grammarVocab' | 'pronunciation' | 'interaction' | 'discourse' | 'global'
  | 'fluency' | 'lexical' | 'grammar';

export type SpeakingScoreStyle = 'shields' | 'cambridge' | 'ielts';

export interface SpeakingExamProfile {
  id: SpeakingExam;
  /** The exam's English name (exam names are not translated). */
  name: string;
  short: string;
  /** Stored on the topic for reading speed and AI difficulty (Starters is pre-A1). */
  level: CefrLevel;
  /** The exam's parts, in order. */
  parts: SpeakingTaskType[];
  criteria: SpeakingCriterion[];
  scoreStyle: SpeakingScoreStyle;
  /** Lowest and highest mark per criterion. */
  scale: [number, number];
  /** Taken in pairs (two candidates). */
  paired: boolean;
  /** Young learners: brighter studio, simpler examiner lines. */
  young: boolean;
}

export const SPEAKING_EXAMS: Record<SpeakingExam, SpeakingExamProfile> = {
  starters: {
    id: 'starters', name: 'Pre A1 Starters', short: 'Starters', level: 'A1',
    parts: ['POINT', 'PICTURE', 'ASK'],
    criteria: ['grammarVocab', 'pronunciation', 'interaction'], scoreStyle: 'shields', scale: [1, 5],
    paired: false, young: true
  },
  movers: {
    id: 'movers', name: 'A1 Movers', short: 'Movers', level: 'A1',
    parts: ['DIFF', 'STORY', 'ODD', 'ASK'],
    criteria: ['grammarVocab', 'pronunciation', 'interaction'], scoreStyle: 'shields', scale: [1, 5],
    paired: false, young: true
  },
  flyers: {
    id: 'flyers', name: 'A2 Flyers', short: 'Flyers', level: 'A2',
    parts: ['DIFF', 'INFO', 'STORY', 'ASK'],
    criteria: ['grammarVocab', 'pronunciation', 'interaction'], scoreStyle: 'shields', scale: [1, 5],
    paired: false, young: true
  },
  ket: {
    id: 'ket', name: 'A2 Key (KET)', short: 'KET', level: 'A2',
    parts: ['ASK', 'DECIDE'],
    criteria: ['grammarVocab', 'pronunciation', 'interaction', 'global'], scoreStyle: 'cambridge', scale: [0, 5],
    paired: true, young: false
  },
  pet: {
    id: 'pet', name: 'B1 Preliminary (PET)', short: 'PET', level: 'B1',
    parts: ['ASK', 'PHOTO', 'DECIDE', 'DISCUSS'],
    criteria: ['grammarVocab', 'discourse', 'pronunciation', 'interaction', 'global'], scoreStyle: 'cambridge', scale: [0, 5],
    paired: true, young: false
  },
  ielts: {
    id: 'ielts', name: 'IELTS Speaking', short: 'IELTS', level: 'B2',
    parts: ['ASK', 'CUE', 'DISCUSS'],
    criteria: ['fluency', 'lexical', 'grammar', 'pronunciation'], scoreStyle: 'ielts', scale: [1, 9],
    paired: false, young: false
  }
};

export const SPEAKING_EXAM_LIST: SpeakingExamProfile[] = SPEAKING_EXAM_IDS.map(id => SPEAKING_EXAMS[id]);

/** The exam a topic without one is played as: the usual exam for its level. */
export function examForLevel(level: CefrLevel | undefined | null): SpeakingExam {
  switch (level) {
    case 'A1': return 'movers';
    case 'A2': return 'ket';
    case 'B1': return 'pet';
    case 'B2': case 'C1': case 'C2': return 'ielts';
    default: return 'ket';
  }
}

export function isSpeakingTaskType(value: string): value is SpeakingTaskType {
  return (SPEAKING_TASK_TYPES as readonly string[]).includes(value);
}

/** Seconds the candidate has for one turn (the timer is soft: the teacher moves on). */
export function turnSeconds(exam: SpeakingExam, type: SpeakingTaskType): number {
  const profile = SPEAKING_EXAMS[exam];
  const ielts = exam === 'ielts';
  switch (type) {
    case 'POINT': return 15;
    case 'ASK': return profile.young ? 15 : ielts ? 30 : exam === 'pet' ? 25 : 20;
    case 'PICTURE': return 15;
    case 'DIFF': return 90;
    case 'STORY': return 90;
    case 'ODD': return 25;
    case 'INFO': return 20;
    case 'PHOTO': return 60;
    case 'DECIDE': return exam === 'pet' ? 150 : 120;
    case 'CUE': return ielts ? 120 : 60;
    case 'DISCUSS': return ielts ? 50 : 40;
  }
}

/** How many questions / pictures / sets the ✨ AI makes for a part by default (like the real exam). */
export function defaultPartCount(exam: SpeakingExam, type: SpeakingTaskType): number {
  switch (type) {
    case 'ASK': return SPEAKING_EXAMS[exam].young ? 5 : 6;
    case 'STORY': return exam === 'flyers' ? 5 : 4;
    case 'ODD': return 3;
    case 'PHOTO': return SPEAKING_EXAMS[exam].paired ? 2 : 1;
    case 'CUE': return 1;
    default: return 5;
  }
}

/** Cue card preparation time. */
export function prepSeconds(exam: SpeakingExam): number {
  return exam === 'ielts' ? 60 : 30;
}

/**
 * What the examiner says when a part starts (English: it is the exam's language). `title` is
 * the part's own title when the examiner names it ("Now let's talk about {title}.").
 */
export function examinerIntro(exam: SpeakingExam, type: SpeakingTaskType, title = ''): string {
  const young = SPEAKING_EXAMS[exam].young;
  const about = title ? ` about ${title.replace(/[.?!]+$/, '')}` : '';
  switch (type) {
    case 'POINT':
      return 'Look at this picture. I\'m going to ask you to point to some things. Then you put some cards on the picture.';
    case 'ASK':
      if (exam === 'ielts') return `In this first part, I'd like to ask you some questions${about || ' about yourself'}.`;
      return young ? `Now let's talk${about || ' about you'}.` : `Now, I'd like to ask you some questions${about || ' about yourself'}.`;
    case 'PICTURE':
      return 'Look at this picture. Now answer my questions.';
    case 'DIFF':
      return 'Here are two pictures. They are different. I\'m going to say something about this picture. You tell me how your picture is different.';
    case 'STORY':
      return 'These pictures tell a story. Just look at the pictures first. I\'ll start the story, and then you tell the story.';
    case 'ODD':
      return 'Now look at these. One is different. Which one is different? Why?';
    case 'INFO':
      return `I don't know anything${about || ' about this'}, but you know. So I'm going to ask you some questions. Then you ask me some questions.`;
    case 'PHOTO':
      return 'Now, I\'d like you to talk on your own about a photograph. I\'m going to give you a photograph. Please tell me what you can see in the photograph.';
    case 'DECIDE':
      return `Now, in this part of the test you are going to talk together${about}. Here are some pictures that show different ideas. Talk together about them.`;
    case 'CUE':
      return 'Now I\'m going to give you a topic, and I\'d like you to talk about it for one to two minutes. Before you talk, you\'ll have one minute to think about what you\'re going to say. You can make some notes if you wish.';
    case 'DISCUSS':
      return exam === 'ielts'
        ? `We've been talking${about || ' about this topic'}, and I'd like to discuss with you one or two more general questions related to this.`
        : `Now, let's talk${about || ' about this topic'} a little more.`;
  }
}

/** The examiner's last words. */
export function examinerClosing(exam: SpeakingExam): string {
  if (SPEAKING_EXAMS[exam].young) return 'Thank you. Goodbye!';
  return exam === 'ielts' ? 'Thank you. That is the end of the speaking test.' : 'Thank you. That is the end of the test.';
}

/** The usual default task line for a turn that has no text of its own. */
export function defaultTurnPrompt(type: SpeakingTaskType): string {
  switch (type) {
    case 'POINT': return 'Point to it.';
    case 'PHOTO': return 'Tell me what you can see in the photograph.';
    case 'STORY': return 'Now you tell the story.';
    case 'ODD': return 'Which one is different? Why?';
    case 'DIFF': return 'How is your picture different?';
    default: return '';
  }
}

/**
 * One candidate's overall result from their marks: shields 1-5 (young learners), the total out of
 * the maximum (Cambridge), or the IELTS band (the mean rounded to the nearest half band).
 */
export function overallScore(exam: SpeakingExam, marks: readonly (number | null)[]): number | null {
  const given = marks.filter((mark): mark is number => typeof mark === 'number');
  if (!given.length) return null;
  const mean = given.reduce((sum, mark) => sum + mark, 0) / given.length;
  switch (SPEAKING_EXAMS[exam].scoreStyle) {
    case 'shields': return Math.max(1, Math.min(5, Math.round(mean)));
    case 'ielts': return Math.round(mean * 2) / 2;
    case 'cambridge': return given.reduce((sum, mark) => sum + mark, 0);
  }
}
