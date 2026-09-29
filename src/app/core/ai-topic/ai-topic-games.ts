import { AiItemDraft } from './ai-topic-draft';

// Games that spell or search the item text letter by letter.
const SPELLING_GAMES = ['anagram', 'spelling-check', 'word-search', 'tracing'];
// Games that split the item text into words to put in order.
const SENTENCE_GAMES = ['unjumble', 'team-sentence'];

function wordCount(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

/**
 * Game ids that will not play well with this topic's item shape, e.g. spelling games when the
 * texts are gap-fill sentences. Kept deliberately conservative: only flags clear mismatches.
 */
export function findPoorlySuitedGames(items: readonly AiItemDraft[]): string[] {
  if (!items.length) return [];
  const half = items.length / 2;
  const clean = items.filter(item => item.text && !/_{2,}/.test(item.text));
  const wordLike = clean.filter(item => wordCount(item.text) <= 3).length;
  const sentences = clean.filter(item => wordCount(item.text) >= 3).length;
  const pairs = items.filter(item => item.text && item.imageKind !== 'none').length;

  const poor: string[] = [];
  if (wordLike < half) poor.push(...SPELLING_GAMES);
  if (sentences < half) poor.push(...SENTENCE_GAMES);
  if (pairs < 2) poor.push('line-trace-match');
  return poor;
}
