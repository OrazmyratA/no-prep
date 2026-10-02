import { AI_TOPIC_MAX_ITEMS } from './ai-topic-draft';

export type AiMediaMode = 'auto' | 'on' | 'off';

export interface AiTopicRequest {
  prompt: string;
  pageCount: number;            // number of attached book-page photos
  itemCount: number | null;     // null = let the AI decide
  images: AiMediaMode;
  audio: AiMediaMode;
  existingItems: string[];      // texts already in the topic (append mode), to avoid duplicates
  teacherLanguage: string;      // app UI language name, used for the notes
  /**
   * The per-item "✨" fill (topic-form.fillItemWithAi): the teacher already wrote this item's
   * text by hand. When set, every other field above except images/audio/teacherLanguage is
   * ignored — buildAiTopicUserText asks for exactly this one item back, text unchanged, with
   * only its image and audio decided.
   */
  singleItemText?: string;
}

// Versioned so changes to the instructions are easy to trace in support reports.
export const AI_TOPIC_PROMPT_VERSION = 1;

export function buildAiTopicSystemPrompt(): string {
  return `
You create classroom "topics" for NoPrep, a no-preparation game app teachers use with school students.
A topic is a name plus a list of items. Each item has up to three parts: text, image, audio. The app turns one topic into many different games, so the shape of each item matters.

How the games use items:
- Anagram, Spelling Check, Word Search and Tracing make students spell or find the item text, letter by letter. They need the text to be a clean word or short phrase with no blanks.
- Unjumble and Team Sentence split the item text into words that students put in order. They need full sentences.
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

Book pages (when photos are attached):
- Read the pages and use exactly the words, phrases or sentences printed there that fit the request (usually the vocabulary list or the unit's key words). Do not add words that are not on the pages unless the teacher asks. Keep the book's spelling.
- If a page is unreadable or does not contain what was asked, say so in "notes".

Named books or units without photos:
- You do not reliably know the exact word lists of specific coursebooks (for example "Prepare A2 Unit 10"). Create the best items you can for the likely theme and level, and add a note that these are not the official book list and should be checked, suggesting the teacher adds a photo of the page for an exact list.

Other rules:
- Topic name: short and clear, in the topic language (e.g. "Fruits", "Unit 10 - Travel").
- "language": BCP-47 code of the item content (e.g. "en-GB", "en-US", "tr-TR", "ru-RU"); use "en-GB" for British coursebooks.
- Match the level and age the teacher mentions; if none is given, use simple words suitable for school children.
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
    mediaInstruction('Images', request.images),
    mediaInstruction('Audio', request.audio)
  ];
  if (request.images === 'on') {
    lines.push('When images are required, use "wordCard" for items that cannot be pictured.');
  }
  if (request.existingItems.length) {
    lines.push('', 'The topic already has these items; add new ones, do not repeat them:');
    lines.push(...request.existingItems.slice(0, 80).map(text => `- ${text}`));
  }
  return lines.join('\n');
}
