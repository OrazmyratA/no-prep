import { describe, expect, it, vi } from 'vitest';
import { BookCreatorPresentationController } from './book-creator-presentation-controller';

function makeCreator(query: Record<string, string>) {
  const element: any = { id: 'el-1', type: 'presentation', data: { presentationId: null } };
  const location = { element, pageSource: 'main', workbookId: null, pageIndex: 2 };
  const creator: any = {
    book: { id: 'book-1' },
    route: { snapshot: { queryParamMap: { get: (key: string) => query[key] ?? null } } },
    router: {
      navigate: vi.fn(async () => true),
      createUrlTree: vi.fn((commands: unknown[], extras: unknown) => ({ commands, extras })),
      serializeUrl: vi.fn(() => '/books/book-1/edit?presentationElementId=el-1')
    },
    captureHistory: vi.fn(),
    confirmSaveBeforeLeaving: vi.fn(async () => true),
    bypassUnsavedGuard: false,
    gameController: {
      findGameElement: vi.fn((id: string, type: string) => (id === 'el-1' && type === 'presentation' ? location : null)),
      jumpToGameElement: vi.fn(async () => undefined)
    },
    presentationPick: { begin: vi.fn(), reset: vi.fn() },
    presentationLinks: {
      get: vi.fn(async (id: string) => (id === 'link-1'
        ? { id: 'link-1', title: 'Animals', url: 'https://www.canva.com/design/A1/k2/view', source: 'canva' }
        : null))
    },
    presentations: {
      refresh: vi.fn(async () => undefined),
      items$: { value: [{ id: 'pres-1', title: 'Unit 1', slideCount: 20, thumbVersion: 1 }] }
    }
  };
  return { creator, element };
}

describe('BookCreatorPresentationController (choose on the Presentations tab)', () => {
  it('sends the teacher to the Presentations tab with a way back to the icon', async () => {
    const { creator, element } = makeCreator({});
    const ok = await new BookCreatorPresentationController(creator).choosePresentationFromList(element);
    expect(ok).toBe(true);
    expect(creator.presentationPick.begin).toHaveBeenCalledWith('/books/book-1/edit?presentationElementId=el-1');
    expect(creator.router.navigate).toHaveBeenCalledWith(['/topics'], { queryParams: { category: 'presentations' } });
  });

  it('links a picked PowerPoint file and jumps back to the icon', async () => {
    const { creator, element } = makeCreator({ presentationElementId: 'el-1', pickedPresentationKind: 'file', pickedPresentationId: 'pres-1' });
    expect(await new BookCreatorPresentationController(creator).attachReturnedPresentation()).toBe(true);
    expect(element.data).toMatchObject({ presentationKind: 'file', presentationId: 'pres-1', presentationTitle: 'Unit 1', startSlide: 1 });
    expect(creator.gameController.jumpToGameElement).toHaveBeenCalled();
  });

  it('links a picked Canva link with the link itself in the book', async () => {
    const { creator, element } = makeCreator({ presentationElementId: 'el-1', pickedPresentationKind: 'link', pickedPresentationId: 'link-1' });
    await new BookCreatorPresentationController(creator).attachReturnedPresentation();
    expect(element.data).toMatchObject({ presentationKind: 'link', presentationId: 'link-1', presentationUrl: 'https://www.canva.com/design/A1/k2/view' });
  });

  it('leaves the icon as it was after Cancel, and ignores other trips', async () => {
    const cancelled = makeCreator({ presentationElementId: 'el-1' });
    await new BookCreatorPresentationController(cancelled.creator).attachReturnedPresentation();
    expect(cancelled.element.data.presentationId).toBeNull();
    expect(cancelled.creator.captureHistory).not.toHaveBeenCalled();

    const other = makeCreator({ bookElementId: 'game-1' });
    expect(await new BookCreatorPresentationController(other.creator).attachReturnedPresentation()).toBe(false);
  });
});
