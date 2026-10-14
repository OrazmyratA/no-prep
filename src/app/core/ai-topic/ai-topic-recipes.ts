// The ready-made tasks behind the ✨ AI dialog's chips (docs/lesson-pack.md §5). A chip shows and
// pastes a short prompt the teacher can edit; its `instructions` are the expert rules the AI gets
// on top, so a teacher who clicks "Gap-fill" gets a well-made gap-fill topic without having to
// know how to ask for one. The lesson pack's four boxes reuse the same recipes.

export type AiRecipeId =
  | 'pages' | 'pictures' | 'opposites' | 'definitions' | 'translation' | 'synonyms' | 'verbForms' | 'collocations' | 'listenSpell'
  | 'gapFill' | 'qa' | 'sentences'
  | 'writing' | 'reading'
  | 'speaking';

/** The chip's heading in the dialog (the same words as the lesson pack boxes). */
export type AiRecipeGroup = 'vocabulary' | 'sentences' | 'texts' | 'speaking';

/**
 * Which side students get, for chips where the item's two sides can swap:
 * - findWord: the clue is on the card (picture), the text is the word to produce - spelling games
 *   (Anagram, Spelling Check, Word Search, Tracing) and Test ABC / Flashcard Hunt;
 * - findCard: the text is the clue, the answer is on the card - matching games.
 */
export type AiRecipeVariantId = 'findWord' | 'findCard';

export interface AiTopicRecipe {
  id: AiRecipeId;
  group: AiRecipeGroup;
  icon: string;
  labelKey: string;
  promptKey: string;
  /** Sent to the AI with the request; English, like the rest of the instructions. */
  instructions: string;
  /** Only for chips with two swappable sides; `defaultVariant` applies until the teacher picks one. */
  variants?: Record<AiRecipeVariantId, string>;
  defaultVariant?: AiRecipeVariantId;
}

export const AI_RECIPE_GROUPS: { id: AiRecipeGroup; labelKey: string }[] = [
  { id: 'vocabulary', labelKey: 'aiPackVocabulary' },
  { id: 'sentences', labelKey: 'aiPackSentences' },
  { id: 'texts', labelKey: 'aiChipGroupTexts' },
  { id: 'speaking', labelKey: 'aiChipGroupSpeaking' }
];

export const AI_RECIPE_VARIANTS: AiRecipeVariantId[] = ['findWord', 'findCard'];

// Shared by the two text recipes: a text has to come from somewhere.
const WRITE_TEXT_IF_MISSING = (what: string, shape: string) =>
  `If neither the attached pages nor the teacher's request contain ${what}, WRITE one yourself: ${shape}, ` +
  `at the given level, on the theme of the pages (or the request), using the unit's words and grammar. ` +
  `Then add a note in the teacher's language saying the text was written by AI and should be checked.`;

// Talk Show's speaking mock exam (docs/talk-show.md §2): the item shapes of every part.
const SPEAKING_TEST_RULES = [
  'Speaking test topic for Talk Show, a speaking mock exam (Cambridge Starters / Movers / Flyers, A2 Key, B1 Preliminary, IELTS). The request lists the parts to make, in order.',
  'Take the questions, pictures and tasks from the attached pages or the teacher\'s script when a part is marked "from the materials"; write a part yourself when it is marked "write it", like a real exam task at that level, on the theme of the materials or the request.',
  'Every part starts with ONE heading item: text = "# " + the part\'s TAG + a space + a short title (the theme, e.g. "# ASK Your free time"); imageKind = "none". Braces at the end of an item, "{a | b}", hold follow-up questions or answers (parts separated by "|"). "[ ]" around a word or phrase marks a POWER WORD: useful language the candidate should use.',
  'After each part\'s items, add ONE power-words item: text = 3-6 useful words or phrases for that part at the level, each in [ ] (e.g. "[I really enjoy] [because] [at the weekend]"), imageKind = "none".',
  'Item shapes per TAG:',
  '- POINT (Starters Part 1, point and place): first one item with text = "" and the big scene picture; then one item per instruction: "Where is the ball? Point to it." (imageKind = "none"), or an object-card instruction "Put the cat under the table." with that object\'s own picture. When the scene picture is a "pageCrop" from an attached page, end each instruction with its answer area in braces: "{@ymin,xmin,ymax,xmax}" - the box on that PAGE photo (0-1000, like imageBox) around the thing to point to, or around the place where the card should go. Without a page scene picture, no braces.',
  '- ASK (interview): one item per personal question, e.g. "What do you like doing at the weekend? {Why? | Who with?}" - 1-2 natural follow-ups in braces. imageKind = "none".',
  '- PICTURE (Starters picture questions): first one item with text = "" and the big scene picture; then one item per question about that scene ("How many birds are there? {three}" - the expected short answer in braces, imageKind = "none"); a question about an object card has the object\'s own picture.',
  '- DIFF (find the differences): two items with text = "" and the two similar pictures (first the examiner\'s, then the candidate\'s); then one item per difference: text = the examiner\'s sentence about the first picture, braces = the candidate\'s expected answer ("In my picture the cat is black. {In my picture the cat is white.}"), imageKind = "none".',
  '- STORY (picture story): one item per picture, in story order, each with its picture. The first item\'s text = the examiner\'s opening sentence ("Tom and Sue are at the park. They want to fly their kite."); the other items\' text = a short model sentence for that picture (a hint for the teacher). The heading braces may hold one question about the story.',
  '- ODD (odd one out): one item per set: text = four words separated by " | ", the odd one starting with "*", braces = the reason ("*bus | plane | bird | kite {The others can fly.}"). A picture showing the four things when one exists on the pages, otherwise imageKind = "none".',
  '- INFO (information exchange): first one item with text = "" and a picture of the candidate\'s card when there is one; then items the CANDIDATE asks with the examiner\'s answer in braces ("Where / go? {Paris}") and items the EXAMINER asks with no braces ("Who did you go with?").',
  '- PHOTO (describe a photo): one item per photo, text = "" (the app gives the task) or a short task line, with the photo as the picture.',
  '- DECIDE (discuss and decide): first one item with the central question and 1-2 follow-ups in braces ("Which is the best present for a friend? {Why? | Which is the worst?}"), imageKind = "none"; then one item per option: text = 1-3 words naming it, with its picture.',
  '- CUE (IELTS cue card): the heading title is the task ("# CUE Describe a place you have visited {Would you like to go back there?}" - the rounding-off question in braces); then one item per "You should say" point ("where it is", "when you went there", ..., "and explain why you liked it"), imageKind = "none".',
  '- DISCUSS (discussion): one item per deeper, more abstract question related to the earlier part, with a follow-up in braces when natural. imageKind = "none".',
  'Pictures: "pageCrop" when the exact picture is on an attached page, otherwise "search" with a clear imageQuery (imageStyle "illustration" for young learners\' scenes and stories). If the story pictures cannot come from the pages, add a note in the teacher\'s language that the stock pictures may not match each other and the book\'s pictures or "Generate a picture" work better.',
  'audioText = "" for every item: Talk Show reads the examiner\'s lines itself. Use simple, natural examiner English at the given level; for young learners short questions with one clear answer.'
].join('\n');

// Most vocabulary chips start from the same word list.
const TARGET_WORDS =
  'Words: the unit\'s target vocabulary from the pages when given (word lists, words in bold or coloured boxes, labelled pictures, the key words of the exercises); without pages, 10-15 useful words for the theme at the given level.';

export const AI_TOPIC_RECIPES: AiTopicRecipe[] = [
  // ---- Vocabulary ----
  {
    id: 'pages',
    group: 'vocabulary',
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
    id: 'pictures',
    group: 'vocabulary',
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
    group: 'vocabulary',
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
    id: 'definitions',
    group: 'vocabulary',
    icon: '📘',
    labelKey: 'aiTopicChipDefinitions',
    promptKey: 'aiTopicChipDefinitionsPrompt',
    instructions: [
      'Definitions topic: one item per word.',
      TARGET_WORDS,
      'text = the word. imageKind = "wordCard", imageQuery = a simple learner-dictionary definition at the given level (max 12 words) that never contains the word itself or a word of its family.',
      'audioText = the word.'
    ].join('\n')
  },
  {
    id: 'translation',
    group: 'vocabulary',
    icon: '🌐',
    labelKey: 'aiTopicChipTranslation',
    promptKey: 'aiTopicChipTranslationPrompt',
    instructions: [
      'Translation topic: one item per word.',
      TARGET_WORDS,
      'Translation language: the language the teacher names in the request; otherwise the teacher\'s language given in the request. If that is the same language as the words, use a "search" picture instead of a translation and add a note asking the teacher to name the students\' language.',
      'text = the word in the language being learnt. imageKind = "wordCard", imageQuery = its translation (the usual meaning in this unit; one or two translations, separated by ", ").',
      'audioText = the word (in the language being learnt).'
    ].join('\n')
  },
  {
    id: 'synonyms',
    group: 'vocabulary',
    icon: '🔁',
    labelKey: 'aiTopicChipSynonyms',
    promptKey: 'aiTopicChipSynonymsPrompt',
    instructions: [
      'Synonyms topic: one item per word that has a common synonym at the given level.',
      TARGET_WORDS,
      'text = the word. imageKind = "wordCard", imageQuery = one synonym with the same meaning in this unit (same word type; skip words without a good synonym).',
      'audioText = the word.'
    ].join('\n')
  },
  {
    id: 'verbForms',
    group: 'vocabulary',
    icon: '⏮️',
    labelKey: 'aiTopicChipVerbForms',
    promptKey: 'aiTopicChipVerbFormsPrompt',
    instructions: [
      'Verb forms topic: one item per verb - irregular verbs first, from the pages when given, otherwise common ones at the given level.',
      'By default the past simple: text = the past simple ("went"), imageKind = "wordCard", imageQuery = the base form ("go"). If the teacher asks for another form (past participle, -ing, third person), text = that form instead.',
      'audioText = the form in text.'
    ].join('\n')
  },
  {
    id: 'collocations',
    group: 'vocabulary',
    icon: '🤝',
    labelKey: 'aiTopicChipCollocations',
    promptKey: 'aiTopicChipCollocationsPrompt',
    instructions: [
      'Collocations topic: common word partners (make a mistake, do homework, heavy rain, interested in), from the pages when given, otherwise useful ones at the given level.',
      'text = the word students must supply (often the verb, adjective or preposition). imageKind = "wordCard", imageQuery = the rest of the collocation with "___" where that word goes ("___ your homework"). The partner must be the one natural choice.',
      'audioText = the whole collocation.'
    ].join('\n')
  },
  {
    id: 'listenSpell',
    group: 'vocabulary',
    icon: '🎧',
    labelKey: 'aiTopicChipListenSpell',
    promptKey: 'aiTopicChipListenSpellPrompt',
    instructions: [
      'Listen-and-spell (dictation) topic: students hear the word and spell it.',
      TARGET_WORDS,
      'text = the word as it is spelt. imageKind = "none" (no picture - it would give the answer away). audioText = the word: audio is required for every item, whatever the audio setting says.'
    ].join('\n')
  },

  // ---- Sentences ----
  {
    id: 'gapFill',
    group: 'sentences',
    icon: '✏️',
    labelKey: 'aiTopicChipGapFill',
    promptKey: 'aiTopicChipGapFillPrompt',
    instructions: [
      'Gap-fill topic: one item per target word (from the pages when given).',
      'For each word write one short, natural sentence (6-12 words) with the word replaced by "____". Exactly one gap per sentence.',
      'The sentence must make the missing word the ONLY sensible answer (give a clear clue: a collocation, an opposite, a definition-like context). Never blank an article, a name or a word that many others could replace.',
      'Use the unit\'s words and grammar. audioText = the full sentence with the word.'
    ].join('\n'),
    variants: {
      findWord: 'Students read the sentence and produce the word: text = the missing word exactly as it fits the gap. imageKind = "wordCard", imageQuery = the sentence with "____".',
      findCard: 'Students read the sentence and find the word: text = the sentence with "____". imageKind = "wordCard", imageQuery = the missing word exactly as it fits the gap.'
    },
    defaultVariant: 'findWord'
  },
  {
    id: 'qa',
    group: 'sentences',
    icon: '❓',
    labelKey: 'aiTopicChipQa',
    promptKey: 'aiTopicChipQaPrompt',
    instructions: [
      'Questions and answers topic.',
      'Each item is a question (max 12 words, ending with "?") with a short answer (1-4 words). With pages, every question must be answerable from the pages; without pages, from general knowledge of the theme at the given level.',
      'Mix question words (what, where, when, who, why, how). audioText = the question.'
    ].join('\n'),
    variants: {
      findWord: 'Students read the question and produce the answer: text = the answer. imageKind = "wordCard", imageQuery = the question.',
      findCard: 'Students read the question and find the answer: text = the question. The answer is the image: a "search" picture when it can be pictured clearly, otherwise "wordCard" with the answer.'
    },
    defaultVariant: 'findCard'
  },
  {
    id: 'sentences',
    group: 'sentences',
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

  // ---- Reading & writing ----
  {
    id: 'reading',
    group: 'texts',
    icon: '📖',
    labelKey: 'aiTopicChipReading',
    promptKey: 'aiTopicChipReadingPrompt',
    instructions: [
      'Reading Detective topic: follow the "reading text" example of the instructions exactly.',
      'Use the reading text given by the teacher, or the main reading text on the pages.',
      WRITE_TEXT_IF_MISSING('a reading text', '3-5 paragraphs, like an exam reading text')
    ].join('\n')
  },
  {
    id: 'writing',
    group: 'texts',
    icon: '📓',
    labelKey: 'aiTopicChipWriting',
    promptKey: 'aiTopicChipWritingPrompt',
    instructions: [
      'Writing Workshop topic: follow the "model text" example of the instructions exactly.',
      'Use the model text given by the teacher, or the writing section\'s model or example text on the pages.',
      WRITE_TEXT_IF_MISSING('such a text', '2-3 paragraphs, 8-12 sentences in all, the kind of text the unit asks students to write')
    ].join('\n')
  },

  // ---- Speaking ----
  {
    id: 'speaking',
    group: 'speaking',
    icon: '🗣️',
    labelKey: 'aiTopicChipSpeaking',
    promptKey: 'aiTopicChipSpeakingPrompt',
    instructions: SPEAKING_TEST_RULES
  }
];

export function findRecipe(id: string | null | undefined): AiTopicRecipe | undefined {
  return AI_TOPIC_RECIPES.find(recipe => recipe.id === id);
}

/** The recipe's rules for the AI, with the chosen (or default) side for two-sided chips. */
export function recipeInstructions(recipe: AiTopicRecipe, variant?: AiRecipeVariantId | null): string {
  if (!recipe.variants) return recipe.instructions;
  const chosen = variant && recipe.variants[variant] ? variant : recipe.defaultVariant ?? 'findWord';
  return `${recipe.instructions}\n${recipe.variants[chosen]}`;
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
