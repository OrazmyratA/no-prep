// Speaking Check chips (docs/speaking-check.md §4, §7): short assessment words per exam and
// criterion, each written in plain teacher words from ONE band of the official descriptors
// (Cambridge handbooks 2024, IELTS public band descriptors). The band a chip comes from is the
// mark it points to; tapped chips are averaged into the criterion's mark (speaking-check-scoring).
//
// B2 First and C1 Advanced have no chips yet: their Global Achievement scales still need reading
// from their handbooks (their scoring and scale points are verified, see speaking-check-exams).
import { CheckCriterionId, CheckExamId } from './speaking-check-exams';

export interface CheckChip {
  /** Stable id (saved with results), e.g. 'ket.grammarVocab.5a'. */
  id: string;
  /** The chip's words (English: exam assessment terms, like the official scales). */
  text: string;
  /** The descriptor band the words come from: the mark this chip points to. */
  band: number;
  /** A highest possible mark it sets (young learners' pronunciation rule). */
  cap?: number;
}

type ChipSet = Partial<Record<CheckCriterionId, CheckChip[]>>;

// Ids are built from the band and the chip's place among that band's chips, and saved results
// keep them: add new chips at the END of a list, never reorder or remove existing ones.
function chips(prefix: string, list: Array<[number, string, number?]>): CheckChip[] {
  const count = new Map<number, number>();
  return list.map(([band, text, cap]) => {
    const n = (count.get(band) ?? 0) + 1;
    count.set(band, n);
    const chip: CheckChip = { id: `${prefix}.${band}${String.fromCharCode(96 + n)}`, text, band };
    if (cap !== undefined) chip.cap = cap;
    return chip;
  });
}

// Movers / Flyers (handbook p. 86–87): "If the candidate produces some language, but insufficient
// language to make a confident judgement about pronunciation (e.g. just a couple of words), the
// maximum score that can be awarded is 3."
const TOO_LITTLE = 'Too little language to judge';

export const CHECK_CHIPS: Partial<Record<CheckExamId, ChipSet>> = {
  // Pre A1 Starters (handbook p. 85).
  starters: {
    vocabulary: chips('starters.vocabulary', [
      [5, 'Has the words for all tasks'], [5, 'Simple sentences, few mistakes'], [5, 'Some longer answers'],
      [3, 'Has the words for most tasks'], [3, 'Basic mistakes blur meaning'], [3, 'Answers in single words'],
      [1, 'Has the words for some tasks only'], [1, 'Mistakes stop communication'], [1, 'Single words or no answer']
    ]),
    pronunciation: chips('starters.pronunciation', [
      [5, 'Generally easy to understand'], [5, 'A few unclear sounds'],
      [3, 'Sometimes easy to understand'],
      [1, 'Often hard to understand']
    ]),
    interaction: chips('starters.interaction', [
      [5, 'Responds appropriately'], [5, 'Asks for help when needed'], [5, 'Often answers promptly'],
      [3, 'Needs frequent help'], [3, 'Tries to ask for help'], [3, 'Slow or halting answers'],
      [1, 'Needs help throughout'], [1, 'Often does not respond'], [1, 'Long pauses']
    ])
  },
  // A1 Movers (handbook p. 86).
  movers: {
    grammarVocab: chips('movers.grammarVocab', [
      [5, 'Has the words for all tasks'], [5, 'Simple structures, meaning clear'], [5, 'Phrases and longer answers'], [5, 'Links ideas with and, but, then'],
      [3, 'Has the words for most tasks'], [3, 'Basic mistakes blur meaning'], [3, 'Mostly word or phrase answers'], [3, 'Links ideas with and'],
      [1, 'Has the words for some tasks only'], [1, 'Only a few simple sentences'], [1, 'Mostly single words']
    ]),
    pronunciation: chips('movers.pronunciation', [
      [5, 'Mostly easy to understand'], [5, 'Some word stress and intonation'],
      [3, 'Mostly clear, some unclear sounds'], [3, 'Limited word stress'],
      [1, 'Sometimes hard to understand'],
      [3, TOO_LITTLE, 3]
    ]),
    interaction: chips('movers.interaction', [
      [5, 'Responds with very little help'], [5, 'Asks for help when needed'], [5, 'Almost always answers promptly'],
      [3, 'Needs some help'], [3, 'Often prompt, some pausing'],
      [1, 'Needs frequent help'], [1, 'Delayed or halting answers']
    ])
  },
  // A2 Flyers (handbook p. 87).
  flyers: {
    grammarVocab: chips('flyers.grammarVocab', [
      [5, 'Range of words for all tasks'], [5, 'Range of simple structures, meaning clear'], [5, 'Links with and, but, when, because'],
      [3, 'Has the words for most tasks'], [3, 'Simple structures, some mistakes'], [3, 'Links with and, but, then'],
      [1, 'Has the words for some tasks only'], [1, 'Basic mistakes blur meaning'], [1, 'Mostly word or phrase answers']
    ]),
    pronunciation: chips('flyers.pronunciation', [
      [5, 'Clear, some stress and intonation'],
      [3, 'Mostly clear, limited stress and intonation'],
      [1, 'Some unclear sounds'], [1, 'Limited word stress'],
      [3, TOO_LITTLE, 3]
    ]),
    interaction: chips('flyers.interaction', [
      [5, 'Responds to everything, very little help'], [5, 'Natural pace, little hesitation'],
      [3, 'Responds to almost everything'], [3, 'Some hesitation mid-sentence'],
      [1, 'Responds to some, needs support'], [1, 'Often hesitates']
    ])
  },
  // A2 Key (handbook May 2024, pp. 51–52).
  ket: {
    grammarVocab: chips('ket.grammarVocab', [
      [5, 'Good control of simple grammar'], [5, 'Range of everyday vocabulary'],
      [3, 'Simple grammar mostly correct'], [3, 'Enough vocabulary for everyday topics'],
      [1, 'Controls only a few grammar forms'], [1, 'Isolated words and phrases']
    ]),
    pronunciation: chips('ket.pronunciation', [
      [5, 'Mostly clear, good sounds and stress'],
      [3, 'Mostly clear, limited control'],
      [1, 'Often hard to understand']
    ]),
    interactiveCommunication: chips('ket.interactiveCommunication', [
      [5, 'Keeps simple exchanges going'], [5, 'Needs very little prompting'],
      [3, 'Keeps exchanges going with some difficulty'], [3, 'Needs prompting and support'],
      [1, 'Struggles to keep exchanges going'], [1, 'Needs a lot of prompting']
    ]),
    global: chips('ket.global', [
      [5, 'Handles everyday situations'], [5, 'Longer answers'],
      [3, 'Gets basic meaning across'], [3, 'Very short answers, many pauses'],
      [1, 'Struggles to get basic meaning across'], [1, 'Isolated words, frequent pauses']
    ])
  },
  // B1 Preliminary (handbook May 2024, pp. 65–66).
  pet: {
    grammarVocab: chips('pet.grammarVocab', [
      [5, 'Good simple grammar, tries complex'], [5, 'Vocabulary to give views'],
      [3, 'Good control of simple grammar'], [3, 'Range of vocabulary on familiar topics'],
      [1, 'Enough control of simple grammar'], [1, 'Limited vocabulary']
    ]),
    discourse: chips('pet.discourse', [
      [5, 'Extended answers, some hesitation'], [5, 'Relevant, little repetition'], [5, 'Range of linking words'],
      [3, 'Answers beyond short phrases'], [3, 'Mostly relevant, some repetition'], [3, 'Basic linking words'],
      [1, 'Short phrases, frequent hesitation'], [1, 'Repeats or goes off topic']
    ]),
    pronunciation: chips('pet.pronunciation', [
      [5, 'Easy to understand'], [5, 'Stress and intonation generally right'], [5, 'Sounds generally clear'],
      [3, 'Mostly clear, some control of sounds'],
      [1, 'Mostly clear, limited control']
    ]),
    interactiveCommunication: chips('pet.interactiveCommunication', [
      [5, 'Starts and responds well'], [5, 'Develops talk towards an outcome'],
      [3, 'Starts and responds appropriately'], [3, 'Keeps talk going with little prompting'],
      [1, 'Keeps simple exchanges, with difficulty'], [1, 'Needs prompting and support']
    ]),
    global: chips('pet.global', [
      [5, 'Handles familiar topics'], [5, 'Organised extended talk'],
      [3, 'Handles everyday situations'], [3, 'Longer answers, little complex language'],
      [1, 'Gets basic meaning across'], [1, 'Very short answers, many pauses']
    ])
  },
  // IELTS (public Speaking Band Descriptors).
  ielts: {
    fluency: chips('ielts.fluency', [
      [8, 'Fluent, rare hesitation'], [7, 'Long turns without effort'], [6, 'Willing to speak at length'],
      [6, 'Coherence sometimes lost'], [5, 'Keeps going, but repeats or slows'], [4, 'Noticeable pauses'],
      [3, 'Long pauses, simple answers only']
    ]),
    lexical: chips('ielts.lexical', [
      [8, 'Wide, precise vocabulary'], [7, 'Some idiomatic language'], [6, 'Enough to discuss topics at length'],
      [5, 'Limited flexibility'], [4, 'Frequent wrong word choice'], [3, 'Simple personal vocabulary only']
    ]),
    grammar: chips('ielts.grammar', [
      [8, 'Wide range, mostly error-free'], [7, 'Frequent error-free sentences'], [6, 'Mix of simple and complex'],
      [5, 'Complex forms with errors'], [4, 'Short, repetitive structures'], [3, 'Errors except memorised phrases']
    ]),
    pronunciation: chips('ielts.pronunciation', [
      [8, 'Easy to understand throughout'], [6, 'Generally understood, variable control'],
      [4, 'Frequent mispronunciation'], [4, 'Some effort to understand'], [2, 'Often unintelligible']
    ])
  }
};

/** Exams with ready-made chips: the ones the exam window offers. */
export function examHasChips(exam: CheckExamId): boolean {
  return !!CHECK_CHIPS[exam];
}

/** strength / ok / weakness, from where the chip's band sits on the criterion's scale. */
export function chipTone(chip: CheckChip, max: number): 'strength' | 'ok' | 'weakness' {
  const share = chip.band / max;
  if (share >= 0.75) return 'strength';
  if (share <= 0.45) return 'weakness';
  return 'ok';
}
