import {
  BookPage,
  getLessonPageRefs,
  getProgressNavigationMode,
  ProgressMapLesson,
  ProgressMapLessonPage,
  ProgressMapUnit,
  ProgressNavigationMode
} from '../../../core/book.model';

export class BookCreatorProgressMapController {
  selectedUnitId: string | null = null;
  private readonly pageSearchQueries: Record<string, string> = {};

  constructor(private readonly creator: any) {}

  isProgressMapPage(page: BookPage | null): boolean {
    return page?.type === 'progressMap';
  }

  getProgressNavigationMode(page: BookPage | null): ProgressNavigationMode {
    return getProgressNavigationMode(page);
  }

  toggleProgressNavigationMode(): void {
    const page = this.creator.selectedPage;
    if (!page || page.type !== 'progressMap') return;
    this.creator.captureHistory();
    page.progressNavigationMode = getProgressNavigationMode(page) === 'explorer' ? 'reader' : 'explorer';
    this.creator.markBookDirty();
  }

  isProgressUnitSelected(unit: ProgressMapUnit): boolean {
    return this.selectedUnitId === unit.id;
  }

  selectProgressUnit(unit: ProgressMapUnit): void {
    this.selectedUnitId = unit.id;
  }

  selectedProgressUnit(page: BookPage | null): ProgressMapUnit | null {
    if (!this.selectedUnitId) return null;
    return this.getProgressUnits(page).find((unit) => unit.id === this.selectedUnitId) ?? null;
  }

  getProgressUnits(page: BookPage | null): ProgressMapUnit[] {
    return page?.progressUnits ?? [];
  }

  trackByProgressUnitId(_index: number, unit: ProgressMapUnit): string {
    return unit.id;
  }

  trackByProgressLessonId(_index: number, lesson: ProgressMapLesson): string {
    return lesson.id;
  }

  trackByPageOptionValue(_index: number, option: { value: string; label: string }): string {
    return option.value;
  }

  addProgressUnit(): void {
    const page = this.creator.selectedPage;
    if (!page || page.type !== 'progressMap') return;
    this.creator.captureHistory();
    page.progressUnits = page.progressUnits ?? [];
    const unit = {
      id: this.creator.createId('unit'),
      name: `Unit ${page.progressUnits.length + 1}`,
      lessons: []
    };
    page.progressUnits.push(unit);
    this.selectedUnitId = unit.id;
    this.creator.markBookDirty();
  }

  removeProgressUnit(unit: ProgressMapUnit): void {
    const page = this.creator.selectedPage;
    if (!page?.progressUnits) return;
    this.creator.captureHistory();
    page.progressUnits = page.progressUnits.filter((item: ProgressMapUnit) => item.id !== unit.id);
    if (this.selectedUnitId === unit.id) {
      this.selectedUnitId = null;
    }
    this.creator.markBookDirty();
  }

  moveProgressUnit(unit: ProgressMapUnit, direction: -1 | 1): void {
    const page = this.creator.selectedPage;
    const units = page?.progressUnits;
    if (!units) return;
    const index = units.findIndex((item: ProgressMapUnit) => item.id === unit.id);
    const targetIndex = index + direction;
    if (index < 0 || targetIndex < 0 || targetIndex >= units.length) return;
    this.creator.captureHistory();
    [units[index], units[targetIndex]] = [units[targetIndex], units[index]];
    this.creator.markBookDirty();
  }

  updateProgressUnitName(unit: ProgressMapUnit, value: string): void {
    unit.name = String(value ?? '');
    this.creator.markBookDirty();
  }

  addProgressLesson(unit: ProgressMapUnit): void {
    this.creator.captureHistory();
    unit.lessons = unit.lessons ?? [];
    unit.lessons.push({
      id: this.creator.createId('lesson'),
      name: `Lesson ${unit.lessons.length + 1}`,
      pages: []
    });
    this.creator.markBookDirty();
  }

  removeProgressLesson(unit: ProgressMapUnit, lesson: ProgressMapLesson): void {
    this.creator.captureHistory();
    unit.lessons = unit.lessons.filter((item: ProgressMapLesson) => item.id !== lesson.id);
    this.creator.markBookDirty();
  }

  moveProgressLesson(unit: ProgressMapUnit, lesson: ProgressMapLesson, direction: -1 | 1): void {
    const lessons = unit.lessons;
    const index = lessons.findIndex((item: ProgressMapLesson) => item.id === lesson.id);
    const targetIndex = index + direction;
    if (index < 0 || targetIndex < 0 || targetIndex >= lessons.length) return;
    this.creator.captureHistory();
    [lessons[index], lessons[targetIndex]] = [lessons[targetIndex], lessons[index]];
    this.creator.markBookDirty();
  }

  updateProgressLessonName(lesson: ProgressMapLesson, value: string): void {
    lesson.name = String(value ?? '');
    this.creator.markBookDirty();
  }

  /**
   * Lessons only link student-book (main) pages — a lesson's connection to
   * workbook pages comes from the page-level workbook-link feature instead,
   * so Reader-mode's lesson boundary always resolves to a set of main pages.
   */
  getProgressLessonTargetOptions(): { value: string; label: string }[] {
    const book = this.creator.book;
    if (!book) return [];
    const options: { value: string; label: string }[] = [];
    const bookTitle = book.title || 'Book';
    book.pages.forEach((page: BookPage, index: number) => {
      if (page.type === 'progressMap') return;
      options.push({ value: `main::${page.id}`, label: `Page ${index + 1} — ${bookTitle}` });
    });
    return options;
  }

  getProgressLessonPages(lesson: ProgressMapLesson): ProgressMapLessonPage[] {
    return getLessonPageRefs(lesson);
  }

  getProgressLessonPageLabel(ref: ProgressMapLessonPage): string {
    const book = this.creator.book;
    if (!book) return 'Unknown page';
    if (!ref.workbookId) {
      const index = book.pages.findIndex((page: BookPage) => page.id === ref.pageId);
      return index >= 0 ? `Page ${index + 1} — ${book.title || 'Book'}` : 'Unknown page';
    }
    const workbook = (book.workbooks ?? []).find((item: { id: string }) => item.id === ref.workbookId);
    if (!workbook) return 'Unknown page';
    const index = workbook.pages.findIndex((page: BookPage) => page.id === ref.pageId);
    return index >= 0 ? `Page ${index + 1} — ${workbook.title}` : 'Unknown page';
  }

  getPageSearchQuery(lesson: ProgressMapLesson): string {
    return this.pageSearchQueries[lesson.id] ?? '';
  }

  setPageSearchQuery(lesson: ProgressMapLesson, value: string): void {
    this.pageSearchQueries[lesson.id] = value;
  }

  getFilteredLessonPageOptions(lesson: ProgressMapLesson): { value: string; label: string }[] {
    const query = this.getPageSearchQuery(lesson).trim().toLowerCase();
    if (!query) return [];
    const linked = new Set(getLessonPageRefs(lesson).map((ref) => `${ref.workbookId || 'main'}::${ref.pageId}`));
    return this.getProgressLessonTargetOptions()
      .filter((option) => !linked.has(option.value) && option.label.toLowerCase().includes(query))
      .slice(0, 40);
  }

  addProgressLessonPage(lesson: ProgressMapLesson, value: string): void {
    const [workbookIdRaw, pageId] = String(value || '').split('::');
    if (!pageId) return;
    this.creator.captureHistory();
    const pages = getLessonPageRefs(lesson).slice();
    const workbookId = workbookIdRaw === 'main' ? undefined : workbookIdRaw;
    if (!pages.some((ref) => ref.pageId === pageId && ref.workbookId === workbookId)) {
      pages.push({ pageId, workbookId });
    }
    lesson.pages = pages;
    this.creator.markBookDirty();
  }

  removeProgressLessonPage(lesson: ProgressMapLesson, ref: ProgressMapLessonPage): void {
    this.creator.captureHistory();
    lesson.pages = getLessonPageRefs(lesson).filter(
      (item) => !(item.pageId === ref.pageId && item.workbookId === ref.workbookId)
    );
    this.creator.markBookDirty();
  }

  goToProgressLessonPage(ref: ProgressMapLessonPage): void {
    const book = this.creator.book;
    if (!book) return;
    if (!ref.workbookId) {
      const index = book.pages.findIndex((page: BookPage) => page.id === ref.pageId);
      if (index >= 0) this.creator.selectMainPage(index);
      return;
    }
    const workbook = (book.workbooks ?? []).find((item: { id: string }) => item.id === ref.workbookId);
    if (!workbook) return;
    const index = workbook.pages.findIndex((page: BookPage) => page.id === ref.pageId);
    if (index >= 0) this.creator.selectWorkbookPage(workbook, index);
  }

  hasContentPage(): boolean {
    const book = this.creator.book;
    return !!book?.pages?.some((page: BookPage) => page.type === 'progressMap');
  }

  goToContentPage(): void {
    const book = this.creator.book;
    if (!book) return;
    const index = book.pages.findIndex((page: BookPage) => page.type === 'progressMap');
    if (index >= 0) this.creator.selectMainPage(index);
  }
}
