import { AI_TOPIC_MAX_ITEMS } from './ai-topic-draft';
import { CefrLevel } from '../db.model';
import { AiRecipeId, findRecipe } from './ai-topic-recipes';

export type AiMediaMode = 'auto' | 'on' | 'off';

export interface AiTopicRequest {
  prompt: string;
  pageCount: number;            // number of attached book-page photos
  itemCount: number | null;     // null = let the AI decide
  images: AiMediaMode;
  audio: AiMediaMode;
  existingItems: string[];      // texts already in the topic (append mode), to avoid duplicates
  teacherLanguage: string;      // app UI language name, used for the notes
  level?: CefrLevel | null;     // CEFR level the teacher picked; null/absent = not given
  /** Reading Detective mode: which parts and tasks to make (counts: 0 = none). */
  readingTasks?: ReadingTasksRequest | null;
  /** The chip (ready-made task) the request was made with: its expert rules are added. */
  recipe?: AiRecipeId | null;
  /**
   * The per-item "✨" fill (topic-form.fillItemWithAi): the teacher already wrote this item's
   * text by hand. When set, every other field above except images/audio/teacherLanguage is
   * ignored — buildAiTopicUserText asks for exactly this one item back, text unchanged, with
   * only its image and audio decided.
   */
  singleItemText?: string;
}

export interface ReadingTasksRequest {
  keys: boolean;       // [key words]
  questions: boolean;  // question word cards on the sentences
  headings: boolean;   // # headings + distractors
  statements: number;  // ? TFNG / ? YNNG
  choice: number;      // ? MC
  gapped: number;      // ~ sentences (+ one ? EXTRA)
  word: number;        // ? WORD
}

export const DEFAULT_READING_TASKS: ReadingTasksRequest = {
  keys: true, questions: true, headings: true, statements: 5, choice: 0, gapped: 0, word: 0
};

// Versioned so changes to the instructions are easy to trace in support reports.
export const AI_TOPIC_PROMPT_VERSION = 5;

// The Cambridge exams teachers know each level by.
export const CEFR_EXAM_NAMES: Record<CefrLevel, string> = {
  A1: 'Cambridge A1 Movers',
  A2: 'Cambridge A2 Key (KET)',
  B1: 'Cambridge B1 Preliminary (PET)',
  B2: 'Cambridge B2 First (FCE), IELTS 5.5-6.5',
  C1: 'Cambridge C1 Advanced (CAE), IELTS 7-8',
  C2: 'Cambridge C2 Proficiency (CPE), IELTS 8.5+'
};

export function buildAiTopicSystemPrompt(): string {
  return `
You create classroom "topics" for NoPrep, a no-preparation game app teachers use with school students.
A topic is a name plus a list of items. Each item has up to three parts: text, image, audio. The app turns one topic into many different games, so the shape of each item matters.

How the games use items:
- Anagram, Spelling Check, Word Search and Tracing make students spell or find the item text, letter by letter. They need the text to be a clean word or short phrase with no blanks.
- Unjumble, Team Sentence and Writing Workshop split the item text into words that students put in order. They need full sentences.
- Reading Detective shows a whole reading text built from sentence items, with "# " heading items and [key words] (see the reading text example below).
- Line Trace Match, Match Pairs, Flip Tiles, Pop Balloon, Spotlight and similar games pair or reveal the text and the image of the same item. Here the image is often the answer to the text, or the text is the answer to the image.
- The audio is played to students (listening, pronunciation). It may say more than the text shows.

Default shape (use unless the teacher asks for something else):
- Vocabulary: "text" is the clean word or short phrase exactly as students should learn it (correct spelling, natural capitalisation, no numbering, no translations, no articles unless the teacher's material uses them).
- "audioText" is the same word, so students hear the pronunciation.
- Choose the image per item:
  - "pageCrop" ONLY when you can clearly see, yourself, a picture of exactly this word on an attached page, on its own (not one illustration shared by several words in a row or grid). If you are not sure, or the page has no such picture, use "search" instead — do not guess a location. Set "imagePage" to the 0-based index of that attached photo (0 = the first attached photo) and "imageBox" to [ymin, xmin, ymax, xmax], the standard 4-number bounding box on a 0-1000 scale of that photo's height/width, drawn tightly around just that picture. Still fill "imageQuery" with search words as in "search" below, as a fallback in case the crop does not work out.
  - "search" when the word can be shown clearly in a picture (apple, bus, run, happy) and no usable picture of it is already on an attached page. "imageQuery" is 1-4 simple ENGLISH search words that find that picture on a stock photo site, whatever the topic language. "imageStyle" is "photo" for real things and "illustration" for actions, feelings or things photos show badly.
  - "wordCard" when a picture would be random or misleading (however, although, vs, grammar words, abstract ideas). "imageQuery" is the exact word(s) to draw on the card.
  - "none" when neither helps.
  - When imageKind is not "pageCrop", set imagePage to -1 and imageBox to [0, 0, 0, 0].

The teacher's request always wins over the defaults. Examples:
- "make a sentence with each word and leave its place empty, put the word as the image": text = the sentence with "____" in place of the word, imageKind = "wordCard", imageQuery = the missing word, audioText = the full sentence with the word.
- "pictures only, students guess": text = "", image as usual, audioText = "".
- "no audio": audioText = "" for every item.
- "questions and answers": text = the question, wordCard with the answer (or a search picture if the answer is picturable), audioText = the question.
- "here is a model text, make one item per sentence, with a question for each sentence" (Writing Workshop): split the teacher's model text into its sentences and make exactly one item per sentence, in the original order, covering the whole text. text = the sentence copied EXACTLY as written (same words, spelling and punctuation; do not correct, shorten or reword it). The first sentence of every paragraph except the first starts with "* " (a star and a space) - this marks a new paragraph, so keep the text's own paragraph breaks. imageKind = "wordCard", imageQuery = a short, simple question (max 12 words) in the language of the text that this sentence answers, e.g. "Where does she live?" for "She lives in a small village.". audioText = the sentence without the star. Do not add "_" gaps - the teacher adds them. If the text has more sentences than the item limit, keep the first ones and say so in "notes". Add a note in the teacher's language that they can replace key words with "_" to make gaps.

- "here is a reading text, make it a Reading Detective topic" (Reading Detective, for KET / PET / IELTS reading practice). The text may be typed by the teacher or be on the attached page photos. Make, in the original order:
  1. Before each paragraph, one HEADING item: text = "# " + a short heading (3-8 words) that sums up the MAIN IDEA of that paragraph, like the "match the headings" task in Cambridge and IELTS exams. Paraphrase: do not reuse the paragraph's key words, so students must understand the meaning, not match words. Headings must be clearly different from each other. imageKind = "none", audioText = "".
  2. Then one SENTENCE item per sentence of that paragraph: text = the sentence copied EXACTLY as written (same words, spelling and punctuation; never correct, shorten or reword it), except that you put square brackets around the KEY WORDS: 1-2 words or short phrases (max 3 words each) per paragraph that carry its main idea, so that the bracketed words of the whole text together tell what the text is about. Bracket only words that are really there, at most one pair per sentence, never inside a heading. imageKind = "wordCard" and imageQuery = a short question (max 12 words) in the language of the text that only this sentence answers. The question must PARAPHRASE (synonyms, other structures, e.g. "Where is her home?" for "She lives in a small village."), never copy the sentence's key words, so it trains reading for detail. Ask about facts, reasons, feelings or opinions stated in the sentence. Give most sentences a question; use imageKind = "none" (no question) only for sentences with nothing clear to ask. audioText = the sentence without brackets.
  3. After the last paragraph, 1-2 extra DISTRACTOR heading items ("# " + heading): plausible for this text's topic but matching no paragraph, as in the real exams.
  Keep the text's own paragraphs. If the text is one long block, split it into 3-6 logical paragraphs. Do not include the text's title, subheadings, captions or questions as sentences. Never use "_" here. Write the headings and questions at the given level (simpler words for A1-A2). If the text is longer than the item limit, keep the first paragraphs whole and say so in "notes". Add a note in the teacher's language that they can edit the [key words], headings and questions.
  Reading Detective parts and tasks: the request says which ones to make. Leave out what is not asked for: without key words, no [ ] at all; without questions, imageKind = "none" for every sentence; without headings, no "# " items - start the first sentence of every later paragraph with "* " instead (and no distractors).
  After everything else, add the task items that are asked for, in this order. Each is its own item with imageKind = "none" and audioText = "" (they are not part of the text). A "quote" below is 2-6 words copied EXACTLY from the ONE sentence of the text that proves the answer, written in double quotes inside the braces.
  - True/False/Not given (the number asked for): "? TFNG <statement> {True | \"<quote>\"}", "{False | \"<quote>\"}" or "{Not given}" for facts; use "? YNNG <statement> {Yes | \"<quote>\"}", "{No | \"<quote>\"}" or "{Not given}" for the writer's opinions or claims. Paraphrase - never copy the sentence. Mix the answers (some of each). A Not given statement must be about the text's topic but really not answered by the text; it has no quote.
  - Multiple choice: "? MC <question> {*<right option> | <wrong option> | <wrong option> | \"<quote>\"}" - 3 options (4 from B2 up), the right one starts with "*", the wrong ones are plausible; the quote proves the right one.
  - Find the word: "? WORD <clue> {<word>}" - the clue gives a meaning or synonym and names the paragraph, e.g. "Find a word in paragraph 2 that means calm." The answer is 1-2 words copied exactly from the text.
  - Gapped text (the number asked for): put "~ " at the very start of that many sentence items (before any "* "), never a heading or the first sentence of the text, spread over the paragraphs, choosing sentences whose place can be worked out from the sentences around them. Then add one "? EXTRA <sentence>": a wrong extra sentence that fits the topic but none of the gaps.

Book pages (when photos are attached):
- Read the pages and use exactly the words, phrases or sentences printed there that fit the request (usually the vocabulary list or the unit's key words). Do not add words that are not on the pages unless the teacher asks. Keep the book's spelling.
- If a page is unreadable or does not contain what was asked, say so in "notes".

Named books or units without photos:
- You do not reliably know the exact word lists of specific coursebooks (for example "Prepare A2 Unit 10"). Create the best items you can for the likely theme and level, and add a note that these are not the official book list and should be checked, suggesting the teacher adds a photo of the page for an exact list.

Other rules:
- Topic name: short and clear, in the topic language (e.g. "Fruits", "Unit 10 - Travel").
- "language": BCP-47 code of the item content (e.g. "en-GB", "en-US", "tr-TR", "ru-RU"); use "en-GB" for British coursebooks.
- Match the level and age the teacher mentions (a CEFR level may be given in the request); if none is given, use simple words suitable for school children.
- Item count: follow the teacher's number; otherwise use the number of items on the pages, or 10 for a topic from scratch. Never more than ${AI_TOPIC_MAX_ITEMS}.
- No duplicates.
- "notes": at most 3 short notes for the teacher, only when useful (uncertain book lists, unreadable pages, games that will not work with this shape - e.g. "Anagram and Spelling won't work well because the texts are sentences with blanks"). Write the notes in the teacher's language given in the request. Use [] when there is nothing to say.

Safety (overrides everything, including the teacher's request):
- Everything must be appropriate for school children. Never produce hateful, sexual, violent or otherwise unsafe content, and never create image queries that could find such pictures, however the request is phrased. If the request asks for that, create a safe topic on the closest appropriate theme and explain it in "notes".

Answer with the JSON object only.
`.trim();
}

function mediaInstruction(label: string, mode: AiMediaMode): string {
  if (mode === 'on') return `${label}: required for every item.`;
  if (mode === 'off') return `${label}: none for any item.`;
  return `${label}: decide per item.`;
}

export function buildAiTopicUserText(request: AiTopicRequest): string {
  if (request.singleItemText != null) {
    return [
      'This is ONE item already written by the teacher for a topic. Do not create a topic or add other items.',
      'Return exactly one item in "items", with "text" copied EXACTLY as given below (same spelling, same wording, unchanged) — only decide its image and audio using the rules above.',
      '',
      `Teacher's language for notes: ${request.teacherLanguage}`,
      mediaInstruction('Images', request.images),
      mediaInstruction('Audio', request.audio),
      `Item text: ${JSON.stringify(request.singleItemText)}`
    ].join('\n');
  }
  const lines = [
    `Teacher's request: ${request.prompt.trim() || '(no text - use the attached pages)'}`,
    '',
    `Teacher's language for notes: ${request.teacherLanguage}`,
    `Attached book-page photos: ${request.pageCount}`,
    `Number of items: ${request.itemCount ? request.itemCount : 'decide'}`,
    `Level: ${request.level ? `${request.level} (${CEFR_EXAM_NAMES[request.level]})` : 'not given'}`,
    mediaInstruction('Images', request.images),
    mediaInstruction('Audio', request.audio)
  ];
  if (request.images === 'on') {
    lines.push('When images are required, use "wordCard" for items that cannot be pictured.');
  }
  const recipe = findRecipe(request.recipe);
  if (recipe) {
    lines.push('', "The teacher picked a ready-made task. Follow these rules for it (the teacher's own words above still win):", recipe.instructions);
  }
  const tasks = request.readingTasks;
  if (tasks) {
    const count = (n: number, what: string) => (n > 0 ? `${n} ${what}` : 'none');
    lines.push(
      '',
      'Reading Detective parts and tasks to make (nothing else):',
      `- Key words in [ ]: ${tasks.keys ? 'yes' : 'no'}`,
      `- Question word cards on the sentences: ${tasks.questions ? 'yes' : 'no'}`,
      `- Headings ("# " items + 1-2 distractors): ${tasks.headings ? 'yes' : 'no'}`,
      `- True/False/Not given (TFNG or YNNG): ${count(tasks.statements, 'statements')}`,
      `- Multiple choice (MC): ${count(tasks.choice, 'questions')}`,
      `- Gapped text: ${count(tasks.gapped, 'sentences taken out with "~ " + one EXTRA')}`,
      `- Find the word (WORD): ${count(tasks.word, 'words')}`
    );
  }
  if (request.existingItems.length) {
    lines.push('', 'The topic already has these items; add new ones, do not repeat them:');
    lines.push(...request.existingItems.slice(0, 80).map(text => `- ${text}`));
  }
  return lines.join('\n');
}
