import {
  BookPage,
  getLessonPageRefs,
  getProgressNavigationMode,
  ProgressMapLesson,
  ProgressMapLessonPage,
  ProgressMapUnit,
  ProgressNavigationMode,
  pageNumberAt
} from '../../../core/book.model';
import {
  progressMapHarvestTree,
  progressMapIslandImage,
  progressMapLessonIcon,
  progressMapUnitLeftPercent
} from '../progress-map-layout';

/*
 * The map editor draws the reader's map: islands on the sea along a winding route. Sizes are in
 * cqw (percent of the map's width) so the map scales with the page and the zoom.
 */
const MAP_TOP = 3;
const MAP_STEP = 38;
const MAP_ISLAND_HEIGHT = 32;
const MAP_ROUTE_Y = 14;
const MAP_BOTTOM = 6;
/** Where an island's sign ends, below its top: the + between islands sits in the open sea after it. */
const MAP_SIGN_BOTTOM = 31;

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
    this.justAddedUnitId = null;
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

  /**
   * Adds a unit right after the selected one (or after `afterIndex`, the + on the route), or at
   * the end when none is selected. The new unit is selected and its name box is ready to type in.
   */
  addProgressUnit(afterIndex?: number): void {
    const page = this.creator.selectedPage;
    if (!page || page.type !== 'progressMap') return;
    this.creator.captureHistory();
    const units: ProgressMapUnit[] = page.progressUnits = page.progressUnits ?? [];
    const selectedIndex = units.findIndex((item) => item.id === this.selectedUnitId);
    const insertAt = afterIndex !== undefined
      ? Math.min(units.length, Math.max(0, afterIndex + 1))
      : selectedIndex >= 0 ? selectedIndex + 1 : units.length;
    const unit: ProgressMapUnit = {
      id: this.creator.createId('unit'),
      // At the end it's simply the next unit; in between, numbering would clash, so the teacher
      // names it (the name box is focused).
      name: insertAt === units.length ? `Unit ${units.length + 1}` : 'New unit',
      lessons: []
    };
    units.splice(insertAt, 0, unit);
    this.selectedUnitId = unit.id;
    this.justAddedUnitId = unit.id;
    this.creator.markBookDirty();
    this.revealUnit(unit.id, true);
  }

  /** The unit that was just added (it pops in on the map). */
  justAddedUnitId: string | null = null;

  /** Scrolls the map to the unit; `focusName` also puts the cursor in its name box. */
  private revealUnit(unitId: string, focusName = false): void {
    setTimeout(() => {
      const island = document.querySelector(`[data-unit-id="${unitId}"]`);
      island?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      if (!focusName) return;
      const input = document.querySelector<HTMLInputElement>('.progress-unit-card .progress-unit-name');
      input?.focus({ preventScroll: true });
      input?.select();
    }, 60);
  }

  // ---------- Map layout (cqw) ----------

  mapLeft(index: number): number {
    return progressMapUnitLeftPercent(index);
  }

  mapTop(index: number): string {
    return `${MAP_TOP + index * MAP_STEP}cqw`;
  }

  /** The sea's height: every unit plus the "add a unit" island at the end. */
  mapHeight(count: number): string {
    return `${MAP_TOP + count * MAP_STEP + MAP_ISLAND_HEIGHT + MAP_BOTTOM}cqw`;
  }

  mapViewBox(count: number): string {
    return `0 0 100 ${MAP_TOP + count * MAP_STEP + MAP_ISLAND_HEIGHT + MAP_BOTTOM}`;
  }

  /** The dotted sea route from island to island, ending at the "add a unit" island. */
  mapRoute(count: number): string {
    const points = Array.from({ length: count + 1 }, (_, i) => ({
      x: progressMapUnitLeftPercent(i),
      y: MAP_TOP + i * MAP_STEP + MAP_ROUTE_Y
    }));
    if (points.length < 2) return '';
    return points.reduce((path, point, i) => {
      if (i === 0) return `M ${point.x} ${point.y}`;
      const prev = points[i - 1];
      const midY = (prev.y + point.y) / 2;
      return `${path} C ${prev.x} ${midY} ${point.x} ${midY} ${point.x} ${point.y}`;
    }, '');
  }

  /**
   * Where the + between unit `index` and the next sits: on the route, in the open sea between the
   * island's sign and the next island.
   */
  mapGap(index: number): { left: number; top: string } {
    const x0 = progressMapUnitLeftPercent(index);
    const x1 = progressMapUnitLeftPercent(index + 1);
    const y0 = MAP_TOP + index * MAP_STEP + MAP_ROUTE_Y;
    const y1 = y0 + MAP_STEP;
    const targetY = MAP_TOP + index * MAP_STEP + (MAP_SIGN_BOTTOM + MAP_STEP) / 2;
    // The route is a cubic curve with both handles at the middle height; find its x at targetY.
    const midY = (y0 + y1) / 2;
    const yAt = (t: number) => (1 - t) ** 3 * y0 + 3 * (1 - t) ** 2 * t * midY + 3 * (1 - t) * t ** 2 * midY + t ** 3 * y1;
    let lo = 0;
    let hi = 1;
    for (let i = 0; i < 24; i++) {
      const mid = (lo + hi) / 2;
      if (yAt(mid) < targetY) lo = mid; else hi = mid;
    }
    const t = (lo + hi) / 2;
    const left = (1 - t) ** 3 * x0 + 3 * (1 - t) ** 2 * t * x0 + 3 * (1 - t) * t ** 2 * x1 + t ** 3 * x1;
    return { left, top: `${targetY}cqw` };
  }

  mapIsland(index: number): string {
    return progressMapIslandImage(index);
  }

  mapTree(index: number): string {
    return `assets/images/book/tree/${progressMapHarvestTree(index)}.webp`;
  }

  mapLessonIcon(index: number): string {
    return progressMapLessonIcon(index);
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
    // The islands sail to their new places; keep the moved one in view.
    this.revealUnit(unit.id);
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
      options.push({ value: `main::${page.id}`, label: `Page ${pageNumberAt(book.pages, index)} — ${bookTitle}` });
    });
    return options;
  }

  getProgressLessonPages(lesson: ProgressMapLesson): ProgressMapLessonPage[] {
    return getLessonPageRefs(lesson);
  }

  /** A lesson's pages, short, for its line on the map's sticky note: "p. 4, 6 · WB 5". */
  lessonPagesShort(lesson: ProgressMapLesson): string {
    const book = this.creator.book;
    if (!book) return '';
    const studentPages: string[] = [];
    const workbookPages: string[] = [];
    for (const ref of this.getProgressLessonPages(lesson)) {
      if (!ref.workbookId) {
        const index = book.pages.findIndex((page: BookPage) => page.id === ref.pageId);
        if (index >= 0) studentPages.push(String(pageNumberAt(book.pages, index) ?? index + 1));
        continue;
      }
      const workbook = (book.workbooks ?? []).find((item: { id: string }) => item.id === ref.workbookId);
      const index = workbook ? workbook.pages.findIndex((page: BookPage) => page.id === ref.pageId) : -1;
      if (index >= 0) workbookPages.push(String(index + 1));
    }
    return [
      studentPages.length ? `p. ${studentPages.join(', ')}` : '',
      workbookPages.length ? `WB ${workbookPages.join(', ')}` : ''
    ].filter(Boolean).join(' · ');
  }

  getProgressLessonPageLabel(ref: ProgressMapLessonPage): string {
    const book = this.creator.book;
    if (!book) return 'Unknown page';
    if (!ref.workbookId) {
      const index = book.pages.findIndex((page: BookPage) => page.id === ref.pageId);
      return index >= 0 ? `Page ${pageNumberAt(book.pages, index) ?? index + 1} — ${book.title || 'Book'}` : 'Unknown page';
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
