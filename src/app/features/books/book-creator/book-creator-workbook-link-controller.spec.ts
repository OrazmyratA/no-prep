import { BookCreatorWorkbookLinkController } from './book-creator-workbook-link-controller';

// A small fake creator: a student book (progress map first, so page numbers start on the 2nd
// page) and one workbook. Student book page 2 links to workbook pages 3 and 5.
function setup() {
  const workbook = { id: 'wb', title: 'Workbook', pages: [1, 2, 3, 4, 5].map((n) => ({ id: `w${n}` })) };
  const creator: any = {
    book: {
      pages: [{ id: 'map', type: 'progressMap' }, { id: 'm1' }, { id: 'm2' }, { id: 'm3' }],
      workbooks: [workbook],
      workbookLinks: { m2: [{ workbookId: 'wb', pageIds: ['w3', 'w5'] }], m3: [{ workbookId: 'wb', pageIds: ['w5'] }] }
    },
    activePageSource: 'main',
    selectedPageIndex: 2,
    linkingMainPageId: null,
    linkReturnPageIndex: null,
    selectedElementId: 'something',
    selectWorkbookPage(_workbook: unknown, index: number) {
      creator.activePageSource = 'workbook';
      creator.selectedWorkbookPageIndex = index;
    },
    selectMainPage(index: number) {
      creator.activePageSource = 'main';
      creator.selectedPageIndex = index;
      creator.linkReturnPageIndex = null;
    }
  };
  return { creator, controller: new BookCreatorWorkbookLinkController(creator), workbook };
}

describe('BookCreatorWorkbookLinkController linked page buttons', () => {
  it('lists the linked workbook pages of a student book page as buttons', () => {
    const { creator, controller } = setup();
    expect(controller.linkedWorkbookChips(creator.book.pages[2]).map((chip) => chip.label)).toEqual(['3', '5']);
    expect(controller.linkedWorkbookChips(creator.book.pages[1])).toEqual([]);
  });

  it('opens a workbook page from its button, never changing links, and offers the way back', () => {
    const { creator, controller } = setup();
    creator.linkingMainPageId = 'm2';
    const [chip] = controller.linkedWorkbookChips(creator.book.pages[2]);
    controller.openLinkedWorkbookPage(chip);
    expect(creator.activePageSource).toBe('workbook');
    expect(creator.selectedWorkbookPageIndex).toBe(2);
    expect(creator.linkingMainPageId).toBeNull();
    expect(creator.book.workbookLinks.m2[0].pageIds).toEqual(['w3', 'w5']);
    // Student book page index 2 is page "2" (the progress map carries no number).
    expect(controller.linkReturnLabel()).toBe('2');
    controller.openStudentPage(creator.linkReturnPageIndex);
    expect(creator.activePageSource).toBe('main');
    expect(creator.selectedPageIndex).toBe(2);
    expect(controller.linkReturnLabel()).toBe('');
  });

  it('shows on a workbook page every student book page that links to it', () => {
    const { creator, controller, workbook } = setup();
    expect(controller.linkedStudentChips(workbook.pages[4] as any).map((chip) => chip.label)).toEqual(['2', '3']);
    expect(controller.linkedStudentChips(workbook.pages[0] as any)).toEqual([]);
    expect(creator).toBeTruthy();
  });
});
