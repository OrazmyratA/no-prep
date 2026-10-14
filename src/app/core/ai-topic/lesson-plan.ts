import { AiCropBox, normalizeCropBox, parseJsonLoosely } from './ai-topic-draft';
import { AiRecipeId, AiRecipeVariantId, findRecipe } from './ai-topic-recipes';
import { CEFR_LEVELS, CefrLevel, SPEAKING_EXAM_IDS, SpeakingExam } from '../db.model';

// The AI lesson planner's "Analyse" (docs/ai-lesson-planner.md §3, §8 phase 1): one AI call reads
// the book pages and the class details and returns the lesson plan - the sections of the pages
// (with their place on the page, for the game icons), objectives, stages and the fewest topics
// needed. Nothing is generated yet. Sent through the topic-draft IPC, like the Talk Show analysis.

export type LessonSkill = 'vocabulary' | 'grammar' | 'reading' | 'writing' | 'speaking';
export const LESSON_SKILLS: LessonSkill[] = ['vocabulary', 'grammar', 'reading', 'writing', 'speaking'];

/** PPP; pre / while / post reading; model → analyse → write; input → practise → fluency. */
export type LessonShape = 'ppp' | 'reading' | 'writing' | 'speaking';
export const LESSON_SHAPES: LessonShape[] = ['ppp', 'reading', 'writing', 'speaking'];

export type LessonInteraction = 'teacher' | 'individual' | 'pairs' | 'groups' | 'teams';
export const LESSON_INTERACTIONS: LessonInteraction[] = ['teacher', 'individual', 'pairs', 'groups', 'teams'];

/** The class the lesson is for. No student names. */
export interface LessonClass {
  level: CefrLevel | null;
  /** e.g. "10-11" or "adults". */
  age: string;
  minutes: number;
  students: number;
  /** The students' first language, e.g. "Turkmen". */
  firstLanguage: string;
}

export interface LessonPlanRequest {
  /** The book's page numbers of the attached page photos, in order (for "p. 54" in the plan). */
  pageNumbers: number[];
  klass: LessonClass;
  goal: string;
  /** Language name the plan is written in (the app language, or English). */
  planLanguage: string;
  /** Re-plan: the plan so far and what to change. */
  previous?: LessonPlan | null;
  change?: string;
}

/** One part of the pages (an exercise, a word box, a text...) with its place on its page. */
export interface LessonSection {
  id: string;
  /** 0-based index into the attached page photos. */
  page: number;
  /** Fractions of the page; null when the AI gave no usable box. */
  box: AiCropBox | null;
  skill: LessonSkill;
  title: string;
  /** The words, grammar point or text this section teaches. */
  focus: string;
  /** The topic its game icon plays, or null for a section without an icon. */
  topicId: string | null;
  /** The games the icon offers (2-4 when the topic's shape has that many). */
  games: string[];
}

/** One topic to generate: a set of cards of one shape. */
export interface LessonTopic {
  id: string;
  name: string;
  recipe: AiRecipeId;
  variant: AiRecipeVariantId | null;
  /** Extra request text for this topic (which words / grammar / text). */
  focus: string;
  /** Speaking topics only: the mock exam. */
  exam: SpeakingExam | null;
}

export interface LessonStage {
  minutes: number;
  name: string;
  /** What the teacher and students do. */
  activity: string;
  /** The game played at this stage, when one is. */
  gameId: string | null;
  sectionId: string | null;
  interaction: LessonInteraction;
  purpose: string;
}

export interface LessonPlan {
  unit: string;
  level: CefrLevel | null;
  shape: LessonShape;
  shapeReason: string;
  objectives: string[];
  vocabulary: string[];
  grammar: string;
  sections: LessonSection[];
  topics: LessonTopic[];
  stages: LessonStage[];
  stronger: string;
  weaker: string;
  assessment: string;
  homework: string;
  notes: string[];
}

export const LESSON_PLAN_PROMPT_VERSION = 1;

/** Topic shapes the planner may ask for. */
export const LESSON_PLAN_RECIPES: AiRecipeId[] = [
  'pages', 'opposites', 'definitions', 'translation', 'synonyms', 'verbForms', 'collocations',
  'gapFill', 'qa', 'sentences', 'reading', 'writing', 'speaking'
];

// Every game the planner may put on an icon, with a line for the AI. Ids match games.config.ts
// (checked by the spec); core does not import from features.
export const LESSON_PLAN_GAMES: { id: string; about: string }[] = [
  { id: 'flip-tiles', about: 'teacher flips picture/word tiles one by one - presenting and drilling new words' },
  { id: 'match-pairs', about: 'memory game matching the two sides of each card' },
  { id: 'watch-memorize', about: 'cards scroll past, the class recalls them - memory and revision' },
  { id: 'spotlight', about: 'a torch reveals hidden cards on a dark board - guessing, warm-up' },
  { id: 'spin-wheel', about: 'spin a wheel of cards and answer the one it lands on - warm-up, quick revision' },
  { id: 'reveal-game', about: 'a picture appears square by square, guess it early - warm-up' },
  { id: 'pop-balloon', about: 'teams answer card questions to pop balloons - competitive practice' },
  { id: 'test-abc', about: 'multiple-choice quiz matching words and cards - checking understanding' },
  { id: 'anagram', about: 'unscramble the letters of the word - spelling' },
  { id: 'tracing', about: 'trace the missing letters of the word - spelling for young learners' },
  { id: 'word-search', about: 'find the words in a letter grid - spelling, calm practice' },
  { id: 'line-trace-match', about: 'draw lines from words to their cards - matching meaning' },
  { id: 'spelling-check', about: 'find the missing letter or word - spelling and accuracy' },
  { id: 'team-tug', about: 'two teams race to pick the right word - fast competitive practice' },
  { id: 'cup-clash', about: 'board game with dice, answer to capture cups - team practice' },
  { id: 'odd-one-out', about: 'find the card that does not belong - word groups' },
  { id: 'squid-game', about: 'red light / green light race with quiz questions - energetic team practice' },
  { id: 'rock-paper-scissors', about: 'team duel with quiz questions - energetic team practice' },
  { id: 'ball-sort', about: 'sort cards by coloured balls with quiz gates - team practice' },
  { id: 'flashcard-hunt', about: 'shoot flashcards on the board, then answer them - energetic recall' },
  { id: 'unjumble', about: 'drag words into the right order to build sentences - grammar and word order' },
  { id: 'team-sentence', about: 'teams race to build correct sentences - grammar, competitive' },
  { id: 'reading-detective', about: 'reading lesson: key words, find the answers in the text, match paragraph headings' },
  { id: 'writing-workshop', about: 'writing lesson: rebuild a model text paragraph by paragraph, then write' },
  { id: 'talk-show', about: 'speaking mock exam with examiner lines, timers and a mark sheet' }
];

const PICTURE_WORD_GAMES = [
  'flip-tiles', 'match-pairs', 'watch-memorize', 'spotlight', 'spin-wheel', 'reveal-game', 'pop-balloon', 'test-abc',
  'anagram', 'tracing', 'word-search', 'line-trace-match', 'spelling-check', 'team-tug', 'cup-clash', 'odd-one-out',
  'squid-game', 'rock-paper-scissors', 'ball-sort', 'flashcard-hunt'
];
/** Word on one side, a text card (definition, translation, gapped sentence...) on the other. */
const WORD_CARD_GAMES = [
  'match-pairs', 'test-abc', 'line-trace-match', 'team-tug', 'flashcard-hunt', 'spin-wheel', 'flip-tiles', 'pop-balloon',
  'anagram', 'spelling-check', 'cup-clash', 'squid-game', 'rock-paper-scissors', 'ball-sort'
];
/** Spelling games need a single word as the text, not a sentence. */
const SPELLING_GAMES = ['anagram', 'tracing', 'word-search', 'spelling-check'];

/** The games that can play a topic of this shape, best first. */
export function gamesForRecipe(recipe: AiRecipeId, variant: AiRecipeVariantId | null = null): string[] {
  switch (recipe) {
    case 'pages': return PICTURE_WORD_GAMES;
    case 'opposites': return ['match-pairs', 'line-trace-match', 'test-abc', 'team-tug', 'flashcard-hunt', 'flip-tiles'];
    case 'definitions': case 'translation': case 'synonyms': case 'verbForms': case 'collocations':
      return WORD_CARD_GAMES;
    case 'gapFill': case 'qa': {
      const fallback = findRecipe(recipe)?.defaultVariant ?? 'findWord';
      return (variant ?? fallback) === 'findWord' ? WORD_CARD_GAMES : WORD_CARD_GAMES.filter(id => !SPELLING_GAMES.includes(id));
    }
    case 'sentences': return ['unjumble', 'team-sentence'];
    case 'reading': return ['reading-detective'];
    case 'writing': return ['writing-workshop'];
    case 'speaking': return ['talk-show'];
    default: return [];
  }
}

const MAX_SECTIONS = 10;
const MAX_TOPICS = 6;
const MAX_STAGES = 12;
/** A section box smaller than this (in either direction) is treated as no box. */
const MIN_BOX = 0.02;

export const LESSON_PLAN_SCHEMA = {
  type: 'object',
  properties: {
    unit: { type: 'string' },
    level: { type: 'string', enum: [...CEFR_LEVELS, 'unknown'] },
    shape: { type: 'string', enum: LESSON_SHAPES },
    shapeReason: { type: 'string' },
    objectives: { type: 'array', items: { type: 'string' } },
    vocabulary: { type: 'array', items: { type: 'string' } },
    grammar: { type: 'string' },
    sections: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          page: { type: 'integer' },
          box: { type: 'array', items: { type: 'number' } },
          skill: { type: 'string', enum: LESSON_SKILLS },
          title: { type: 'string' },
          focus: { type: 'string' },
          topic: { type: 'string' },
          games: { type: 'array', items: { type: 'string' } }
        },
        required: ['id', 'page', 'box', 'skill', 'title', 'focus', 'topic', 'games'],
        additionalProperties: false
      }
    },
    topics: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          name: { type: 'string' },
          recipe: { type: 'string', enum: LESSON_PLAN_RECIPES },
          variant: { type: 'string', enum: ['findWord', 'findCard', 'none'] },
          focus: { type: 'string' },
          exam: { type: 'string', enum: [...SPEAKING_EXAM_IDS, 'none'] }
        },
        required: ['id', 'name', 'recipe', 'variant', 'focus', 'exam'],
        additionalProperties: false
      }
    },
    stages: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          minutes: { type: 'integer' },
          name: { type: 'string' },
          activity: { type: 'string' },
          game: { type: 'string' },
          section: { type: 'string' },
          interaction: { type: 'string', enum: LESSON_INTERACTIONS },
          purpose: { type: 'string' }
        },
        required: ['minutes', 'name', 'activity', 'game', 'section', 'interaction', 'purpose'],
        additionalProperties: false
      }
    },
    stronger: { type: 'string' },
    weaker: { type: 'string' },
    assessment: { type: 'string' },
    homework: { type: 'string' },
    notes: { type: 'array', items: { type: 'string' } }
  },
  required: [
    'unit', 'level', 'shape', 'shapeReason', 'objectives', 'vocabulary', 'grammar', 'sections', 'topics', 'stages',
    'stronger', 'weaker', 'assessment', 'homework', 'notes'
  ],
  additionalProperties: false
};

export function buildLessonPlanSystemPrompt(): string {
  const recipes = LESSON_PLAN_RECIPES.map(id => {
    const games = gamesForRecipe(id);
    return `- ${id}: ${RECIPE_ABOUT[id]} Games: ${games.join(', ')}.`;
  });
  return `
You are an experienced English teacher trainer (CELTA / DELTA) helping a teacher plan one lesson from coursebook pages in NoPrep, a classroom games app. You get photos of the pages and the class details. Read the pages carefully and write a practical lesson plan. Do not create the game content itself - the app does that later from your topics.

1. SECTIONS: split the pages into the parts a teacher would teach (a vocabulary box, a grammar box, a reading text, a writing task, a speaking task, an exercise). For each:
- "page": the 0-based index of the attached photo it is on; "box": [ymin, xmin, ymax, xmax] on that photo, 0-1000, around the whole part (exercise number and title included);
- "skill": vocabulary, grammar, reading, writing or speaking; "title": short, as the book names it ("Ex. 2 Food words"); "focus": the target words, grammar point or text it teaches, taken from the page;
- "topic": the id of the topic its game icon plays, or "" when a game does not suit it (for example a short discussion or a listening exercise);
- "games": 2-4 games from that topic's list that best fit the section's purpose (fewer only when the list is shorter). Put the best one first.
Leave out decorations, page headers and parts that are not for this lesson.

2. TOPICS: the FEWEST topics the lesson needs - about 5 at most. A topic is a set of cards of one shape, and every game in its list plays it, so several sections that practise the same words share ONE topic (for example the vocabulary box and the picture exercise). Topic shapes ("recipe"):
${recipes.join('\n')}
- "name": "<unit> · <what>" in the plan language, e.g. "Unit 5 · Food words";
- "focus": one or two sentences saying exactly which words, grammar or text from the pages the topic must use;
- "variant": for gapFill and qa only, "findWord" (students produce the word) or "findCard" (students find the matching card); otherwise "none";
- "exam": for speaking only, the closest mock exam for the level (starters, movers, flyers, ket, pet, ielts); otherwise "none".

3. THE PLAN:
- "shape": pick the lesson shape that fits the pages and say why in "shapeReason" (one sentence): "ppp" (present - practise - produce, for vocabulary and grammar), "reading" (pre - while - post reading), "writing" (model - analyse - write), "speaking" (input - practise - fluency);
- "objectives": 2-4, each starting "Students can..." (plan language), measurable;
- "vocabulary": the target words and phrases (as the book spells them); "grammar": the grammar point, or "";
- "stages": in order, with "minutes" that add up to the lesson length exactly. Each stage: "name" (Warm-up, Presentation, Controlled practice, Freer practice, Pre-reading, ... Wrap-up), "activity" (one or two sentences: what the teacher and students do, including book exercises), "game" (the game played, from that section's games, or ""), "section" (the section id it uses, or ""), "interaction", "purpose" (a few words). Use games where they help - not in every stage - and include at least one stage where students use the language freely;
- "stronger" / "weaker": one concrete idea each for differentiation; "assessment": how the teacher checks the objectives (games' first-try scores, an exit task...); "homework": one short task, or "".
- "notes": only what the teacher must know or do (a page you could not read, a part you skipped), one short sentence each, or []. Never write about photo indexes or page numbers: the app's page numbers often differ from the numbers printed on the pages, and that is normal.

Fit the level, the age and the class size (pair and group work for big classes, short stages for young learners). Write every text in the plan language, except words, sentences and titles quoted from the book, which stay as printed. Everything must be appropriate for school children.
When you get an earlier plan and a change, return the whole plan again with the change made, keeping the rest unless the change affects it.

Answer with the JSON object only.
`.trim();
}

const RECIPE_ABOUT: Record<AiRecipeId, string> = {
  pages: 'vocabulary: one card per target word with its picture.',
  pictures: 'picture-only cards.',
  opposites: 'pairs of opposite words.',
  definitions: 'word + simple definition.',
  translation: 'word + translation into the students\' first language.',
  synonyms: 'word + synonym.',
  verbForms: 'irregular verbs: past form + base form.',
  collocations: 'word partners with a gap ("___ your homework").',
  listenSpell: 'dictation of words.',
  gapFill: 'grammar or vocabulary gap-fill sentences with one missing word.',
  qa: 'questions with short answers (comprehension or grammar).',
  sentences: 'whole sentences using the unit\'s grammar, to put back in order.',
  reading: 'the reading text with key words, questions and paragraph headings.',
  writing: 'a model text for the writing task, rebuilt paragraph by paragraph.',
  speaking: 'a speaking mock exam (interview, pictures, discussion) on the unit\'s theme.'
};

export function buildLessonPlanUserText(request: LessonPlanRequest): string {
  const k = request.klass;
  const lines = [
    `Plan language: ${request.planLanguage}`,
    `Attached page photos: ${request.pageNumbers.length} (${request.pageNumbers.map((n, i) => `photo ${i} = page ${n} in the app`).join(', ')}; the numbers printed on the pages may differ)`,
    `Level: ${k.level ?? 'not given - judge from the pages'}`,
    `Age: ${k.age.trim() || 'not given'}`,
    `Lesson length: ${k.minutes} minutes`,
    `Students: ${k.students || 'not given'}`,
    `Students' first language: ${k.firstLanguage.trim() || 'not given'}`,
    `Teacher's goal: ${request.goal.trim() || 'none - follow the pages'}`
  ];
  if (request.previous) {
    lines.push('', 'Earlier plan (JSON):', JSON.stringify(toAiShape(request.previous)));
    lines.push('', `Change to make: ${request.change?.trim() || 'improve it'}`);
  }
  return lines.join('\n');
}

/** The plan in the schema's shape, for a re-plan. */
function toAiShape(plan: LessonPlan): unknown {
  return {
    ...plan,
    level: plan.level ?? 'unknown',
    sections: plan.sections.map(s => ({
      id: s.id, page: s.page, skill: s.skill, title: s.title, focus: s.focus, topic: s.topicId ?? '', games: s.games,
      box: s.box ? [s.box.y, s.box.x, s.box.y + s.box.height, s.box.x + s.box.width].map(n => Math.round(n * 1000)) : []
    })),
    topics: plan.topics.map(t => ({ ...t, variant: t.variant ?? 'none', exam: t.exam ?? 'none' })),
    stages: plan.stages.map(s => ({
      minutes: s.minutes, name: s.name, activity: s.activity, game: s.gameId ?? '', section: s.sectionId ?? '',
      interaction: s.interaction, purpose: s.purpose
    }))
  };
}

function text(value: unknown, max: number): string {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, max) : '';
}

function list(value: unknown, maxItems: number, maxLength: number): string[] {
  return (Array.isArray(value) ? value : []).map(v => text(v, maxLength)).filter(Boolean).slice(0, maxItems);
}

function pick<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return allowed.includes(value as T) ? value as T : fallback;
}

function objects(value: unknown): Record<string, unknown>[] {
  return (Array.isArray(value) ? value : []).filter((v): v is Record<string, unknown> => !!v && typeof v === 'object');
}

/**
 * Reads the AI's plan for `pageCount` attached pages. Ids are renumbered (s1, t1...), links to
 * missing sections, topics or games are dropped, games are kept to the ones the topic's shape can
 * play, and unused topics are removed. Throws when there is no plan to show.
 */
export function parseLessonPlan(raw: string | unknown, pageCount: number): LessonPlan {
  const data = typeof raw === 'string' ? parseJsonLoosely(raw) : raw;
  if (!data || typeof data !== 'object') throw new Error('invalid-plan');
  const d = data as Record<string, unknown>;

  // Topics first: sections and stages point at them.
  const topicIds = new Map<string, string>();
  const topics: LessonTopic[] = [];
  for (const t of objects(d['topics'])) {
    if (topics.length >= MAX_TOPICS) break;
    const recipe = t['recipe'] as AiRecipeId;
    if (!LESSON_PLAN_RECIPES.includes(recipe)) continue;
    const id = `t${topics.length + 1}`;
    const rawId = text(t['id'], 40);
    if (rawId && !topicIds.has(rawId)) topicIds.set(rawId, id);
    const hasVariants = !!findRecipe(recipe)?.variants;
    topics.push({
      id,
      name: text(t['name'], 80),
      recipe,
      variant: hasVariants ? pick<AiRecipeVariantId>(t['variant'], ['findWord', 'findCard'], findRecipe(recipe)!.defaultVariant ?? 'findWord') : null,
      focus: text(t['focus'], 600),
      exam: recipe === 'speaking' ? pick<SpeakingExam>(t['exam'], SPEAKING_EXAM_IDS, 'ket') : null
    });
  }

  const sectionIds = new Map<string, string>();
  const sections: LessonSection[] = [];
  for (const s of objects(d['sections'])) {
    if (sections.length >= MAX_SECTIONS) break;
    const page = Math.trunc(Number(s['page']));
    if (!Number.isFinite(page) || page < 0 || page >= pageCount) continue;
    const id = `s${sections.length + 1}`;
    const rawId = text(s['id'], 40);
    if (rawId && !sectionIds.has(rawId)) sectionIds.set(rawId, id);
    const box = normalizeCropBox(s['box']);
    const topicId = topicIds.get(text(s['topic'], 40)) ?? null;
    const topic = topics.find(t => t.id === topicId);
    const playable = topic ? gamesForRecipe(topic.recipe, topic.variant) : [];
    const games = [...new Set(list(s['games'], 8, 40))].filter(id => playable.includes(id)).slice(0, 4);
    sections.push({
      id,
      page,
      box: box.width >= MIN_BOX && box.height >= MIN_BOX ? box : null,
      skill: pick(s['skill'], LESSON_SKILLS, 'vocabulary'),
      title: text(s['title'], 80),
      focus: text(s['focus'], 400),
      topicId: topic ? topic.id : null,
      // A topic always offers something: its best games when the AI's picks were unusable.
      games: topic ? (games.length ? games : playable.slice(0, Math.min(3, playable.length))) : []
    });
  }

  const gameIds = LESSON_PLAN_GAMES.map(g => g.id);
  const stages: LessonStage[] = objects(d['stages']).slice(0, MAX_STAGES).map(s => {
    const sectionId = sectionIds.get(text(s['section'], 40)) ?? null;
    const game = text(s['game'], 40);
    return {
      minutes: Math.max(1, Math.min(120, Math.round(Number(s['minutes']) || 5))),
      name: text(s['name'], 60),
      activity: text(s['activity'], 500),
      gameId: gameIds.includes(game) ? game : null,
      sectionId,
      interaction: pick(s['interaction'], LESSON_INTERACTIONS, 'teacher'),
      purpose: text(s['purpose'], 160)
    };
  }).filter(s => s.name || s.activity);

  // A topic no section plays is never generated.
  const used = new Set(sections.map(s => s.topicId).filter(Boolean));
  const keptTopics = topics.filter(t => used.has(t.id));

  if (!sections.length && !stages.length) throw new Error('empty-plan');
  const level = d['level'];
  return {
    unit: text(d['unit'], 80),
    level: CEFR_LEVELS.includes(level as CefrLevel) ? level as CefrLevel : null,
    shape: pick(d['shape'], LESSON_SHAPES, 'ppp'),
    shapeReason: text(d['shapeReason'], 240),
    objectives: list(d['objectives'], 5, 200),
    vocabulary: list(d['vocabulary'], 30, 60),
    grammar: text(d['grammar'], 160),
    sections,
    topics: keptTopics,
    stages,
    stronger: text(d['stronger'], 300),
    weaker: text(d['weaker'], 300),
    assessment: text(d['assessment'], 300),
    homework: text(d['homework'], 300),
    notes: list(d['notes'], 5, 300)
  };
}

/** Minutes in the plan's stages. */
export function planMinutes(plan: LessonPlan): number {
  return plan.stages.reduce((sum, stage) => sum + stage.minutes, 0);
}
