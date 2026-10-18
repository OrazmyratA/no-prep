import { vi } from 'vitest';
import { BookCreatorTaskPrepController } from './book-creator-task-prep-controller';
import { PdfPageCanvasComponent } from '../pdf-page-canvas/pdf-page-canvas';
import { BookElement, stripDraftElements } from '../../../core/book.model';
import { AiTopicError } from '../../../core/ai-topic/ai-topic.service';
import { A4_RATIO } from './lesson-plan-icons';

describe('BookCreatorTaskPrepController', () => {
  let creator: any;
  let prep: BookCreatorTaskPrepController;
  const ownFrame: BookElement = { id: 'own', type: 'focus', x: 0.1, y: 0.6, width: 0.8, height: 0.2, data: {} };

  beforeEach(() => {
    const pages = [
      { id: 'p1', type: 'pdf', pdfPage: 1, elements: [ownFrame, { id: 'g', type: 'game', x: 0, y: 0, width: 0.08, data: {} }] as BookElement[] },
      { id: 'p2', type: 'pdf', pdfPage: 2, elements: [] as BookElement[] }
    ];
    creator = {
      book: { pages, workbooks: [] },
      activePages: pages,
      activePageSource: 'main',
      activePageIndex: 0,
      aiPageLimit: 3,
      captureHistory: vi.fn(),
      markBookDirty: vi.fn(),
      selectMainPage: vi.fn(),
      getPagePdfUrl: () => 'book.pdf',
      getPageRotation: () => 0,
      languageService: { currentLang: 'en', translate: (key: string) => key },
      confirmationService: { confirm: vi.fn(async () => true) },
      renderAiPages: vi.fn(async () => ({ ok: true, pages: [1, 2], images: [new Blob(['1']), new Blob(['2'])] })),
      aiTopic: {
        getStartProvider: async () => ({ providers: [], start: { id: 'gemini' } }),
        prepareTasks: vi.fn(async () => ({
          exercises: [
            { id: 'e1', page: 0, box: { x: 0.08, y: 0.18, width: 0.8, height: 0.11 }, number: '1', title: 'Complete', kind: 'gapFill', gaps: [], bank: [], options: [], pairs: [] },
            // Already framed by the teacher: not repeated.
            { id: 'e2', page: 0, box: { x: 0.1, y: 0.62, width: 0.8, height: 0.18 }, number: '2', title: 'Match', kind: 'match', gaps: [], bank: [], options: [], pairs: [] },
            { id: 'e3', page: 1, box: { x: 0.1, y: 0.1, width: 0.5, height: 0.3 }, number: '3', title: 'Talk', kind: 'other', gaps: [], bank: [], options: [], pairs: [] }
          ],
          notes: ['Check exercise 3.']
        }))
      }
    };
    vi.spyOn(PdfPageCanvasComponent, 'readText').mockImplementation(async (_url, pageNumber) => pageNumber === 1
      ? [{ text: '1 Complete the sentences.', x: 0.1, y: 0.2, width: 0.5, height: 0.02 }, { text: 'She ____ .', x: 0.12, y: 0.25, width: 0.4, height: 0.02 }]
      : []);
    prep = new BookCreatorTaskPrepController(creator);
    // Guide dots, answer keys and videos have their own tests.
    prep.marks = { guides: false, keys: false, videos: false };
  });

  afterEach(() => vi.restoreAllMocks());

  it('frames each exercise as a draft after the page\'s own frames, snapped to the printed text', async () => {
    await prep.analyse();
    expect(creator.renderAiPages).toHaveBeenCalledWith('1', 3);
    expect(creator.captureHistory).toHaveBeenCalledTimes(1);
    const [p1, p2] = creator.activePages;
    expect(p1.elements.map((e: BookElement) => e.id).slice(0, 1)).toEqual(['own']);
    const draft = p1.elements[1];
    expect([draft.type, draft.data.taskDraft, draft.data.exerciseNumber, draft.data.exerciseKind]).toEqual(['focus', true, '1', 'gapFill']);
    expect(draft.x).toBeCloseTo(0.092, 4); // snapped to the text
    expect(p1.elements.filter((e: BookElement) => e.data['taskDraft']).length).toBe(1); // exercise 2 was framed already
    expect(p2.elements.length).toBe(1);
    expect(prep.lastRun).toEqual({ found: 3, placed: 2, snapped: true, gaps: 0, exact: 0, targets: 0, exactTargets: 0, pairs: 0, exactPairs: 0, squares: 0, guides: 0, keys: 0, videos: 0 });
    expect(prep.notes).toEqual(['Check exercise 3.']);
    expect(prep.drafts.map(d => [d.pageNumber, prep.draftLabel(d)])).toEqual([[1, '1 · Complete'], [2, '3 · Talk']]);

    // Analysing again replaces the drafts instead of adding more.
    await prep.analyse();
    expect(prep.drafts.length).toBe(2);
  });

  it('accepts a draft as a normal frame, removes one, and keeps drafts away from students', async () => {
    await prep.analyse();
    const [first, second] = prep.drafts;
    prep.accept(first);
    expect(first.frame!.data).toEqual({});
    expect(prep.drafts.length).toBe(1);

    const book = structuredClone(creator.book);
    stripDraftElements(book);
    expect(book.pages[1].elements.length).toBe(0); // the draft on page 2 is gone for students
    expect(book.pages[0].elements.some((e: BookElement) => e.id === first.frame!.id)).toBe(true);

    prep.remove(second);
    expect(prep.drafts.length).toBe(0);
  });

  it('accepts all, or removes all after asking', async () => {
    await prep.analyse();
    await prep.removeAll();
    expect(creator.confirmationService.confirm).toHaveBeenCalled();
    expect(prep.drafts.length).toBe(0);
    await prep.analyse();
    prep.acceptAll();
    expect(prep.drafts.length).toBe(0);
    expect(creator.activePages[1].elements[0].type).toBe('focus');
  });

  it('puts a typing box with the answers on each printed blank of a gap-fill exercise', async () => {
    vi.spyOn(PdfPageCanvasComponent, 'readText').mockResolvedValue([
      { text: '1 Complete the sentences.', x: 0.1, y: 0.2, width: 0.5, height: 0.02 },
      { text: 'She ____ to school.', x: 0.12, y: 0.25, width: 0.38, height: 0.02 },
      { text: 'They ____ football.', x: 0.12, y: 0.28, width: 0.38, height: 0.02 }
    ]);
    creator.renderAiPages = vi.fn(async () => ({ ok: true, pages: [2], images: [new Blob(['2'])] }));
    creator.aiTopic.prepareTasks = vi.fn(async () => ({
      exercises: [{
        id: 'e1', page: 0, box: { x: 0.08, y: 0.18, width: 0.6, height: 0.14 }, number: '1', title: 'Complete', kind: 'gapFill', bank: [], options: [], pairs: [],
        gaps: [
          { before: 'She', answers: ['goes'], box: null },
          { before: 'They', answers: ["don't play", 'do not play'], box: null }
        ]
      }],
      notes: []
    }));
    await prep.analyse();
    const page = creator.activePages[1];
    const tasks = page.elements.filter((e: BookElement) => e.type === 'textTask');
    expect(tasks.map((t: BookElement) => t.data['acceptedAnswers'])).toEqual([['goes'], ["don't play", 'do not play']]);
    // "She ____ to school." - the blank is characters 4-7 of a 19-character run.
    expect(tasks[0].x).toBeLessThan(0.12 + 0.38 * 4 / 19);
    expect(tasks[0].x + tasks[0].width).toBeGreaterThan(0.12 + 0.38 * 8 / 19);
    expect([prep.lastRun?.gaps, prep.lastRun?.exact]).toEqual([2, 2]);
    const [draft] = prep.drafts;
    expect([draft.tasks.length, prep.answersPreview(draft)]).toEqual([2, "goes, don't play"]);

    prep.accept(draft);
    expect(tasks[1].data).toEqual({ acceptedAnswers: ["don't play", 'do not play'] });
  });

  it('turns a word-box exercise into word-bank gaps, and removes the bank with them', async () => {
    vi.spyOn(PdfPageCanvasComponent, 'readText').mockResolvedValue([]); // a scan: the AI's boxes
    creator.renderAiPages = vi.fn(async () => ({ ok: true, pages: [2], images: [new Blob(['2'])] }));
    creator.aiTopic.prepareTasks = vi.fn(async () => ({
      exercises: [{
        id: 'e1', page: 0, box: { x: 0.1, y: 0.1, width: 0.8, height: 0.3 }, number: '2', title: 'Use the words', kind: 'wordBank', options: [], pairs: [],
        bank: ['apple', 'Milk', 'bread'],
        gaps: [
          { before: 'I like', answers: ['milk'], box: { x: 0.3, y: 0.2, width: 0.08, height: 0.02 } },
          { before: 'a red', answers: ['cherry'], box: { x: 0.3, y: 0.25, width: 0.08, height: 0.02 } }
        ]
      }],
      notes: []
    }));
    await prep.analyse();
    const page = creator.activePages[1];
    expect(page.wordBanks.map((b: any) => b.options.map((o: any) => o.text))).toEqual([['apple', 'Milk', 'bread']]);
    const gaps = page.elements.filter((e: BookElement) => e.type === 'choiceTask');
    const milk = page.wordBanks[0].options[1];
    expect(gaps.map((g: BookElement) => g.data['correctOptionId'])).toEqual([milk.id, '']);
    expect(gaps[0].height).toBeGreaterThanOrEqual(0.025); // grown to a usable size
    expect([prep.lastRun?.gaps, prep.lastRun?.exact, prep.lastRun?.snapped]).toEqual([2, 0, false]);
    const [draft] = prep.drafts;
    expect(prep.missingAnswers(draft)).toBe(1); // "cherry" is not in the box

    prep.remove(draft);
    expect(page.elements.length).toBe(0);
    expect(page.wordBanks).toEqual([]);
  });

  it('puts a circle target on each option of a multiple-choice exercise, the right ones marked', async () => {
    vi.spyOn(PdfPageCanvasComponent, 'readText').mockResolvedValue([
      { text: '3 Choose the right word.', x: 0.1, y: 0.2, width: 0.5, height: 0.02 },
      { text: 'Yesterday I went home.', x: 0.12, y: 0.25, width: 0.4, height: 0.02 },
      { text: 'a go   b went   c gone', x: 0.12, y: 0.28, width: 0.3, height: 0.02 }
    ]);
    creator.renderAiPages = vi.fn(async () => ({ ok: true, pages: [2], images: [new Blob(['2'])] }));
    creator.aiTopic.prepareTasks = vi.fn(async () => ({
      exercises: [{
        id: 'e1', page: 0, box: { x: 0.08, y: 0.18, width: 0.6, height: 0.14 }, number: '3', title: 'Choose', kind: 'choice', gaps: [], bank: [], pairs: [],
        options: [
          { text: 'go', correct: false, box: null },
          { text: 'went', correct: true, box: null },
          { text: 'gone', correct: false, box: null },
          { text: '', correct: false, box: { x: 0.7, y: 0.3, width: 0.01, height: 0.01 } } // a picture
        ]
      }],
      notes: []
    }));
    await prep.analyse();
    const targets = creator.activePages[1].elements.filter((e: BookElement) => e.type === 'circleTask');
    expect(targets.map((t: BookElement) => t.data['correct'])).toEqual([false, true, false, false]);
    // "went" is the option on the last line, not the word in the sentence above it.
    expect(targets[1].y).toBeGreaterThan(0.27);
    expect([targets[3].width, targets[3].height]).toEqual([0.03, 0.025]); // the picture: tappable size
    expect([prep.lastRun?.targets, prep.lastRun?.exactTargets]).toEqual([4, 3]);
    const [draft] = prep.drafts;
    expect([prep.hasOptions(draft), prep.answersPreview(draft), prep.noCorrectOption(draft)]).toEqual([true, 'went', false]);

    targets[1].data['correct'] = false;
    expect(prep.noCorrectOption(draft)).toBe(true);
    targets[1].data['correct'] = true;
    prep.accept(draft);
    expect(targets[1].data).toEqual({ correct: true });
  });

  it('links each matching pair with two dots lined up beside the columns', async () => {
    vi.spyOn(PdfPageCanvasComponent, 'readText').mockResolvedValue([
      { text: '4 Match the animals and their babies.', x: 0.1, y: 0.2, width: 0.6, height: 0.02 },
      { text: '1 cat', x: 0.12, y: 0.25, width: 0.06, height: 0.02 },
      { text: 'a puppy', x: 0.5, y: 0.25, width: 0.1, height: 0.02 },
      { text: '2 dog', x: 0.12, y: 0.29, width: 0.06, height: 0.02 },
      { text: 'b kitten', x: 0.5, y: 0.29, width: 0.1, height: 0.02 },
      { text: '3 horse', x: 0.12, y: 0.33, width: 0.09, height: 0.02 },
      { text: 'c foal', x: 0.5, y: 0.33, width: 0.08, height: 0.02 }
    ]);
    creator.renderAiPages = vi.fn(async () => ({ ok: true, pages: [2], images: [new Blob(['2'])] }));
    creator.aiTopic.prepareTasks = vi.fn(async () => ({
      exercises: [{
        id: 'e1', page: 0, box: { x: 0.08, y: 0.18, width: 0.6, height: 0.2 }, number: '4', title: 'Match', kind: 'match', gaps: [], bank: [], options: [],
        pairs: [
          { left: 'cat', right: 'kitten', leftBox: null, rightBox: null },
          { left: 'dog', right: 'puppy', leftBox: null, rightBox: null },
          { left: 'horse', right: 'foal', leftBox: null, rightBox: null },
          { left: 'cow', right: 'calf', leftBox: null, rightBox: null } // not printed, no box: left out
        ]
      }],
      notes: []
    }));
    await prep.analyse();
    const dots = creator.activePages[1].elements.filter((e: BookElement) => e.type === 'matchTask');
    expect(dots.length).toBe(6);
    const [a1, b1] = dots;
    expect([a1.data['side'], b1.data['side'], a1.data['pairId'] === b1.data['pairId'], a1.data['groupId'] === b1.data['groupId']]).toEqual(['A', 'B', true, true]);
    // cat → kitten: the B dot sits on kitten's line (level with its letters), before the second column.
    expect(b1.y).toBeCloseTo(0.29 + 0.02 * 0.71 - b1.height / 2, 3);
    expect(b1.x + b1.width).toBeLessThanOrEqual(0.5);
    // A dots line up after the longest item of the first column ("3 horse").
    const aDots = dots.filter((d: BookElement) => d.data['side'] === 'A');
    expect(new Set(aDots.map((d: BookElement) => d.x)).size).toBe(1);
    expect(aDots[0].x).toBeGreaterThanOrEqual(0.21);
    expect([prep.lastRun?.pairs, prep.lastRun?.exactPairs]).toEqual([3, 3]);
    const [draft] = prep.drafts;
    expect([prep.countKey(draft), prep.taskCount(draft), prep.answersPreview(draft)])
      .toEqual(['taskPrepPairs', 3, 'cat → kitten, dog → puppy, horse → foal']);

    prep.accept(draft);
    expect(Object.keys(a1.data).sort()).toEqual(['groupId', 'pairId', 'side']);
  });

  it('puts a one-letter typing box on each crossword square to fill, lined up with the printed example', async () => {
    // The example's letters are printed in the first row; the grid really starts at x 0.51, y 0.105.
    const letter = (text: string, col: number) => ({ text, x: 0.51 + (col + 0.5) * 0.04 - 0.005, y: 0.125 - 0.02 * 0.71, width: 0.01, height: 0.02 });
    vi.spyOn(PdfPageCanvasComponent, 'readText').mockResolvedValue([letter('G', 0), letter('E', 1), letter('T', 2)]);
    creator.renderAiPages = vi.fn(async () => ({ ok: true, pages: [2], images: [new Blob(['2'])] }));
    creator.aiTopic.prepareTasks = vi.fn(async () => ({
      exercises: [{
        id: 'e1', page: 0, box: { x: 0.45, y: 0.05, width: 0.5, height: 0.5 }, number: '2', title: 'Crossword', kind: 'crossword', gaps: [], bank: [], options: [], pairs: [],
        grid: {
          box: { x: 0.5, y: 0.1, width: 0.44, height: 0.4 }, rows: 10, cols: 11,
          words: [
            { number: '1', answer: 'GET DRESSED', row: 0, col: 0, across: true, given: true },
            { number: '5', answer: 'GAME', row: 0, col: 0, across: false, given: false },
            { number: '6', answer: 'TEN', row: 0, col: 2, across: false, given: false }
          ]
        }
      }],
      notes: []
    }));
    await prep.analyse();
    const squares = creator.activePages[1].elements.filter((e: BookElement) => e.type === 'textTask');
    // The given word's squares (G, T) are not asked again.
    expect(squares.map((s: BookElement) => s.data['acceptedAnswers'])).toEqual([['A', 'a'], ['E', 'e'], ['M', 'm'], ['N', 'n'], ['E', 'e']]);
    // Moved onto the printed grid: column 0 starts at 0.51, row 1 at 0.145.
    expect(squares[0].x).toBeCloseTo(0.51 + 0.004, 3);
    expect(squares[0].y).toBeCloseTo(0.145 + 0.004, 3);
    expect(squares[0].width).toBeCloseTo(0.032, 3);
    expect(prep.lastRun?.squares).toBe(5);
    const [draft] = prep.drafts;
    expect([prep.countKey(draft), prep.taskCount(draft), prep.answersPreview(draft)]).toEqual(['taskPrepWords', 2, 'GAME, TEN']);
  });

  it('puts a guide dot and an answer key right after the instruction\'s last line, and a video after its sign', async () => {
    prep.marks = { guides: true, keys: true, videos: true };
    vi.spyOn(PdfPageCanvasComponent, 'readText').mockResolvedValue([
      { text: '1 Complete the sentences with', x: 0.1, y: 0.2, width: 0.4, height: 0.02 },
      { text: 'the words.', x: 0.1, y: 0.225, width: 0.12, height: 0.02 },
      { text: 'She ____ to school.', x: 0.12, y: 0.27, width: 0.38, height: 0.02 },
      { text: 'Video', x: 0.1, y: 0.6, width: 0.06, height: 0.02 },
      { text: '2 Talk about your day.', x: 0.1, y: 0.7, width: 0.3, height: 0.02 },
      { text: 'Next column', x: 0.42, y: 0.7, width: 0.2, height: 0.02 }
    ]);
    creator.renderAiPages = vi.fn(async () => ({ ok: true, pages: [2], images: [new Blob(['2'])] }));
    creator.aiTopic.prepareTasks = vi.fn(async () => ({
      exercises: [
        { id: 'e1', page: 0, box: { x: 0.08, y: 0.18, width: 0.6, height: 0.14 }, number: '1', title: 'Complete', instruction: 'Complete the sentences with the words.', instructionBox: null,
          kind: 'gapFill', gaps: [], bank: [], options: [], pairs: [], grid: null },
        // Speaking: a guide dot, no answer key. The line goes on with the next column: no room after it.
        { id: 'e2', page: 0, box: { x: 0.08, y: 0.68, width: 0.32, height: 0.1 }, number: '2', title: 'Talk', instruction: 'Talk about your day.', instructionBox: null,
          kind: 'other', gaps: [], bank: [], options: [], pairs: [], grid: null }
      ],
      videos: [{ page: 0, text: 'Video', box: null }],
      notes: []
    }));
    await prep.analyse();
    const page = creator.activePages[1];
    const [guide, key, guide2] = page.elements.filter((e: BookElement) => e.type === 'guideDot' || e.type === 'answerKey');
    expect([guide.type, key.type, guide2.type]).toEqual(['guideDot', 'answerKey', 'guideDot']);
    expect(guide.x).toBeCloseTo(0.1 + 0.12 + 0.006, 4); // after "the words."
    expect(key.x).toBeCloseTo(guide.x + 0.044, 4);
    expect(guide.y + 0.04 / A4_RATIO / 2).toBeCloseTo(0.225 + 0.02 * 0.71, 3); // level with its letters
    // In the frame's top-right corner (the frame was snapped to its text).
    expect(guide2.x + guide2.width).toBeCloseTo(0.408 - 0.004, 4);
    expect(guide2.y).toBeCloseTo(0.692 + 0.004, 4);
    const video = page.elements.find((e: BookElement) => e.type === 'video');
    expect([video.x, video.data['src']]).toEqual([0.166, '']);
    expect([prep.lastRun?.guides, prep.lastRun?.keys, prep.lastRun?.videos]).toEqual([2, 1, 1]);

    const [first, , videoDraft] = prep.drafts;
    expect([prep.hasMark(first, 'guideDot'), prep.hasMark(first, 'answerKey')]).toEqual([true, true]);
    expect([prep.draftKind(videoDraft), prep.draftLabel(videoDraft)]).toEqual(['video', 'Video']);
    prep.accept(first);
    expect(guide.data).toEqual({ text: '', audioFiles: [], guideTracks: [] });

    // The teacher's own guide dots (the accepted one, one added by hand): not placed again.
    prep.remove(prep.drafts[0]);
    page.elements.push({ id: 'mine', type: 'guideDot', x: 0.3, y: 0.7, width: 0.04, height: 0.04, data: {} });
    await prep.analyse();
    expect(page.elements.filter((e: BookElement) => e.type === 'guideDot').map((e: BookElement) => e.id)).toEqual([guide.id, 'mine']);
  });

  it('leaves an exercise alone when the teacher already made its tasks', async () => {
    creator.activePages[1].elements.push({ id: 'mine', type: 'textTask', x: 0.3, y: 0.2, width: 0.08, height: 0.03, data: { acceptedAnswers: ['x'] } });
    creator.renderAiPages = vi.fn(async () => ({ ok: true, pages: [2], images: [new Blob(['2'])] }));
    creator.aiTopic.prepareTasks = vi.fn(async () => ({
      exercises: [{
        id: 'e1', page: 0, box: { x: 0.29, y: 0.19, width: 0.1, height: 0.05 }, number: '1', title: 'Complete', kind: 'gapFill', bank: [], options: [], pairs: [],
        gaps: [{ before: '', answers: ['y'], box: { x: 0.3, y: 0.2, width: 0.08, height: 0.02 } }]
      }],
      notes: []
    }));
    await prep.analyse();
    expect(creator.activePages[1].elements.filter((e: BookElement) => e.type === 'textTask').map((e: BookElement) => e.id)).toEqual(['mine']);
  });

  it('shows why the pages could not be read, or the AI failed', async () => {
    creator.renderAiPages = vi.fn(async () => ({ ok: false, key: 'creatorAiPagesNotPdf', params: { page: 1 } }));
    await prep.analyse();
    expect(prep.error).toEqual({ key: 'creatorAiPagesNotPdf', params: { page: 1 }, detail: '' });

    creator.renderAiPages = vi.fn(async () => ({ ok: true, pages: [1], images: [new Blob(['1'])] }));
    creator.aiTopic.prepareTasks = vi.fn(async () => { throw new AiTopicError('Quota exceeded'); });
    await prep.analyse();
    expect(prep.error).toEqual({ key: 'taskPrepFailed', params: {}, detail: 'Quota exceeded' });
    expect(prep.analysing).toBe(false);
  });
});
