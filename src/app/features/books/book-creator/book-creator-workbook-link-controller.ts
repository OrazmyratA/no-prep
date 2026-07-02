import {
  BookPage,
  BookWorkbook,
  WorkbookLink
} from '../../../core/book.model';

export class BookCreatorWorkbookLinkController {
  constructor(private readonly creator: any) {}

  getPageLinkCount(page: BookPage): number {
    if (!this.creator.book) return 0;
    return (this.creator.book.workbookLinks?.[page.id] ?? [])
      .reduce((count: number, link: WorkbookLink) => count + (Array.isArray(link.pageIds) ? link.pageIds.length : 0), 0);
  }

  getLinkedWorkbookPageNumbers(page: BookPage | null): string {
    const workbook = this.creator.primaryWorkbook;
    if (!page || !workbook || !this.creator.book?.workbookLinks) return '';
    const link = (this.creator.book.workbookLinks[page.id] ?? []).find((item: WorkbookLink) => item.workbookId === workbook.id);
    if (!link) return '';
    return link.pageIds
      .map((pageId: string) => workbook.pages.findIndex((item: BookPage) => item.id === pageId) + 1)
      .filter((pageNumber: number) => pageNumber > 0)
      .join(', ');
  }

  setLinkedWorkbookPageNumbers(page: BookPage | null, value: string): void {
    const workbook = this.creator.primaryWorkbook;
    if (!this.creator.book || !page || !workbook) return;
    const pageIds = this.parsePageNumberList(value, workbook.pages.length)
      .map((pageNumber) => workbook.pages[pageNumber - 1]?.id)
      .filter((pageId): pageId is string => !!pageId);

    this.creator.captureHistory();
    this.creator.book.workbookLinks = this.creator.book.workbookLinks && typeof this.creator.book.workbookLinks === 'object'
      ? this.creator.book.workbookLinks
      : {};
    const otherLinks = (this.creator.book.workbookLinks[page.id] ?? [])
      .filter((link: WorkbookLink) => link.workbookId !== workbook.id);
    if (pageIds.length) {
      otherLinks.push({ workbookId: workbook.id, pageIds });
    }
    this.creator.book.workbookLinks[page.id] = otherLinks;
  }

  beginWorkbookLinking(page: BookPage, event?: Event): void {
    event?.stopPropagation();
    this.creator.selectMainPage(this.creator.book?.pages.findIndex((item: BookPage) => item.id === page.id) ?? this.creator.selectedPageIndex);
    this.creator.linkingMainPageId = this.creator.linkingMainPageId === page.id ? null : page.id;
  }

  isLinkingMainPage(page: BookPage): boolean {
    return this.creator.linkingMainPageId === page.id;
  }

  isWorkbookPageLinked(workbookId: string, pageId: string): boolean {
    const mainPageId = this.creator.linkingMainPageId
      || (this.creator.activePageSource === 'main' ? this.creator.selectedPage?.id : '');
    if (!mainPageId || !this.creator.book?.workbookLinks) return false;
    return (this.creator.book.workbookLinks[mainPageId] ?? [])
      .some((link: WorkbookLink) => link.workbookId === workbookId && link.pageIds.includes(pageId));
  }

  toggleWorkbookPageLink(workbook: BookWorkbook, page: BookPage, event?: Event): void {
    event?.stopPropagation();
    if (!this.creator.book || !this.creator.linkingMainPageId) return;
    this.creator.captureHistory();
    this.creator.book.workbookLinks = this.creator.book.workbookLinks && typeof this.creator.book.workbookLinks === 'object'
      ? this.creator.book.workbookLinks
      : {};
    const links = this.creator.book.workbookLinks[this.creator.linkingMainPageId] ?? [];
    let link = links.find((item: WorkbookLink) => item.workbookId === workbook.id);
    if (!link) {
      link = { workbookId: workbook.id, pageIds: [] };
      links.push(link);
    }
    if (link.pageIds.includes(page.id)) {
      link.pageIds = link.pageIds.filter((id: string) => id !== page.id);
    } else {
      link.pageIds = [...link.pageIds, page.id].sort((a, b) =>
        workbook.pages.findIndex((item) => item.id === a) - workbook.pages.findIndex((item) => item.id === b)
      );
    }
    this.creator.book.workbookLinks[this.creator.linkingMainPageId] = links
      .map((item: WorkbookLink) => ({ ...item, pageIds: item.pageIds.filter(Boolean) }))
      .filter((item: WorkbookLink) => item.pageIds.length > 0);
  }

  getWorkbookLinksForPage(page: BookPage | null): WorkbookLink[] {
    if (!page || !this.creator.book?.workbookLinks) return [];
    return this.creator.book.workbookLinks[page.id] ?? [];
  }

  parsePageNumberList(value: string, maxPage: number): number[] {
    const pageNumbers = new Set<number>();
    for (const part of String(value || '').split(/[,\s]+/).map((item) => item.trim()).filter(Boolean)) {
      const rangeMatch = part.match(/^(\d+)-(\d+)$/);
      if (rangeMatch) {
        const start = Number(rangeMatch[1]);
        const end = Number(rangeMatch[2]);
        const min = Math.min(start, end);
        const max = Math.max(start, end);
        for (let page = min; page <= max; page++) {
          if (page >= 1 && page <= maxPage) pageNumbers.add(page);
        }
        continue;
      }
      const page = Number(part);
      if (Number.isInteger(page) && page >= 1 && page <= maxPage) {
        pageNumbers.add(page);
      }
    }
    return Array.from(pageNumbers).sort((a, b) => a - b);
  }

  removeDeletedWorkbookPageLinks(workbook: BookWorkbook): void {
    if (!this.creator.book?.workbookLinks) return;
    const validPageIds = new Set(workbook.pages.map((page) => page.id));
    for (const [mainPageId, links] of Object.entries(this.creator.book.workbookLinks) as Array<[string, WorkbookLink[]]>) {
      this.creator.book.workbookLinks[mainPageId] = links
        .map((link) => link.workbookId === workbook.id
          ? { ...link, pageIds: link.pageIds.filter((pageId) => validPageIds.has(pageId)) }
          : link)
        .filter((link) => link.pageIds.length > 0);
    }
  }

  removeWorkbookLinks(workbookId: string): void {
    if (!this.creator.book?.workbookLinks) return;
    for (const [mainPageId, links] of Object.entries(this.creator.book.workbookLinks) as Array<[string, WorkbookLink[]]>) {
      const remainingLinks = links.filter((link) => link.workbookId !== workbookId);
      if (remainingLinks.length) {
        this.creator.book.workbookLinks[mainPageId] = remainingLinks;
      } else {
        delete this.creator.book.workbookLinks[mainPageId];
      }
    }
  }
}
