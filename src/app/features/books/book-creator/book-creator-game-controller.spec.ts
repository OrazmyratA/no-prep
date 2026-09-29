import { vi } from 'vitest';
import { BookCreatorGameController } from './book-creator-game-controller';
import { PdfPageCanvasComponent } from '../pdf-page-canvas/pdf-page-canvas';
import { BookElement, BookPage } from '../../../core/book.model';

function pdfPage(pdfPage: number): BookPage {
  return { id: `p${pdfPage}`, type: 'pdf', pdfPage, elements: [] };
}

describe('BookCreatorGameController: Create with AI from pages', () => {
  let creator: any;
  let controller: BookCreatorGameController;
  let navigations: unknown[][];
  let handedOver: Blob[] | null;
  const marker = { id: 'm1', type: 'game', data: { topicId: null } } as unknown as BookElement;

  beforeEach(() => {
    navigations = [];
    handedOver = null;
    creator = {
      book: { id: 'book-1' },
      activePages: [pdfPage(1), pdfPage(2), { id: 'blank', type: 'blank', elements: [] }, pdfPage(4)],
      activePageIndex: 1,
      activePageSource: 'student',
      activeWorkbook: null,
      getPagePdfUrl: () => 'noprep-book://book-1/assets/source.pdf',
      getPageRotation: () => 0,
      confirmSaveBeforeLeaving: async () => true,
      router: { navigate: async (commands: unknown[]) => { navigations.push(commands); return true; } },
      aiTopic: { isAvailable: true, getStartProvider: async () => ({ providers: [], start: { maxImages: 2 } }) },
      aiPageHandoff: {
        give: (pages: Blob[]) => { handedOver = pages; },
        take: () => { const pages = handedOver ?? []; handedOver = null; return pages; }
      }
    };
    controller = new BookCreatorGameController(creator);
    vi.spyOn(PdfPageCanvasComponent, 'renderToBlob').mockImplementation(
      async (_url: string, page: number) => ({ page } as unknown as Blob)
    );
  });

  afterEach(() => vi.restoreAllMocks());

  it('uses the AI page limit and starts on the marker’s own page', async () => {
    await controller.loadAiPageLimit();
    expect(controller.aiPageLimit).toBe(2);
    expect(controller.getAiPagesText(marker)).toBe('2');
  });

  it('renders the typed pages and opens a new topic for the marker', async () => {
    await controller.loadAiPageLimit();
    controller.setAiPagesText(marker, '1-2');
    await controller.createTopicWithAi(marker);
    expect(controller.aiPagesError).toBeNull();
    expect((handedOver ?? []).map((blob: any) => blob.page)).toEqual([1, 2]);
    expect(navigations).toEqual([['/topics/new']]);
  });

  it('explains what is wrong instead of opening the form', async () => {
    await controller.loadAiPageLimit();
    const tryPages = async (text: string) => {
      controller.setAiPagesText(marker, text);
      await controller.createTopicWithAi(marker);
      return controller.aiPagesError?.key;
    };
    expect(await tryPages('one')).toBe('creatorAiPagesInvalid');
    expect(await tryPages('9')).toBe('creatorAiPagesOutOfRange');
    expect(await tryPages('1-3')).toBe('creatorAiPagesTooMany');
    expect(await tryPages('3')).toBe('creatorAiPagesNotPdf');
    expect(navigations.length).toBe(0);
  });

  it('drops the pages when the teacher cancels leaving the book', async () => {
    await controller.loadAiPageLimit();
    creator.confirmSaveBeforeLeaving = async () => false;
    await controller.createTopicWithAi(marker);
    expect(handedOver).toBeNull();
    expect(navigations.length).toBe(0);
  });

  it('is hidden when AI is not available on this device', async () => {
    creator.aiTopic.isAvailable = false;
    await controller.loadAiPageLimit();
    expect(controller.aiPageLimit).toBeNull();
  });
});

function gameElement(id: string, topicId: number | null = null): BookElement {
  return { id, type: 'game', x: 0, y: 0, data: { topicId } } as BookElement;
}

function queryParamMap(params: Record<string, string>) {
  return { get: (key: string) => (key in params ? params[key] : null) };
}

describe('BookCreatorGameController: full-page topic picker', () => {
  let creator: any;
  let controller: BookCreatorGameController;
  let navigations: unknown[][];
  let beginSelectionCalls: unknown[][];
  let saveCalls: number;
  let captureHistoryCalls: number;
  let topics: Record<number, { id: number; name: string }>;

  beforeEach(() => {
    navigations = [];
    beginSelectionCalls = [];
    saveCalls = 0;
    captureHistoryCalls = 0;
    topics = { 7: { id: 7, name: 'Animals' } };
    creator = {
      book: {
        id: 'book-1',
        pages: [{ id: 'page-1', elements: [] }, { id: 'page-2', elements: [gameElement('m1')] }],
        workbooks: [{ id: 'wb-1', pages: [{ id: 'wb-page-1', elements: [gameElement('m2')] }] }]
      },
      route: { snapshot: { queryParamMap: queryParamMap({}) } },
      router: {
        navigate: async (commands: unknown[]) => { navigations.push(commands); return true; },
        createUrlTree: (commands: unknown[], extras: unknown) => ({ commands, extras }),
        serializeUrl: (tree: unknown) => JSON.stringify(tree)
      },
      leaderboardState: {
        beginTopicSelection: (returnUrl: string, source: string) => { beginSelectionCalls.push([returnUrl, source]); }
      },
      confirmSaveBeforeLeaving: async () => true,
      bypassUnsavedGuard: false,
      bookLibrary: { isAvailable: false },
      db: { getTopicById: async (id: number) => topics[id] ?? null },
      activePageSource: 'main',
      activeWorkbookId: null,
      selectedPageIndex: 0,
      selectedWorkbookPageIndex: 0,
      refreshSelectedPageRender: () => {},
      selectedElementId: null,
      save: async () => { saveCalls++; },
      captureHistory: () => { captureHistoryCalls++; }
    };
    controller = new BookCreatorGameController(creator);
  });

  it('opens the full topic list instead of a cramped dropdown', async () => {
    const element = gameElement('m1');
    const opened = await controller.chooseGameTopicFromList(element);
    expect(opened).toBe(true);
    expect(beginSelectionCalls.length).toBe(1);
    expect(beginSelectionCalls[0][1]).toBe('book-game-topic');
    expect(String(beginSelectionCalls[0][0]).includes('book-1')).toBe(true);
    expect(navigations).toEqual([['/topics']]);
  });

  it('does not navigate away if the teacher cancels leaving unsaved changes', async () => {
    creator.confirmSaveBeforeLeaving = async () => false;
    const opened = await controller.chooseGameTopicFromList(gameElement('m1'));
    expect(opened).toBe(false);
    expect(navigations.length).toBe(0);
    expect(beginSelectionCalls.length).toBe(0);
  });

  it('applies the picked topic and jumps back to the marker on the main pages', async () => {
    creator.route.snapshot.queryParamMap = queryParamMap({
      bookElementId: 'm1',
      pickedTopicId: '7',
      pickedTopicSource: 'book-game-topic'
    });

    await controller.attachReturnedTopic();

    const element = creator.book.pages[1].elements[0];
    expect(element.data.topicId).toBe(7);
    expect(element.data.topicName).toBe('Animals');
    expect(element.data.label).toBe('Animals');
    // Load-time resume, not a live edit - no undo entry for it.
    expect(captureHistoryCalls).toBe(0);
    expect(creator.activePageSource).toBe('main');
    expect(creator.selectedPageIndex).toBe(1);
    expect(creator.selectedElementId).toBe('m1');
    expect(saveCalls).toBe(1);
    expect(navigations).toEqual([['/books', 'book-1', 'edit']]);
  });

  it('applies the picked topic and jumps back to the marker on a workbook page', async () => {
    creator.route.snapshot.queryParamMap = queryParamMap({
      bookElementId: 'm2',
      pickedTopicId: '7',
      pickedTopicSource: 'book-game-topic'
    });

    await controller.attachReturnedTopic();

    const element = creator.book.workbooks[0].pages[0].elements[0];
    expect(element.data.topicId).toBe(7);
    expect(creator.activePageSource).toBe('workbook');
    expect(creator.activeWorkbookId).toBe('wb-1');
    expect(creator.selectedWorkbookPageIndex).toBe(0);
    expect(creator.selectedElementId).toBe('m2');
  });

  it('cleans up the stray query param when the teacher cancels the picker', async () => {
    creator.route.snapshot.queryParamMap = queryParamMap({ bookElementId: 'm1' });

    await controller.attachReturnedTopic();

    const element = creator.book.pages[1].elements[0];
    expect(element.data.topicId).toBeNull();
    expect(saveCalls).toBe(0);
    expect(navigations).toEqual([['/books', 'book-1', 'edit']]);
  });

  it('cleans up without touching data if the picked topic no longer exists', async () => {
    creator.route.snapshot.queryParamMap = queryParamMap({
      bookElementId: 'm1',
      pickedTopicId: '999',
      pickedTopicSource: 'book-game-topic'
    });

    await controller.attachReturnedTopic();

    const element = creator.book.pages[1].elements[0];
    expect(element.data.topicId).toBeNull();
    expect(navigations).toEqual([['/books', 'book-1', 'edit']]);
  });

  it('still applies the topic-form create/edit round trip (linkedTopicId) unchanged', async () => {
    creator.route.snapshot.queryParamMap = queryParamMap({
      linkedElementId: 'm1',
      linkedTopicId: '7',
      linkedTopicTitle: 'Animals',
      bookTopicPath: 'assets/games/m1/Animals.json'
    });

    await controller.attachReturnedTopic();

    const element = creator.book.pages[1].elements[0];
    expect(element.data.topicId).toBe(7);
    expect(element.data.bookTopicPath).toBe('assets/games/m1/Animals.json');
    expect(captureHistoryCalls).toBe(0);
    expect(navigations).toEqual([['/books', 'book-1', 'edit']]);
  });
});
