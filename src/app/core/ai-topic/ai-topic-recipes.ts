// The ready-made tasks behind the ✨ AI dialog's chips (docs/lesson-pack.md §5). A chip shows and
// pastes a short prompt the teacher can edit; its `instructions` are the expert rules the AI gets
// on top, so a teacher who clicks "Gap-fill" gets a well-made gap-fill topic without having to
// know how to ask for one. The lesson pack's four boxes reuse the same recipes.

export type AiRecipeId = 'pages' | 'gapFill' | 'qa' | 'pictures' | 'opposites' | 'sentences' | 'writing' | 'reading';

export interface AiTopicRecipe {
  id: AiRecipeId;
  icon: string;
  labelKey: string;
  promptKey: string;
  /** Sent to the AI with the request; English, like the rest of the instructions. */
  instructions: string;
}

// Shared by the two text recipes: a text has to come from somewhere.
const WRITE_TEXT_IF_MISSING = (what: string, shape: string) =>
  `If neither the attached pages nor the teacher's request contain ${what}, WRITE one yourself: ${shape}, ` +
  `at the given level, on the theme of the pages (or the request), using the unit's words and grammar. ` +
  `Then add a note in the teacher's language saying the text was written by AI and should be checked.`;

export const AI_TOPIC_RECIPES: AiTopicRecipe[] = [
  {
    id: 'pages',
    icon: '📷',
    labelKey: 'aiTopicChipPages',
    promptKey: 'aiTopicChipPagesPrompt',
    instructions: [
      'Vocabulary topic: one item per word or fixed phrase that students should LEARN in this unit.',
      'From pages: take the target vocabulary - word lists, words in bold or coloured boxes, labelled pictures and the key words of the exercises. Leave out grammar words, names, numbers and words that only appear in exercise instructions.',
      'Without pages: the 10-15 most useful words for the theme at the given level.',
      'text = the word or phrase as the book spells it, no sentences, no articles unless the book uses them. audioText = the same word.',
      'Give every word that can be pictured a picture ("pageCrop" when its own picture is on a page, otherwise "search"); "wordCard" only for words that cannot be pictured.'
    ].join('\n')
  },
  {
    id: 'gapFill',
    icon: '✏️',
    labelKey: 'aiTopicChipGapFill',
    promptKey: 'aiTopicChipGapFillPrompt',
    instructions: [
      'Gap-fill topic: one item per target word (from the pages when given).',
      'text = one short, natural sentence (6-12 words) with that word replaced by "____". Exactly one gap per sentence.',
      'The sentence must make the missing word the ONLY sensible answer (give a clear clue: a collocation, an opposite, a definition-like context). Never blank an article, a name or a word that many others could replace.',
      'Use the unit\'s words and grammar. imageKind = "wordCard", imageQuery = the missing word exactly as it fits the gap. audioText = the full sentence with the word.'
    ].join('\n')
  },
  {
    id: 'qa',
    icon: '❓',
    labelKey: 'aiTopicChipQa',
    promptKey: 'aiTopicChipQaPrompt',
    instructions: [
      'Questions and answers topic.',
      'text = a question (max 12 words, ending with "?"). With pages, every question must be answerable from the pages; without pages, from general knowledge of the theme at the given level.',
      'The answer is 1-4 words and is the image: a "search" picture when the answer can be pictured clearly, otherwise "wordCard" with the answer.',
      'Mix question words (what, where, when, who, why, how). audioText = the question.'
    ].join('\n')
  },
  {
    id: 'pictures',
    icon: '🖼️',
    labelKey: 'aiTopicChipPictures',
    promptKey: 'aiTopicChipPicturesPrompt',
    instructions: [
      'Picture-guessing topic: students see only the picture and say the word.',
      'Use ONLY words one clear picture can show (objects, animals, food, places, clear actions). Leave out abstract words instead of giving them a random picture.',
      'text = "", imageKind = "pageCrop" or "search" (never "wordCard" or "none"), audioText = the word.'
    ].join('\n')
  },
  {
    id: 'opposites',
    icon: '🔤',
    labelKey: 'aiTopicChipOpposites',
    promptKey: 'aiTopicChipOppositesPrompt',
    instructions: [
      'Opposites topic: real pairs of opposites (hot / cold), from the unit when pages are given, otherwise common at the given level.',
      'Each word is its own item and the two words of a pair come directly one after the other. Both words of a pair are the same word type. An even number of items, no word in two pairs.',
      'Picture each word when it can be pictured, otherwise "wordCard". audioText = the word.'
    ].join('\n')
  },
  {
    id: 'sentences',
    icon: '🧩',
    labelKey: 'aiTopicChipSentences',
    promptKey: 'aiTopicChipSentencesPrompt',
    instructions: [
      'Sentences topic for putting words back in order (Unjumble, Team Sentence).',
      'text = a full sentence of 5-9 words using the unit\'s words and grammar (from the pages when given), starting with a capital letter and ending with ".", "?" or "!".',
      'Every sentence must have only ONE natural word order: avoid time phrases and adverbs that could also stand elsewhere ("Yesterday I ..." / "I ... yesterday") and lists whose items could swap.',
      'audioText = the sentence. Image: a "search" picture of the sentence\'s scene when one clearly shows it, otherwise "none".'
    ].join('\n')
  },
  {
    id: 'writing',
    icon: '📓',
    labelKey: 'aiTopicChipWriting',
    promptKey: 'aiTopicChipWritingPrompt',
    instructions: [
      'Writing Workshop topic: follow the "model text" example of the instructions exactly.',
      'Use the model text given by the teacher, or the writing section\'s model or example text on the pages.',
      WRITE_TEXT_IF_MISSING('such a text', '2-3 paragraphs, 8-12 sentences in all, the kind of text the unit asks students to write')
    ].join('\n')
  },
  {
    id: 'reading',
    icon: '📖',
    labelKey: 'aiTopicChipReading',
    promptKey: 'aiTopicChipReadingPrompt',
    instructions: [
      'Reading Detective topic: follow the "reading text" example of the instructions exactly.',
      'Use the reading text given by the teacher, or the main reading text on the pages.',
      WRITE_TEXT_IF_MISSING('a reading text', '3-5 paragraphs, like an exam reading text')
    ].join('\n')
  }
];

export function findRecipe(id: string | null | undefined): AiTopicRecipe | undefined {
  return AI_TOPIC_RECIPES.find(recipe => recipe.id === id);
}

// ---- Lesson pack: one topic per box ----

export type LessonPackBoxId = 'vocabulary' | 'sentences' | 'reading' | 'writing';

export interface LessonPackBox {
  id: LessonPackBoxId;
  icon: string;
  labelKey: string;
  recipe: AiRecipeId;
}

export const LESSON_PACK_BOXES: LessonPackBox[] = [
  { id: 'vocabulary', icon: '📷', labelKey: 'aiPackVocabulary', recipe: 'pages' },
  { id: 'sentences', icon: '🧩', labelKey: 'aiPackSentences', recipe: 'sentences' },
  { id: 'reading', icon: '📖', labelKey: 'aiPackReading', recipe: 'reading' },
  { id: 'writing', icon: '📓', labelKey: 'aiPackWriting', recipe: 'writing' }
];

