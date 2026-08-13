import { BookLessonProgress, BookPage, getLessonPageRefs, ProgressMapLesson, ProgressMapUnit } from '../../../core/book.model';

export class BookReaderProgressController {
  constructor(private readonly reader: any) {}

  private getLessonPages(lesson: ProgressMapLesson): BookPage[] {
    const refs = getLessonPageRefs(lesson);
    const pages: BookPage[] = [];
    for (const ref of refs) {
      if (ref.workbookId) {
        const workbook = this.reader.getWorkbook(ref.workbookId);
        const page = workbook?.pages.find((item: BookPage) => item.id === ref.pageId);
        if (page) pages.push(page);
      } else {
        const page = this.reader.book?.pages.find((item: BookPage) => item.id === ref.pageId);
        if (page) pages.push(page);
      }
    }
    return pages;
  }

  private isPageLearnt(page: BookPage): boolean {
    const record = (this.reader.pageProgress as Map<string, BookLessonProgress>).get(page.id);
    if (!record?.reached) return false;
    const totalDots = page.elements.filter((element) => element.type === 'guideDot').length;
    if (!totalDots) return true;
    return (record.guideDotsCompleted ?? 0) >= totalDots;
  }

  isLessonComplete(lesson: ProgressMapLesson): boolean {
    const pages = this.getLessonPages(lesson);
    if (!pages.length) return false;
    return pages.every((page) => this.isPageLearnt(page));
  }

  isLessonUnlocked(unit: ProgressMapUnit, lessonIndex: number): boolean {
    if (lessonIndex <= 0) return true;
    const previous = unit.lessons[lessonIndex - 1];
    return !!previous && this.isLessonComplete(previous);
  }

  getUnitCompletionRatio(unit: ProgressMapUnit): number {
    if (!unit.lessons.length) return 0;
    const completed = unit.lessons.filter((lesson) => this.isLessonComplete(lesson)).length;
    return completed / unit.lessons.length;
  }

  isUnitUnlocked(units: ProgressMapUnit[], unitIndex: number): boolean {
    if (unitIndex <= 0) return true;
    const previous = units[unitIndex - 1];
    return !!previous && this.getUnitCompletionRatio(previous) >= 1;
  }

  getBookCompletionPercent(): number {
    const book = this.reader.book;
    if (!book) return 0;

    const allPages: BookPage[] = [
      ...book.pages,
      ...((book.workbooks ?? []) as { pages: BookPage[] }[]).flatMap((workbook) => workbook.pages)
    ];
    const dotPages = allPages.filter((page) => page.elements.some((element) => element.type === 'guideDot'));
    if (dotPages.length) {
      const learntPages = dotPages.filter((page) => this.isPageLearnt(page)).length;
      return Math.round((learntPages / dotPages.length) * 100);
    }

    const mapPage = book.pages.find((page: BookPage) => page.type === 'progressMap');
    const units: ProgressMapUnit[] = mapPage?.progressUnits ?? [];
    const allLessons = units.flatMap((unit) => unit.lessons);
    if (!allLessons.length) return 0;
    const completedLessons = allLessons.filter((lesson) => this.isLessonComplete(lesson)).length;
    return Math.round((completedLessons / allLessons.length) * 100);
  }
}
