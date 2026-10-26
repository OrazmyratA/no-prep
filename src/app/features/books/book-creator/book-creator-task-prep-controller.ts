import { AiTopicError, AiTopicProviderId, AiTopicProviderStatus, providerShortLabel } from '../../../core/ai-topic/ai-topic.service';
import { AiCropBox } from '../../../core/ai-topic/ai-topic-draft';
import { ExerciseKind, PreparedExercise, TaskPrepResult } from '../../../core/ai-topic/task-prep';
import { GridAnchor, circleBox, gridCells, inkBox, markSize, marksAfter, marksInCorner, matchDots, placeGaps, separateBoxes, squareBox } from '../../../core/ai-topic/task-gaps';
import { BookElement, BookElementType, BookPage, BookWordBank } from '../../../core/book.model';
import { PdfTextItem, findBlanks, findInstructionEnd, findPhrases, snapBoxToText, textInBox } from '../../../core/pdf-text';
import { LANGUAGE_NAMES } from '../../topics/ai-topic-panel/ai-topic-panel';
import { PdfPageCanvasComponent } from '../pdf-page-canvas/pdf-page-canvas';
import { AiPagesResult } from './book-creator-game-controller';
import { A4_RATIO, pageRatio } from './lesson-plan-icons';

// "✨ Prepare tasks" in the book creator's right panel (docs/ai-task-prep.md). The AI finds the
// exercises on the pages; each becomes a draft focus frame, and a gap-fill or word-box exercise
// also gets a draft typing box (text task) or word-bank gap (choice task) on each blank, with the
// AI's answers; a circle or multiple-choice exercise gets a circle target on each option, the
// right ones marked; a matching exercise gets a dot at each end of every pair; a crossword gets a
// one-letter typing box on each square to fill. Everything is snapped to the PDF's printed text
// when it has one. Drafts carry
// their exercise (id, number, title, kind) in their data, so the panel's list is read from the
// pages themselves and survives closing the book.

/** One prepared exercise still waiting for the teacher: its frame and its tasks. */
export interface TaskDraft {
  exerciseId: string;
  page: BookPage;
  /** 1-based number of the page in its page list. */
  pageNumber: number;
  /** Its focus frame, or null when the page already had one around it. */
  frame: BookElement | null;
  /** Its typing boxes / word-bank gaps, in order. */
  tasks: BookElement[];
  /** Its guide dot, answer key and video marks. */
  marks: BookElement[];
}

/** Which marks the AI places as well: guide dots, answer keys, videos (remembered). */
export interface TaskPrepMarks {
  guides: boolean;
  keys: boolean;
  videos: boolean;
  /** A note with the AI's game idea, on exercises the page's tasks cannot make interactive. */
  notes: boolean;
}

const MARKS_KEY = 'taskPrepMarks';
const MARK_TYPES: BookElementType[] = ['guideDot', 'answerKey', 'note', 'video'];
/** Exercises with answers to check get an answer key. */
const ANSWERED_KINDS: ExerciseKind[] = ['gapFill', 'wordBank', 'tick', 'order', 'circle', 'choice', 'match', 'crossword', 'open'];
/** Marks may reach this far past the frame's right edge after a long line. */
const MARK_OVERHANG = 0.05;

/** A focus box overlapping an existing one this much (intersection / smaller area) is a repeat. */
const SAME_FRAME = 0.6;

/** What marks an element as a draft; removed when it is accepted. */
const DRAFT_KEYS = ['taskDraft', 'prepId', 'exerciseId', 'exerciseNumber', 'exerciseTitle', 'exerciseKind', 'optionText'];

export interface TaskPrepError {
  key: string;
  params: Record<string, string | number>;
  /** The AI's own message, shown under the translated one. */
  detail: string;
}

export interface TaskPrepRun {
  found: number;
  /** Frames placed. */
  placed: number;
  /** The PDF had a text layer to snap to. */
  snapped: boolean;
  /** Typing boxes and word-bank gaps placed, and how many sit exactly on a printed blank. */
  gaps: number;
  exact: number;
  /** Circle targets placed, and how many sit exactly on the option's printed words. */
  targets: number;
  exactTargets: number;
  /** Matching pairs placed, and how many have both ends on printed words. */
  pairs: number;
  exactPairs: number;
  /** Crossword squares to fill. */
  squares: number;
  /** Guide dots, answer keys and videos placed. */
  guides: number;
  keys: number;
  videos: number;
  /** Game ideas left as notes. */
  notes: number;
}

export class BookCreatorTaskPrepController {
  constructor(private readonly creator: any) {}

  /** The panel section is expanded. */
  open = false;
  /** The AIs, as in the topic form's ✨ AI window; the choice is shared with it. */
  providers: AiTopicProviderStatus[] = [];
  providerId: AiTopicProviderId | null = null;
  pagesText = '';
  analysing = false;
  error: TaskPrepError | null = null;
  /** The AI's notes from the last Analyse. */
  notes: string[] = [];
  lastRun: TaskPrepRun | null = null;
  marks: TaskPrepMarks = loadMarks();

  /** Opens or closes the panel section; opening reads which AIs are linked. */
  toggle(): void {
    this.open = !this.open;
    if (this.open) void this.loadProviders();
  }

  async loadProviders(): Promise<void> {
    const { providers, start } = await this.creator.aiTopic.getStartProvider();
    this.inZone(() => {
      this.providers = providers;
      this.providerId = start?.id ?? null;
    });
  }

  get provider(): AiTopicProviderStatus | null {
    return this.providers.find(p => p.id === this.providerId) ?? null;
  }

  /** At least one AI has a key. */
  get anyProviderLinked(): boolean {
    return this.providers.some(p => p.configured);
  }

  providerLabel(provider: AiTopicProviderStatus): string {
    return providerShortLabel(provider.id);
  }

  /** Switches AI for Prepare tasks and the topic form; the choice is shared. */
  selectProvider(id: string): void {
    const provider = this.providers.find(p => p.id === id);
    if (!provider?.configured || this.analysing) return;
    this.providerId = provider.id;
    this.creator.aiTopic.setSelectedProvider(provider.id);
    this.error = null;
  }

  /** The AI to call: the one picked here, or the shared start choice. */
  private async providerToUse(): Promise<string> {
    if (this.provider?.configured) return this.provider.id;
    const { start } = await this.creator.aiTopic.getStartProvider();
    return start?.id ?? 'gemini';
  }

  setMark(key: keyof TaskPrepMarks, on: boolean): void {
    this.marks = { ...this.marks, [key]: on };
    try {
      localStorage.setItem(MARKS_KEY, JSON.stringify(this.marks));
    } catch {
      // Only a convenience: the choice is not remembered.
    }
  }

  /** What the pages box shows: the teacher's text, or the open page. */
  get pagesValue(): string {
    return this.pagesText || String(this.creator.activePageIndex + 1);
  }

  /** Reads the pages, asks the AI for their exercises and prepares each one as a draft. */
  async analyse(): Promise<void> {
    const limit: number | null = this.creator.aiPageLimit;
    if (this.analysing || limit === null) return;
    this.error = null;
    this.analysing = true;
    try {
      const rendered: AiPagesResult = await this.creator.renderAiPages(this.pagesValue, limit);
      if (!rendered.ok) {
        this.inZone(() => this.error = { key: rendered.key, params: rendered.params, detail: '' });
        return;
      }
      const pages: BookPage[] = this.creator.activePages;
      const targets = rendered.pages.map(n => pages[n - 1]);
      const [result, texts, ratios] = await Promise.all([
        this.askAi(rendered),
        Promise.all(targets.map(page => this.readText(page))),
        Promise.all(rendered.images.map(pageRatio))
      ]);
      this.inZone(() => this.place(result, targets, texts, ratios));
    } catch (error) {
      console.error('Prepare tasks failed', error);
      this.inZone(() => this.error = { key: 'taskPrepFailed', params: {}, detail: error instanceof AiTopicError ? error.message : '' });
    } finally {
      this.inZone(() => this.analysing = false);
    }
  }

  private async askAi(rendered: Extract<AiPagesResult, { ok: true }>): Promise<TaskPrepResult> {
    const providerId = await this.providerToUse();
    const lang: string = this.creator.languageService.currentLang;
    return this.creator.aiTopic.prepareTasks(providerId, {
      pageNumbers: rendered.pages,
      teacherLanguage: LANGUAGE_NAMES[lang] ?? 'English'
    }, rendered.images);
  }

  /** The page's printed text, or [] (a scanned page, or not a PDF page). */
  private async readText(page: BookPage | undefined): Promise<PdfTextItem[]> {
    if (!page || page.type !== 'pdf') return [];
    const workbook = this.creator.activePageSource === 'workbook' ? this.creator.activeWorkbook : null;
    const url: string = this.creator.getPagePdfUrl(page, workbook);
    if (!url) return [];
    return PdfPageCanvasComponent.readText(url, page.pdfPage || 1, this.creator.getPageRotation(page)).catch(() => []);
  }

  /**
   * Replaces the drafts on these pages with the new ones, in one undo step: a frame per exercise
   * (after the page's own frames, in reading order; skipped when one is already there) and its
   * gaps (skipped when the teacher already put tasks inside it).
   */
  private place(result: TaskPrepResult, targets: BookPage[], texts: PdfTextItem[][], ratios: number[] = []): void {
    this.creator.captureHistory();
    const prepId = `prep-${Date.now().toString(36)}`;
    const run: TaskPrepRun = {
      found: result.exercises.length, placed: 0, snapped: texts.some(items => items.length > 0), gaps: 0, exact: 0, targets: 0, exactTargets: 0,
      pairs: 0, exactPairs: 0, squares: 0, guides: 0, keys: 0, videos: 0, notes: 0
    };
    targets.forEach((page, index) => {
      if (!page) return;
      this.removeElements(page, element => this.isTaskDraft(element));
      const frames: BookElement[] = [];
      const tasks: BookElement[] = [];
      const marks: BookElement[] = [];
      const text = texts[index] ?? [];
      const ratio = ratios[index] || A4_RATIO;
      const placedFrames: { box: AiCropBox; draft: Record<string, unknown> }[] = [];
      for (const exercise of result.exercises.filter(e => e.page === index)) {
        const box = snapBoxToText(exercise.box, text);
        const draft = this.draftData(exercise, prepId);
        placedFrames.push({ box, draft });
        const placedMarks = this.exerciseMarks(page, exercise, box, text, ratio, draft);
        marks.push(...placedMarks);
        run.guides += placedMarks.filter(mark => mark.type === 'guideDot').length;
        run.keys += placedMarks.filter(mark => mark.type === 'answerKey').length;
        run.notes += placedMarks.filter(mark => mark.type === 'note').length;
        if (!page.elements.concat(frames).some(element => element.type === 'focus' && overlap(element, box) >= SAME_FRAME)) {
          frames.push({ id: this.newId('focus-prep'), type: 'focus', x: box.x, y: box.y, width: box.width, height: box.height, data: { ...draft } });
        }
        const hasOwnTasks = page.elements.some(element =>
          (element.type === 'textTask' || element.type === 'choiceTask' || element.type === 'circleTask' || element.type === 'matchTask')
          && !this.isTaskDraft(element) && overlap(element, box) >= SAME_FRAME);
        if (exercise.gaps.length && !hasOwnTasks) {
          const placed = this.gapTasks(page, exercise, findBlanks(text, box), ratio, draft);
          tasks.push(...placed.elements);
          run.gaps += placed.elements.length;
          run.exact += placed.exact;
        }
        if (exercise.options.length && !hasOwnTasks) {
          const placed = this.optionTasks(exercise, findPhrases(text, box, exercise.options.map(option => option.text)), ratio, draft);
          tasks.push(...placed.elements);
          run.targets += placed.elements.length;
          run.exactTargets += placed.exact;
        }
        if (exercise.pairs.length && !hasOwnTasks) {
          const placed = this.pairTasks(exercise, text, box, ratio, draft);
          tasks.push(...placed.elements);
          run.pairs += placed.elements.length / 2;
          run.exactPairs += placed.exact;
        }
        if (exercise.grid && !hasOwnTasks) {
          const placed = this.crosswordTasks(exercise, text, draft);
          tasks.push(...placed);
          run.squares += placed.length;
        }
      }
      const videos = this.videoMarks(page, (result.videos ?? []).filter(video => video.page === index), text, ratio, prepId, placedFrames);
      marks.push(...videos);
      run.videos += videos.length;
      const lastFocus = page.elements.reduce((last, element, i) => element.type === 'focus' ? i : last, -1);
      page.elements.splice(lastFocus + 1, 0, ...frames);
      page.elements.push(...tasks, ...marks);
      run.placed += frames.length;
    });
    this.notes = result.notes;
    this.lastRun = run;
    this.creator.selectedElementId = null;
    this.creator.markBookDirty();
  }

  /**
   * A typing box (text task) per gap, or for a word-box, tick or numbering exercise a word-bank
   * gap (choice task) per gap with the box's words (✔ / ✘, T / F, the numbers) as a new word bank
   * on the page. Ticks and numbers go in empty boxes the PDF has no text for: a square on the
   * AI's box.
   */
  private gapTasks(page: BookPage, exercise: PreparedExercise, blanks: ReturnType<typeof findBlanks>, ratio: number, draft: Record<string, unknown>): { elements: BookElement[]; exact: number } {
    const inBoxes = exercise.kind === 'tick' || exercise.kind === 'order';
    const places = placeGaps(exercise.gaps, blanks, inBoxes ? box => squareBox(box, ratio) : undefined);
    let bank: BookWordBank | null = null;
    if ((exercise.kind === 'wordBank' || inBoxes) && exercise.bank.length) {
      bank = {
        id: this.newId('word-bank'),
        options: exercise.bank.map(text => ({ id: this.newId('word-option'), text })),
        prepId: String(draft['prepId'])
      };
      page.wordBanks = [...(page.wordBanks ?? []), bank];
    }
    const elements: BookElement[] = [];
    let exact = 0;
    exercise.gaps.forEach((gap, i) => {
      const place = places[i];
      if (!place) return;
      if (place.exact) exact++;
      const answer = gap.answers[0].toLocaleLowerCase();
      const option = bank?.options.find(o => o.text.toLocaleLowerCase() === answer);
      elements.push({
        id: this.newId(bank ? 'choice-task' : 'text-task'),
        type: bank ? 'choiceTask' : 'textTask',
        ...place.box,
        data: bank
          ? { wordBankId: bank.id, correctOptionId: option?.id ?? '', ...draft }
          : { acceptedAnswers: [...gap.answers], ...draft }
      });
    });
    return { elements, exact };
  }

  /**
   * A circle target per option: around its printed words when found, else where the AI saw it
   * (a picture option, or a scan). Right options are marked correct.
   */
  private optionTasks(exercise: PreparedExercise, found: (AiCropBox | null)[], ratio: number, draft: Record<string, unknown>): { elements: BookElement[]; exact: number } {
    const boxes = exercise.options.map((option, i) =>
      found[i] ? circleBox(found[i]!, ratio) : option.box ? atLeast(option.box) : null);
    // Options printed close together must not share a target.
    const printed = boxes.filter((box, i): box is AiCropBox => !!box && !!found[i]);
    separateBoxes(printed);
    const elements: BookElement[] = [];
    exercise.options.forEach((option, i) => {
      const box = boxes[i];
      if (!box) return;
      elements.push({
        id: this.newId('circle-task'),
        type: 'circleTask',
        ...box,
        data: { correct: option.correct, optionText: option.text, ...draft }
      });
    });
    return { elements, exact: printed.length };
  }

  /**
   * A one-letter typing box on every square of a crossword that students fill (not the worked
   * example's), answering its letter in either case. The grid is lined up with the example's
   * printed letters when the PDF has them.
   */
  private crosswordTasks(exercise: PreparedExercise, text: PdfTextItem[], draft: Record<string, unknown>): BookElement[] {
    const grid = exercise.grid!;
    // Each square's letter and the first word through it; the given words' squares are done.
    const squares = new Map<string, { row: number; col: number; letter: string; word: string }>();
    const given = new Map<string, { row: number; col: number; letter: string }>();
    for (const word of [...grid.words].sort((a, b) => Number(b.given) - Number(a.given))) {
      [...word.answer].forEach((letter, i) => {
        if (!letter.trim()) return;
        const row = word.row + (word.across ? 0 : i);
        const col = word.col + (word.across ? i : 0);
        const key = `${row}:${col}`;
        if (word.given) given.set(key, { row, col, letter });
        else if (!given.has(key) && !squares.has(key)) squares.set(key, { row, col, letter, word: word.answer.trim() });
      });
    }
    const cells = gridCells(grid.box, grid.rows, grid.cols, this.gridAnchors(grid, [...given.values()], text));
    return [...squares.values()]
      .sort((a, b) => a.row - b.row || a.col - b.col)
      .map(square => ({
        id: this.newId('text-task'),
        type: 'textTask' as const,
        ...cells(square),
        data: { acceptedAnswers: unique([square.letter, square.letter.toLocaleLowerCase()]), optionText: square.word, ...draft }
      }));
  }

  /** The given words' letters as printed in the PDF, each the one nearest its square. */
  private gridAnchors(grid: NonNullable<PreparedExercise['grid']>, given: { row: number; col: number; letter: string }[], text: PdfTextItem[]): GridAnchor[] {
    if (!given.length || !text.length) return [];
    const cellWidth = grid.box.width / grid.cols;
    const cellHeight = grid.box.height / grid.rows;
    const letters = text.filter(item => item.text.trim().length === 1).map(item => ({ letter: item.text.trim().toLocaleUpperCase(), ...center(inkBox(item)) }));
    const anchors: GridAnchor[] = [];
    for (const square of given) {
      const expected = { x: grid.box.x + (square.col + 0.5) * cellWidth, y: grid.box.y + (square.row + 0.5) * cellHeight };
      const near = letters
        .filter(item => item.letter === square.letter && Math.abs(item.x - expected.x) < cellWidth && Math.abs(item.y - expected.y) < cellHeight)
        .sort((a, b) => Math.hypot(a.x - expected.x, a.y - expected.y) - Math.hypot(b.x - expected.x, b.y - expected.y))[0];
      if (near) anchors.push({ row: square.row, col: square.col, x: near.x, y: near.y });
    }
    return anchors;
  }

  /**
   * Two dots per matching pair, one group per exercise: each item is found in the printed text
   * (else the AI's box), then the dots are lined up beside or between the columns. A pair with
   * an end that cannot be placed is left out.
   */
  private pairTasks(exercise: PreparedExercise, text: PdfTextItem[], box: AiCropBox, ratio: number, draft: Record<string, unknown>): { elements: BookElement[]; exact: number } {
    // The second column's dots go before each item's letter, so its label counts as part of it.
    // Printed items are lined up by their letters, not their text boxes (which sit higher).
    const lefts = findPhrases(text, box, exercise.pairs.map(pair => pair.left)).map(found => found && inkBox(found));
    const rights = findPhrases(text, box, exercise.pairs.map(pair => pair.right), 0.01, true).map(found => found && inkBox(found));
    const kept = exercise.pairs
      .map((pair, i) => ({ pair, left: lefts[i] ?? pair.leftBox, right: rights[i] ?? pair.rightBox, exact: !!lefts[i] && !!rights[i] }))
      .filter((entry): entry is { pair: typeof entry.pair; left: AiCropBox; right: AiCropBox; exact: boolean } => !!entry.left && !!entry.right);
    const dots = matchDots(kept.map(entry => entry.left), kept.map(entry => entry.right), ratio);
    const groupId = this.newId('match-group');
    const elements: BookElement[] = [];
    kept.forEach((entry, i) => {
      const pairId = this.newId('match-pair');
      elements.push(
        { id: this.newId('match-endpoint'), type: 'matchTask', ...dots[i].a, data: { groupId, pairId, side: 'A', optionText: entry.pair.left, ...draft } },
        { id: this.newId('match-endpoint'), type: 'matchTask', ...dots[i].b, data: { groupId, pairId, side: 'B', optionText: entry.pair.right, ...draft } }
      );
    });
    return { elements, exact: kept.filter(entry => entry.exact).length };
  }

  /**
   * The exercise's guide dot and answer key (when ticked), right after its instruction's last
   * line; in the frame's top-right corner when there is no room there. Not when the teacher
   * already put one in the exercise; an answer key only for exercises with answers.
   */
  private exerciseMarks(page: BookPage, exercise: PreparedExercise, box: AiCropBox, text: PdfTextItem[], ratio: number, draft: Record<string, unknown>): BookElement[] {
    const has = (type: BookElementType) => page.elements.some(element => element.type === type && !this.isTaskDraft(element) && inside(element, box));
    const types: BookElementType[] = [];
    if (this.marks.guides && (exercise.instruction || exercise.instructionBox) && !has('guideDot')) types.push('guideDot');
    if (this.marks.keys && ANSWERED_KINDS.includes(exercise.kind) && !has('answerKey')) types.push('answerKey');
    if (this.marks.notes && exercise.gameIdea && !has('note')) types.push('note');
    if (!types.length) return [];
    const printed = exercise.instruction ? findInstructionEnd(text, box, exercise.instruction) : null;
    const end = printed ?? exercise.instructionBox;
    // As big as the instruction's letters (or the exercise's first printed line), a little more.
    const sizeLine = printed ?? textInBox(text, box)[0] ?? null;
    const size = markSize(sizeLine, ratio, !!sizeLine);
    const after = end ? marksAfter(end, types.length, ratio, box.x + box.width + MARK_OVERHANG, !!printed, size) : null;
    const spots = this.firstClear([
      after,
      marksInCorner(box, types.length, size),
      // Just above the frame's top-right corner.
      marksInCorner({ ...box, y: box.y - size / ratio - size * 0.24 }, types.length, size)
    ], text, ratio, end) ?? after ?? marksInCorner(box, types.length, size);
    return types.map((type, i) => this.mark(type, spots[i], draft, exercise.gameIdea));
  }

  /**
   * The first of these rows of marks that covers no printed words. The first row follows the
   * instruction's line, so that line's own words do not count for it.
   */
  private firstClear(rows: (AiCropBox[] | null)[], text: PdfTextItem[], ratio: number, end: AiCropBox | null): AiCropBox[] | null {
    return rows.find((row, i) => !!row && row.every(spot => spot.y >= 0) && !this.hitsText(row, text, ratio, i === 0 ? end : null)) ?? null;
  }

  /**
   * A video mark right after each video sign (its printed word, else where the AI saw the icon),
   * or just before it at the page's edge; grouped with the exercise it is in. Not where the
   * teacher already put a video.
   */
  private videoMarks(page: BookPage, videos: TaskPrepResult['videos'], text: PdfTextItem[], ratio: number, prepId: string, frames: { box: AiCropBox; draft: Record<string, unknown> }[]): BookElement[] {
    if (!this.marks.videos || !videos.length) return [];
    const found = findPhrases(text, { x: 0, y: 0, width: 1, height: 1 }, videos.map(video => video.text), 0);
    const marks: BookElement[] = [];
    videos.forEach((video, i) => {
      const sign = found[i] ?? video.box;
      if (!sign) return;
      // At the page's right edge there is no room after it: just before it instead.
      const size = markSize(found[i], ratio, !!found[i]);
      const level = marksAfter({ ...sign, x: 0, width: 0 }, 1, ratio, 1, !!found[i], size)![0];
      const spot = marksAfter(sign, 1, ratio, 1, !!found[i], size)?.[0] ?? { ...level, x: Math.max(0, sign.x - size * 1.25) };
      const centre = { x: spot.x + size / 2, y: spot.y + size / ratio / 2 };
      const taken = page.elements.concat(marks).some(element => element.type === 'video' && !this.isTaskDraft(element)
        && Math.hypot(element.x + (element.width || 0) / 2 - centre.x, element.y + (element.height || 0) / ratio / 2 - centre.y) < 0.06);
      if (taken) return;
      const frame = frames.find(f => centre.x >= f.box.x && centre.x <= f.box.x + f.box.width && centre.y >= f.box.y && centre.y <= f.box.y + f.box.height);
      const draft = frame?.draft ?? {
        taskDraft: true, prepId, exerciseId: `${prepId}-video-${i + 1}`, exerciseNumber: '', exerciseTitle: video.text, exerciseKind: 'video'
      };
      marks.push(this.mark('video', spot, draft));
    });
    return marks;
  }

  /** The marks would cover printed words other than the line they follow. */
  private hitsText(spots: AiCropBox[], text: PdfTextItem[], ratio: number, end: AiCropBox | null): boolean {
    return spots.some(spot => text.some(item => {
      if (end && item.y < end.y + end.height && item.y + item.height > end.y && item.x + item.width <= end.x + end.width + 0.002) return false;
      const ink = inkBox(item);
      return item.x < spot.x + spot.width && item.x + item.width > spot.x
        && ink.y < spot.y + spot.width / ratio && ink.y + ink.height > spot.y;
    }));
  }

  private mark(type: BookElementType, spot: AiCropBox, draft: Record<string, unknown>, note = ''): BookElement {
    const data: Record<string, unknown> = type === 'guideDot' ? { text: '', audioFiles: [], guideTracks: [] }
      : type === 'answerKey' ? { images: [], label: 'Answer key' }
      : type === 'note' ? { content: note }
      : { src: '', label: 'Video' };
    return { id: this.newId(type), type, ...spot, data: { ...data, ...draft } };
  }

  private draftData(exercise: PreparedExercise, prepId: string): Record<string, unknown> {
    return {
      taskDraft: true,
      prepId,
      exerciseId: `${prepId}-${exercise.id}`,
      exerciseNumber: exercise.number,
      exerciseTitle: exercise.title,
      exerciseKind: exercise.kind
    };
  }

  private newId(prefix: string): string {
    return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
  }

  /** The AI's answer can arrive outside Angular's zone (desktop IPC), so the panel would not redraw. */
  private inZone(apply: () => void): void {
    const zone = this.creator.ngZone;
    if (zone) zone.run(apply);
    else apply();
  }

  // ---- The drafts on the pages ----

  isTaskDraft(element: BookElement): boolean {
    return !!element.data?.['taskDraft'];
  }

  /** Every prepared exercise waiting in the open page list, in page and reading order. */
  get drafts(): TaskDraft[] {
    const pages: BookPage[] = this.creator.activePages ?? [];
    return pages.flatMap((page, index) => {
      const groups = new Map<string, TaskDraft>();
      for (const element of page.elements) {
        if (!this.isTaskDraft(element)) continue;
        // Phase 1 drafts have no exercise id: each frame is its own exercise.
        const exerciseId = String(element.data['exerciseId'] || element.id);
        const group = groups.get(exerciseId) ?? { exerciseId, page, pageNumber: index + 1, frame: null, tasks: [], marks: [] };
        if (element.type === 'focus') group.frame = element;
        else if (MARK_TYPES.includes(element.type)) group.marks.push(element);
        else group.tasks.push(element);
        groups.set(exerciseId, group);
      }
      return [...groups.values()];
    });
  }

  /** The element that carries the exercise's number, title and kind. */
  private lead(draft: TaskDraft): BookElement {
    return draft.frame ?? draft.tasks[0] ?? draft.marks[0];
  }

  /** The exercise has this mark (guide dot, answer key, video), for the panel's icons. */
  hasMark(draft: TaskDraft, type: BookElementType): boolean {
    return draft.marks.some(mark => mark.type === type);
  }

  draftLabel(draft: TaskDraft): string {
    const data = this.lead(draft).data;
    return [String(data['exerciseNumber'] ?? ''), String(data['exerciseTitle'] ?? '')].filter(Boolean).join(' · ');
  }

  draftKind(draft: TaskDraft): ExerciseKind {
    return this.lead(draft).data['exerciseKind'] ?? 'other';
  }

  /** The exercise's tasks are circle targets (its options), not gaps. */
  hasOptions(draft: TaskDraft): boolean {
    return draft.tasks.some(task => task.type === 'circleTask');
  }

  /** The exercise's tasks are matching dots. */
  hasPairs(draft: TaskDraft): boolean {
    return draft.tasks.some(task => task.type === 'matchTask');
  }

  /** The exercise is a crossword: its tasks are one-letter squares, listed by their words. */
  isCrossword(draft: TaskDraft): boolean {
    return this.draftKind(draft) === 'crossword' && draft.tasks.some(task => task.type === 'textTask');
  }

  /** A crossword's words, from its squares. */
  private crosswordWords(draft: TaskDraft): string[] {
    return unique(draft.tasks.map(task => String(task.data['optionText'] ?? '')).filter(Boolean));
  }

  /** What the exercise's tasks are counted as in the panel: gaps, options, pairs or words. */
  countKey(draft: TaskDraft): string {
    return this.hasPairs(draft) ? 'taskPrepPairs' : this.hasOptions(draft) ? 'taskPrepOptions' : this.isCrossword(draft) ? 'taskPrepWords' : 'taskPrepGaps';
  }

  taskCount(draft: TaskDraft): number {
    if (this.isCrossword(draft)) return this.crosswordWords(draft).length;
    return this.hasPairs(draft) ? draft.tasks.filter(task => task.data['side'] === 'A').length : draft.tasks.length;
  }

  /**
   * "goes, went, has…": the first answers of the exercise's gaps, or its right options, to
   * check at a glance.
   */
  answersPreview(draft: TaskDraft): string {
    if (this.hasPairs(draft)) {
      const ends = draft.tasks.filter(task => task.type === 'matchTask');
      const answers = ends.filter(task => task.data['side'] === 'A').map(a => {
        const b = ends.find(task => task.data['side'] === 'B' && task.data['pairId'] === a.data['pairId']);
        return `${a.data['optionText'] || '🖼'} → ${b?.data['optionText'] || '🖼'}`;
      });
      const shown = answers.slice(0, 3).join(', ');
      return answers.length > 3 ? `${shown}…` : shown;
    }
    if (this.isCrossword(draft)) {
      const words = this.crosswordWords(draft);
      return words.length > 4 ? `${words.slice(0, 4).join(', ')}…` : words.join(', ');
    }
    const answers = draft.tasks
      .filter(task => task.type !== 'circleTask' || task.data['correct'] === true)
      .map(task => task.type === 'textTask' ? String(task.data['acceptedAnswers']?.[0] ?? '')
        : task.type === 'circleTask' ? String(task.data['optionText'] || '🖼')
        : this.optionText(draft.page, task));
    const shown = answers.slice(0, 4).map(answer => answer || '?').join(', ');
    return answers.length > 4 ? `${shown}…` : shown;
  }

  /** Gaps whose answer the app could not find in the word box (the teacher picks it). */
  missingAnswers(draft: TaskDraft): number {
    return draft.tasks.filter(task => task.type === 'choiceTask' && !task.data['correctOptionId']).length;
  }

  /** A circle exercise with no option marked right (the teacher marks one). */
  noCorrectOption(draft: TaskDraft): boolean {
    return this.hasOptions(draft) && !draft.tasks.some(task => task.type === 'circleTask' && task.data['correct'] === true);
  }

  private optionText(page: BookPage, task: BookElement): string {
    const bank = page.wordBanks?.find(b => b.id === task.data['wordBankId']);
    return bank?.options.find(o => o.id === task.data['correctOptionId'])?.text ?? '';
  }

  /** Opens the draft's page (nothing is selected, so this panel stays open). */
  show(draft: TaskDraft): void {
    const index = draft.pageNumber - 1;
    if (this.creator.activePageSource === 'workbook') {
      const workbook = this.creator.activeWorkbook;
      if (workbook) this.creator.selectWorkbookPage(workbook, index);
    } else {
      this.creator.selectMainPage(index);
    }
    this.creator.selectedElementId = null;
  }

  /** Makes the exercise's frame and tasks normal elements. */
  accept(draft: TaskDraft): void {
    this.creator.captureHistory();
    this.acceptDraft(draft);
    this.creator.markBookDirty();
  }

  acceptAll(): void {
    const drafts = this.drafts;
    if (!drafts.length) return;
    this.creator.captureHistory();
    drafts.forEach(draft => this.acceptDraft(draft));
    this.creator.markBookDirty();
  }

  private acceptDraft(draft: TaskDraft): void {
    for (const element of [...(draft.frame ? [draft.frame] : []), ...draft.tasks, ...draft.marks]) {
      const data = { ...element.data };
      DRAFT_KEYS.forEach(key => delete data[key]);
      element.data = data;
      if (element.type === 'choiceTask') {
        const bank = draft.page.wordBanks?.find(b => b.id === data['wordBankId']);
        if (bank) delete bank.prepId;
      }
    }
  }

  /** Takes the exercise's frame and tasks away (and a word bank only they used). */
  remove(draft: TaskDraft): void {
    this.creator.captureHistory();
    const mine = new Set([draft.frame, ...draft.tasks, ...draft.marks]);
    this.removeElements(draft.page, element => mine.has(element));
    this.creator.markBookDirty();
  }

  async removeAll(): Promise<void> {
    if (!this.drafts.length) return;
    const confirmed = await this.creator.confirmationService.confirm(this.creator.languageService.translate('taskPrepRemoveAllConfirm'));
    if (!confirmed) return;
    this.inZone(() => {
      this.creator.captureHistory();
      for (const page of (this.creator.activePages ?? []) as BookPage[]) {
        this.removeElements(page, element => this.isTaskDraft(element));
      }
      this.lastRun = null;
      this.notes = [];
      this.creator.markBookDirty();
    });
  }

  /** Removes elements from a page, and the prepared word banks no task uses any more. */
  private removeElements(page: BookPage, remove: (element: BookElement) => boolean): void {
    const removed = page.elements.filter(remove);
    if (!removed.length) return;
    page.elements = page.elements.filter(element => !remove(element));
    if (removed.some(element => element.id === this.creator.selectedElementId)) this.creator.selectedElementId = null;
    if (page.wordBanks?.length) {
      const used = new Set(page.elements.filter(e => e.type === 'choiceTask').map(e => e.data['wordBankId']));
      page.wordBanks = page.wordBanks.filter(bank => !bank.prepId || used.has(bank.id));
    }
  }
}

/** An AI box grown to at least a tappable size, kept on the page. */
function atLeast(box: AiCropBox): AiCropBox {
  const width = Math.min(1, Math.max(0.03, box.width));
  const height = Math.min(1, Math.max(0.025, box.height));
  return { x: Math.min(box.x, 1 - width), y: Math.min(box.y, 1 - height), width, height };
}

function loadMarks(): TaskPrepMarks {
  const all = { guides: true, keys: true, videos: true, notes: true };
  try {
    const saved = JSON.parse(localStorage.getItem(MARKS_KEY) || '{}');
    return { guides: saved.guides !== false, keys: saved.keys !== false, videos: saved.videos !== false, notes: saved.notes !== false };
  } catch {
    return all;
  }
}

/** The element's top-left corner lies inside the box. */
function inside(element: BookElement, box: AiCropBox): boolean {
  return element.x >= box.x && element.x <= box.x + box.width && element.y >= box.y && element.y <= box.y + box.height;
}

function center(box: AiCropBox): { x: number; y: number } {
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

/** How much an element overlaps a box: the shared area over the smaller of the two. */
function overlap(element: BookElement, box: AiCropBox): number {
  const w = element.width || 0;
  const h = element.height || 0;
  const ix = Math.max(0, Math.min(element.x + w, box.x + box.width) - Math.max(element.x, box.x));
  const iy = Math.max(0, Math.min(element.y + h, box.y + box.height) - Math.max(element.y, box.y));
  const smaller = Math.min(w * h, box.width * box.height);
  return smaller > 0 ? (ix * iy) / smaller : 0;
}
