import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router } from '@angular/router';
import { vi } from 'vitest';

import { db, Item, Topic } from '../../core/db.model';
import { TranslatePipe } from '../../shared/translate-pipe';
import { GameFinishConfettiService } from '../../shared/game-finish-overlay';
import { ReadingDetectiveComponent } from './reading-detective';
import { LEVEL_WPM } from './reading-model';

const question = new Blob(['?'], { type: 'image/png' });

function item(order: number, text: string, withQuestion = false): Item {
  return { id: order + 1, topicId: 1, text, order, createdAt: new Date(), ...(withQuestion ? { image: question } : {}) };
}

const STORY: Item[] = [
  item(0, '# A visit to grandma'),
  item(1, 'Last summer I visited my [grandmother].', true),
  item(2, 'She lives in a village.', true),
  item(3, '# A morning at the river'),
  item(4, 'We went to the [river] early.', true),
  item(5, '# Shopping in the city')
];

describe('ReadingDetectiveComponent', () => {
  let component: ReadingDetectiveComponent;
  let fixture: ComponentFixture<ReadingDetectiveComponent>;
  let router: { navigate: ReturnType<typeof vi.fn> };

  async function create(items: Item[], topic: Partial<Topic> = { name: 'River trip' }) {
    vi.spyOn(db.items, 'where').mockReturnValue({
      equals: () => ({ sortBy: () => Promise.resolve(items) })
    } as never);
    vi.spyOn(db.topics, 'get').mockResolvedValue(topic as Topic);
    vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {});
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(() => Promise.resolve());
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:q');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});

    await TestBed.configureTestingModule({
      imports: [ReadingDetectiveComponent, TranslatePipe],
      providers: [
        { provide: ActivatedRoute, useValue: { snapshot: { paramMap: new Map([['id', '1']]) } } },
        { provide: Router, useValue: router },
        { provide: GameFinishConfettiService, useValue: { create: async () => Object.assign(vi.fn(), { reset: vi.fn() }) } }
      ]
    }).overrideTemplate(ReadingDetectiveComponent, '').compileComponents();

    fixture = TestBed.createComponent(ReadingDetectiveComponent);
    component = fixture.componentInstance;
    await component.ngOnInit();
  }

  function wordId(text: string, from = 0): number {
    const word = component.text.words.find(w => w.id >= from && w.text === text);
    expect(word).toBeDefined();
    return word!.id;
  }

  beforeEach(() => {
    vi.useFakeTimers();
    router = { navigate: vi.fn() };
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('reads the topic level and leaves when there is no text', async () => {
    await create(STORY, { name: 'River trip', level: 'B1' });
    expect(component.level).toBe('B1');
    expect(component.wpm).toBe(LEVEL_WPM.B1);
    expect(component.topicName).toBe('River trip');

    TestBed.resetTestingModule();
    await create([item(0, '# Only a heading')]);
    expect(router.navigate).toHaveBeenCalledWith(['/topics', 1, 'activities']);
  });

  it('stage 1: a wrong word buzzes, the right one is highlighted and the next key comes', async () => {
    await create(STORY);
    component.start();
    expect(component.stage).toBe('keys');
    expect(component.currentKey?.text).toBe('grandmother');

    component.onWordClick(component.text.words[wordId('village.')]);
    expect(component.wrongWord).toBe(wordId('village.'));
    expect(component.missionShake).toBe(true);
    vi.advanceTimersByTime(600);
    expect(component.wrongWord).toBe(-1);

    component.onWordClick(component.text.words[wordId('grandmother.')]);
    expect(component.foundWords.has(wordId('grandmother.'))).toBe(true);
    vi.advanceTimersByTime(750);
    expect(component.currentKey?.text).toBe('river');
    expect(component.scores.keys.got).toBe(0); // the first key needed two tries

    component.onWordClick(component.text.words[wordId('river')]);
    vi.advanceTimersByTime(750);
    expect(component.scores.keys).toEqual({ got: 1, total: 2, played: true, proofGot: 0, proofTotal: 0 });
    expect(component.view).toBe('between');
  });

  it('stage 1: shows a hint paragraph after three wrong taps', async () => {
    await create(STORY);
    component.start();
    for (let i = 0; i < 3; i++) {
      component.onWordClick(component.text.words[wordId('She')]);
      vi.advanceTimersByTime(600);
    }
    expect(component.hintParagraph).toBe(0);
  });

  describe('matching', () => {
    const TEXTS: Item[] = [
      item(0, 'Anna lives in Rome.'),
      item(1, '* Ben lives in Oslo.'),
      item(2, '* Cem lives in Baku.'),
      item(3, '? MATCH Who lives in Norway? {B}'),
      item(4, '? MATCH Who lives in Italy? {A}')
    ];

    it('takes the right text, counting first tries only, in the order they were written', async () => {
      await create(TEXTS);
      component.start();
      expect(component.stage).toBe('match');
      expect(component.matchMode).toBe(true);
      expect(component.currentMatch?.prompt).toBe('Who lives in Norway?');

      component.chooseMatch(0);
      expect(component.wrongParagraph).toBe(0);
      expect(component.taskIndex).toBe(0);
      vi.advanceTimersByTime(600);
      expect(component.wrongParagraph).toBe(-1);

      component.chooseMatch(1);
      expect(component.justMatched).toBe(1);
      expect(component.scores.match.got).toBe(0);
      vi.advanceTimersByTime(950);
      expect(component.justMatched).toBe(-1);
      expect(component.currentMatch?.prompt).toBe('Who lives in Italy?');

      component.chooseMatch(0);
      vi.advanceTimersByTime(950);
      expect(component.scores.match.got).toBe(1);
      expect(component.scores.match.total).toBe(2);
      expect(component.view).toBe('results');
    });

    it('lets a text answer more than one sentence', async () => {
      await create([...TEXTS.slice(0, 3), item(3, '? MATCH Who lives in Norway? {B}'), item(4, '? MATCH Whose city is Oslo? {B}')]);
      component.start();
      component.chooseMatch(1);
      vi.advanceTimersByTime(950);
      component.chooseMatch(1);
      vi.advanceTimersByTime(950);
      expect(component.scores.match.got).toBe(2);
    });

    it('lights up the right text after three wrong tries', async () => {
      await create(TEXTS);
      component.start();
      for (let i = 0; i < 3; i++) {
        component.chooseMatch(2);
        vi.advanceTimersByTime(600);
      }
      expect(component.hintParagraph).toBe(1);
    });

    it('shows the answer when skipped, and scores nothing', async () => {
      await create(TEXTS);
      component.start();
      component.skipQuestion();
      expect(component.justMatched).toBe(1);
      expect(component.scores.match.got).toBe(0);
      vi.advanceTimersByTime(950);
      expect(component.taskIndex).toBe(1);
    });

    it('chooses a text with its letter key or number key', async () => {
      await create(TEXTS);
      component.start();
      component.onWindowKeyDown(new KeyboardEvent('keydown', { key: 'b' }));
      expect(component.justMatched).toBe(1);
      vi.advanceTimersByTime(950);
      component.onWindowKeyDown(new KeyboardEvent('keydown', { key: '1' }));
      expect(component.justMatched).toBe(0);
    });
  });

  describe('gap fill', () => {
    const GAPS: Item[] = [
      item(0, 'We walked to the river.'),
      item(1, 'I stayed there for four weeks.'),
      item(2, '? GAP We _ to the river. {*walked | ran | sat}'),
      item(3, '? GAP I stayed there _ four weeks. {for | during}')
    ];
    const wordOf = (text: string) => component.text.words.find(word => word.text === text)!;
    const pick = (label: string) => component.currentClozeOptions.findIndex(option => option.text === label);

    it('hides the words until the right option is chosen, counting first tries only', async () => {
      await create(GAPS);
      component.start();
      expect(component.stage).toBe('cloze');
      expect(component.clozeAt(wordOf('walked'))?.id).toBe(0);
      expect(component.clozeAt(wordOf('river.'))).toBeNull();

      component.chooseClozeOption(pick('ran'));
      expect(component.wrongOption).toBe(pick('ran'));
      vi.advanceTimersByTime(600);
      component.chooseClozeOption(pick('walked'));
      expect(component.clozeAt(wordOf('walked'))).toBeNull();
      expect(component.isClozeWordFilled(wordOf('walked'))).toBe(true);
      expect(component.scores.cloze.got).toBe(0);
      vi.advanceTimersByTime(950);
      expect(component.taskIndex).toBe(1);
    });

    it('takes a typed answer in any capitals, and any accepted word', async () => {
      await create(GAPS);
      component.start();
      component.chooseClozeOption(pick('walked'));
      vi.advanceTimersByTime(950);

      component.clozeInput = 'in';
      component.submitClozeAnswer();
      expect(component.wrongCloze).toBe(true);
      vi.advanceTimersByTime(600);
      component.clozeInput = ' DURING ';
      component.submitClozeAnswer();
      expect(component.clozeFilled.has(1)).toBe(true);
      vi.advanceTimersByTime(950);
      expect(component.view).toBe('results');
      expect(component.scores.cloze.got).toBe(1);
    });

    it('gives the first letter after three wrong answers on an open gap', async () => {
      await create([GAPS[0], GAPS[1], GAPS[3]]);
      component.start();
      expect(component.clozeHintLetter).toBe('');
      for (let i = 0; i < 3; i++) {
        component.clozeInput = 'no';
        component.submitClozeAnswer();
        vi.advanceTimersByTime(600);
      }
      expect(component.clozeHintLetter).toBe('F');
    });

    it('shows the answer when a gap is skipped, and scores nothing', async () => {
      await create(GAPS);
      component.start();
      component.skipQuestion();
      expect(component.clozeFilled.has(0)).toBe(true);
      expect(component.scores.cloze.got).toBe(0);
      vi.advanceTimersByTime(950);
      expect(component.taskIndex).toBe(1);
    });

    it('chooses an option with number and letter keys', async () => {
      await create(GAPS);
      component.start();
      const right = pick('walked');
      component.onWindowKeyDown(new KeyboardEvent('keydown', { key: String(right + 1) }));
      expect(component.clozeFilled.has(0)).toBe(true);
    });

    it('keeps the gaps empty during Gapped text, which comes first, and shows the words after Gap fill', async () => {
      await create([...GAPS, item(4, '~ Then we went home.')]);
      component.start();
      expect(component.stage).toBe('gapped');
      expect(component.clozeAt(wordOf('walked'))).not.toBeNull();
      component.skipStage();
      expect(component.stage).toBe('cloze');
      component.skipStage();
      expect(component.clozeAt(wordOf('walked'))).toBeNull();
    });
  });

  it('stage 2: the questions follow the order of the text', async () => {
    await create(STORY);
    component.start();
    component.skipStage();
    const inText = component.text.sentences.filter(sentence => sentence.hasQuestion);
    expect(inText.length).toBe(3);
    expect(component.questions).toEqual(inText);
  });

  it('stage 2: the answer is the sentence of the question card', async () => {
    await create(STORY);
    component.start();
    component.skipStage();
    expect(component.stage).toBe('questions');
    expect(component.scores.keys.played).toBe(false);
    expect(component.questions.length).toBe(3);

    const answer = component.currentQuestion!;
    const wrong = component.text.sentences.find(s => s !== answer)!;
    component.onSentenceClick(wrong);
    expect(component.wrongSentence).toBe(wrong.id);
    vi.advanceTimersByTime(600);

    component.onSentenceClick(answer);
    expect(component.answered.get(answer.id)).toBe(1);
    vi.advanceTimersByTime(950);
    expect(component.questionIndex).toBe(1);

    for (let i = 1; i < 3; i++) {
      component.onSentenceClick(component.currentQuestion!);
      vi.advanceTimersByTime(950);
    }
    expect(component.scores.questions.got).toBe(2);
    expect(component.view).toBe('between');
    component.continueToNext();
    expect(component.stage).toBe('reading');
  });

  it('stage 3: words appear one by one, then the heading timer starts', async () => {
    await create(STORY);
    component.start();
    component.skipStage();
    component.skipStage();
    expect(component.stage).toBe('reading');
    expect(component.headingOptions.length).toBe(3);
    expect(component.revealed).toBe(0);

    vi.advanceTimersByTime(700);
    expect(component.revealed).toBe(1);
    for (let step = 0; step < 300 && component.phase === 'reading'; step++) vi.advanceTimersByTime(100);
    expect(component.revealed).toBe(component.text.paragraphs[0].words.length);
    expect(component.phase).toBe('choosing');
    expect(component.timerTotalMs).toBe(16000); // (10 s + 11 words / 5) x 1.3 for A2
  });

  it('stage 3: pause stops the words and the timer', async () => {
    await create(STORY);
    component.start();
    component.skipStage();
    component.skipStage();
    vi.advanceTimersByTime(700 + 600);
    const shown = component.revealed;
    component.togglePause();
    vi.advanceTimersByTime(10000);
    expect(component.revealed).toBe(shown);
    component.togglePause();
    vi.advanceTimersByTime(1500);
    expect(component.revealed).toBeGreaterThan(shown);
  });

  it('stage 3: wrong heading shakes, right one is used up, timeout shows the answer', async () => {
    await create(STORY);
    component.start();
    component.skipStage();
    component.skipStage();
    component.revealAll();
    expect(component.phase).toBe('choosing');

    const [first, second, distractor] = component.text.headings;
    component.chooseHeading(distractor);
    expect(component.wrongHeading).toBe(distractor.id);
    vi.advanceTimersByTime(600);
    component.chooseHeading(first);
    expect(component.phase).toBe('matched');
    expect(component.usedHeadings.has(first.id)).toBe(true);
    expect(component.headingResult(component.text.paragraphs[0])).toEqual({ heading: first.id, firstTry: false, missed: false });

    vi.advanceTimersByTime(1700);
    expect(component.readIndex).toBe(1);
    component.revealAll();
    vi.advanceTimersByTime(15000);
    expect(component.phase).toBe('missed');
    expect(component.usedHeadings.has(second.id)).toBe(true);

    vi.advanceTimersByTime(2600);
    expect(component.view).toBe('results');
    expect(component.scores.reading).toEqual({ got: 0, total: 2, played: true, proofGot: 0, proofTotal: 0 });
  });

  it('skips one key word, question or heading without a point', async () => {
    await create(STORY);
    component.start();
    component.skipQuestion();
    expect(component.foundWords.has(wordId('grandmother.'))).toBe(true);
    vi.advanceTimersByTime(750);
    expect(component.currentKey?.text).toBe('river');

    component.skipStage();
    const first = component.currentQuestion!;
    component.skipQuestion();
    expect(component.answered.get(first.id)).toBe(1);
    vi.advanceTimersByTime(950);
    expect([component.questionIndex, component.scores.questions.got]).toEqual([1, 0]);

    component.skipStage();
    expect(component.stage).toBe('reading');
    component.skipQuestion(); // mid-paragraph: its heading shows as missed
    expect(component.phase).toBe('missed');
    expect(component.headingResult(component.text.paragraphs[0])?.missed).toBe(true);
    vi.advanceTimersByTime(2600);
    expect(component.readIndex).toBe(1);
  });

  it('skips the read-through when the text has no headings but has other tasks, unless the teacher turns it on', async () => {
    await create([item(0, 'One two three.', true), item(1, '* Four five.')]);
    expect(component.availableStages).toContain('reading');
    expect(component.isStageOn('reading')).toBe(false);
    expect(component.activeStages).toEqual(['questions']);
    component.toggleStage('reading');
    expect(component.isStageOn('reading')).toBe(true);
  });

  it('stage 3 without headings: each paragraph waits for Next', async () => {
    await create([item(0, 'One two three.'), item(1, '* Four five.')]);
    component.start();
    expect(component.stage).toBe('reading'); // no keys, no questions
    component.revealAll();
    expect(component.phase).toBe('done');
    component.onWindowKeyDown(new KeyboardEvent('keydown', { key: 'Enter' }));
    expect(component.readIndex).toBe(1);
    component.revealAll();
    component.nextParagraph();
    expect(component.view).toBe('results');
    expect(component.stars).toBe(3);
  });

  describe('tasks', () => {
    const TASKS: Item[] = [
      item(0, '# A visit'),
      item(1, 'Last summer I spent four weeks with my grandmother.'),
      item(2, '~ She lives in a small stone house.'),
      item(3, '# Fishing'),
      item(4, '~ Every day we went to the lake.'),
      item(5, 'Grandma showed me how to be patient and quiet.'),
      item(6, '? TFNG The writer stayed for a month. {False | "four weeks"}'),
      item(7, '? TFNG Grandma has a dog. {Not given}'),
      item(8, '? MC How long did the writer stay? {*Four weeks | Two days | "four weeks"}'),
      item(9, '? WORD Find a word in paragraph 2 that means calm. {quiet}'),
      item(10, '? EXTRA The weather was bad.')
    ];

    function only(stage: 'gapped' | 'statements' | 'choice' | 'word') {
      component.enabledStages = new Set([stage]);
      component.start();
      expect(component.stage).toBe(stage);
    }

    it('lists only the stages the topic has, Gapped text first, and lets the teacher switch them off', async () => {
      await create(TASKS);
      expect(component.availableStages).toEqual(['gapped', 'reading', 'statements', 'choice', 'word']);
      component.toggleStage('gapped');
      component.toggleStage('reading');
      expect(component.activeStages).toEqual(['statements', 'choice', 'word']);
      component.start();
      expect(component.stage).toBe('statements');
    });

    it('Gapped text: the cards go back into the gaps in order; the extra one never fits', async () => {
      await create(TASKS);
      component.start();
      expect(component.stage).toBe('gapped');
      expect(component.gapCards.length).toBe(3);
      expect(component.currentGap?.id).toBe(1);
      expect(component.isOpenGap(component.text.sentences[1])).toBe(true);

      const extra = component.gapCards.find(card => card.sentence === -1)!;
      component.chooseGapCard(extra);
      expect(component.wrongCard).toBe(extra.id);
      vi.advanceTimersByTime(600);

      component.chooseGapCard(component.gapCards.find(card => card.sentence === 1)!);
      expect(component.filledGaps.has(1)).toBe(true);
      vi.advanceTimersByTime(950);
      component.chooseGapCard(component.gapCards.find(card => card.sentence === 2)!);
      vi.advanceTimersByTime(950);
      expect([component.scores.gapped.got, component.scores.gapped.total]).toEqual([1, 2]);
      expect(component.view).toBe('between');
    });

    it('True/False: a wrong answer shows the rule, the right one asks for the proof sentence', async () => {
      await create(TASKS);
      only('statements');
      component.answerStatement('yes');
      expect(component.ruleTipShown).toBe(true);
      vi.advanceTimersByTime(600);
      component.answerStatement('no');
      expect(component.taskPhase).toBe('prove');
      expect(component.articleMode).toBe('sentences');

      component.onSentenceClick(component.text.sentences[3]);
      expect(component.wrongSentence).toBe(3);
      expect(component.proofMistakes).toBe(1);
      vi.advanceTimersByTime(600);
      component.onSentenceClick(component.text.sentences[0]);
      expect(component.proved.has(0)).toBe(true);
      vi.advanceTimersByTime(950);

      // Not given: no proof step, a note, then the stage ends.
      expect(component.currentStatement?.answer).toBe('ng');
      component.onWindowKeyDown(new KeyboardEvent('keydown', { key: 'g' }));
      expect(component.taskPhase).toBe('done');
      vi.advanceTimersByTime(2600);
      expect(component.view).toBe('results');
      expect(component.scores.statements).toEqual({ got: 1, total: 2, played: true, proofGot: 0, proofTotal: 1 });
    });

    it('Multiple choice: right option, then prove it', async () => {
      await create(TASKS);
      only('choice');
      const wrong = component.currentOptions.findIndex(option => !option.correct);
      component.chooseOption(wrong);
      expect(component.wrongOption).toBe(wrong);
      vi.advanceTimersByTime(600);
      component.chooseOption(component.currentOptions.findIndex(option => option.correct));
      expect(component.taskPhase).toBe('prove');
      component.onSentenceClick(component.text.sentences[0]);
      vi.advanceTimersByTime(950);
      expect(component.scores.choice).toEqual({ got: 0, total: 1, played: true, proofGot: 1, proofTotal: 1 });
    });

    it('skips one question: shows its answer, scores nothing, and the stage goes on', async () => {
      await create(TASKS);
      only('statements');
      component.skipQuestion();
      // The right answer and its proof sentence are shown, without a point.
      expect([component.chosenOption, component.taskPhase, component.proved.has(0), component.skipping]).toEqual([1, 'done', true, true]);
      component.skipQuestion(); // ignored while the answer shows
      vi.advanceTimersByTime(1700);
      expect([component.stage, component.taskIndex, component.skipping]).toEqual(['statements', 1, false]);
      component.answerStatement('ng');
      vi.advanceTimersByTime(2600);
      expect(component.scores.statements).toEqual({ got: 1, total: 2, played: true, proofGot: 0, proofTotal: 1 });

      TestBed.resetTestingModule();
      await create(TASKS);
      only('gapped');
      component.onWindowKeyDown(new KeyboardEvent('keydown', { key: 's' }));
      expect(component.filledGaps.has(1)).toBe(true);
      expect(component.usedCards.has(component.gapCards.find(card => card.sentence === 1)!.id)).toBe(true);
      vi.advanceTimersByTime(950);
      expect(component.currentGap?.id).toBe(2);
    });

    it('skips one word to find, highlighting it', async () => {
      await create(TASKS);
      only('word');
      component.skipQuestion();
      expect(component.wordHits.has(wordId('quiet.'))).toBe(true);
      vi.advanceTimersByTime(750);
      expect([component.view, component.scores.word.got]).toEqual(['results', 0]);
    });

    it('Find the word: tap the word in the text', async () => {
      await create(TASKS);
      only('word');
      expect(component.articleMode).toBe('words');
      component.onWordClick(component.text.words[wordId('patient')]);
      expect(component.wrongWord).toBe(wordId('patient'));
      vi.advanceTimersByTime(600);
      component.onWordClick(component.text.words[wordId('quiet.')]);
      expect(component.wordHits.has(wordId('quiet.'))).toBe(true);
      vi.advanceTimersByTime(750);
      expect(component.view).toBe('results');
      expect(component.scores.word.got).toBe(0);
    });
  });

  it('scores stars from first-try answers and restarts with Shift+R', async () => {
    await create(STORY);
    component.start();
    component.onWordClick(component.text.words[wordId('grandmother.')]);
    vi.advanceTimersByTime(750);
    component.onWordClick(component.text.words[wordId('river')]);
    vi.advanceTimersByTime(750);
    component.continueToNext();
    for (let i = 0; i < 3; i++) {
      component.onSentenceClick(component.currentQuestion!);
      vi.advanceTimersByTime(950);
    }
    component.continueToNext();
    for (const paragraph of component.text.paragraphs) {
      component.revealAll();
      component.chooseHeading(component.text.headings[paragraph.heading]);
      vi.advanceTimersByTime(1700);
    }
    expect(component.view).toBe('results');
    expect(component.totalScore).toEqual({ got: 7, total: 7 });
    expect(component.stars).toBe(3);
    expect(component.rankKey).toBe('readingDetectiveRankMaster');

    component.onWindowKeyDown(new KeyboardEvent('keydown', { key: 'R', shiftKey: true }));
    expect(component.view).toBe('intro');
    expect(component.foundWords.size).toBe(0);
  });
});
