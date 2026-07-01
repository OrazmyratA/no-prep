import {
  getAvailableWordBankOptions,
  getChoiceTaskBankId,
  getMatchTaskGroupElements,
  getMatchTaskGroupId,
  getMatchTaskSide,
  getPageWordBank,
  isBookTaskElement,
  isChoiceTaskAnswerCorrect,
  isCircleTaskCorrectTarget,
  isMatchTaskConnectionCorrect,
  isTextTaskAnswerCorrect
} from '../../../core/book-tasks';
import {
  BookElement,
  BookPage,
  BookTaskResponse,
  BookWordBankOption
} from '../../../core/book.model';
import { ReaderMatchLine } from './book-reader.types';
import { getClampedFocusRect } from './book-reader-geometry';

export class BookReaderTaskController {
  constructor(private readonly reader: any) {}

  getTaskResponseValue(element: BookElement | null): string {
    return element ? this.reader.taskResponses.get(element.id)?.value ?? '' : '';
  }

  getTaskResult(element: BookElement): 'unchecked' | 'correct' | 'incorrect' {
    return this.reader.taskResponses.get(element.id)?.result ?? 'unchecked';
  }

  shouldUseTaskDock(element: BookElement): boolean {
    return element.type === 'textTask';
  }

  activateTextTask(element: BookElement, page: BookPage, event?: Event): void {
    event?.preventDefault();
    event?.stopPropagation();
    if (element.type !== 'textTask') return;
    this.activateTaskElement(element, page);
    window.setTimeout(() => {
      const documentRef = this.reader.readerStage?.nativeElement.ownerDocument as Document | undefined;
      documentRef
        ?.querySelector<HTMLInputElement>('.task-response-dock input')
        ?.focus();
    });
  }

  activateChoiceTask(element: BookElement, page: BookPage, event?: Event): void {
    event?.preventDefault();
    event?.stopPropagation();
    if (element.type !== 'choiceTask') return;
    this.activateTaskElement(element, page);
  }

  closeTaskInput(): void {
    this.reader.activeTaskElement = null;
    this.reader.activeTaskPageId = null;
  }

  updateTaskResponse(element: BookElement, page: BookPage, value: string): void {
    if (!this.reader.book || !isBookTaskElement(element)) return;
    const existing = this.reader.taskResponses.get(element.id);
    const response = this.createTaskResponse(element, page, value, 'unchecked', existing?.attempts ?? 0);
    this.reader.taskResponses.set(element.id, response);
    this.reader.pendingTaskResponseIds.add(element.id);
    this.reader.scheduleTaskResponseSave();
  }

  updateActiveTaskResponse(value: string): void {
    const element = this.reader.activeTaskElement;
    const page = this.reader.activeTaskPageId ? this.reader.getVisiblePageById(this.reader.activeTaskPageId) : null;
    if (element && page) this.updateTaskResponse(element, page, value);
  }

  getChoiceTaskDisplayValue(element: BookElement, page: BookPage): string {
    if (element.type !== 'choiceTask') return '';
    const optionId = this.getTaskResponseValue(element);
    return getPageWordBank(page, getChoiceTaskBankId(element))
      ?.options.find((option) => option.id === optionId)?.text || '';
  }

  getActiveWordBankOptions(): BookWordBankOption[] {
    const element = this.reader.activeTaskElement;
    const page = this.reader.activeTaskPageId ? this.reader.getVisiblePageById(this.reader.activeTaskPageId) : null;
    if (!element || element.type !== 'choiceTask' || !page) return [];
    return getAvailableWordBankOptions(page, getChoiceTaskBankId(element));
  }

  isActiveChoiceOptionSelected(optionId: string): boolean {
    return this.reader.activeTaskElement?.type === 'choiceTask' && this.getTaskResponseValue(this.reader.activeTaskElement) === optionId;
  }

  selectActiveChoiceOption(optionId: string): void {
    const element = this.reader.activeTaskElement;
    const page = this.reader.activeTaskPageId ? this.reader.getVisiblePageById(this.reader.activeTaskPageId) : null;
    if (!element || element.type !== 'choiceTask' || !page) return;
    if (!this.getActiveWordBankOptions().some((option) => option.id === optionId)) return;
    this.updateTaskResponse(element, page, optionId);
    this.closeTaskInput();
    this.reader.forceUiRefresh();
  }

  isCircleTaskSelected(element: BookElement): boolean {
    return element.type === 'circleTask' && this.getTaskResponseValue(element) === 'selected';
  }

  toggleCircleTask(element: BookElement, page: BookPage, event?: Event): void {
    event?.preventDefault();
    event?.stopPropagation();
    if (!this.reader.book || element.type !== 'circleTask') return;
    this.closeTaskInput();
    this.disableInputModes();
    const selectTarget = !this.isCircleTaskSelected(element);
    const existing = this.reader.taskResponses.get(element.id);
    const response = this.createTaskResponse(element, page, selectTarget ? 'selected' : '', 'unchecked', existing?.attempts ?? 0);
    this.reader.taskResponses.set(element.id, response);
    this.reader.pendingTaskResponseIds.add(element.id);
    this.reader.scheduleTaskResponseSave();
    this.reader.forceUiRefresh();
  }

  getMatchLines(page: BookPage): ReaderMatchLine[] {
    const endpoints = page.elements.filter((element) => element.type === 'matchTask');
    const endpointById = new Map(endpoints.map((element) => [element.id, element]));
    return endpoints
      .filter((element) => getMatchTaskSide(element) === 'A')
      .map((source) => {
        const response = this.reader.taskResponses.get(source.id);
        const target = endpointById.get(response?.value || '') ?? null;
        return target && getMatchTaskSide(target) === 'B'
          ? { source, target, result: response?.result ?? 'unchecked' }
          : null;
      })
      .filter((line): line is ReaderMatchLine => !!line);
  }

  isMatchEndpointSelected(element: BookElement, page: BookPage): boolean {
    return this.reader.activeMatchEndpoint?.elementId === element.id && this.reader.activeMatchEndpoint.pageId === page.id;
  }

  isMatchEndpointAvailable(element: BookElement, page: BookPage): boolean {
    if (!this.reader.activeMatchEndpoint) return true;
    if (this.isMatchEndpointSelected(element, page)) return true;
    if (this.reader.activeMatchEndpoint.pageId !== page.id) return false;
    const active = page.elements.find((item) => item.id === this.reader.activeMatchEndpoint?.elementId) ?? null;
    return !!active
      && getMatchTaskGroupId(active) === getMatchTaskGroupId(element)
      && getMatchTaskSide(active) !== getMatchTaskSide(element);
  }

  isMatchEndpointConnected(element: BookElement, page: BookPage): boolean {
    if (element.type !== 'matchTask') return false;
    if (getMatchTaskSide(element) === 'A') return !!this.reader.taskResponses.get(element.id)?.value;
    return page.elements
      .filter((source) => source.type === 'matchTask' && getMatchTaskSide(source) === 'A')
      .some((source) => this.reader.taskResponses.get(source.id)?.value === element.id);
  }

  isMatchEndpointMissing(element: BookElement, page: BookPage): boolean {
    if (element.type !== 'matchTask' || this.isMatchEndpointConnected(element, page)) return false;
    const group = getMatchTaskGroupElements(page, getMatchTaskGroupId(element));
    return group
      .filter((endpoint) => getMatchTaskSide(endpoint) === 'A')
      .some((source) => this.getTaskResult(source) !== 'unchecked');
  }

  activateMatchEndpoint(element: BookElement, page: BookPage, event?: Event): void {
    event?.preventDefault();
    event?.stopPropagation();
    if (element.type !== 'matchTask') return;
    this.closeTaskInput();
    this.disableInputModes();

    if (!this.reader.activeMatchEndpoint) {
      this.reader.activeMatchEndpoint = { elementId: element.id, pageId: page.id };
      this.reader.forceUiRefresh();
      return;
    }
    if (this.isMatchEndpointSelected(element, page)) {
      this.reader.activeMatchEndpoint = null;
      this.reader.forceUiRefresh();
      return;
    }
    if (!this.isMatchEndpointAvailable(element, page)) return;

    const active = page.elements.find((item) => item.id === this.reader.activeMatchEndpoint?.elementId) ?? null;
    if (!active) {
      this.reader.activeMatchEndpoint = null;
      return;
    }
    const source = getMatchTaskSide(active) === 'A' ? active : element;
    const target = getMatchTaskSide(active) === 'B' ? active : element;
    this.setMatchConnection(page, source, target);
    this.reader.activeMatchEndpoint = null;
    this.reader.forceUiRefresh();
  }

  hasVisibleTasks(): boolean {
    return this.getVisibleTaskEntries().length > 0;
  }

  checkVisibleTaskAnswers(): void {
    if (!this.reader.book) return;
    const entries = this.getVisibleTaskEntries();
    const changed: BookTaskResponse[] = [];
    this.checkTextAndChoiceTasks(entries, changed);
    this.checkCircleTasks(entries, changed);
    this.checkMatchTasks(entries, changed);
    this.reader.activeMatchEndpoint = null;
    void this.reader.taskResponseService.saveMany(changed);
    this.reader.forceUiRefresh();
  }

  private activateTaskElement(element: BookElement, page: BookPage): void {
    this.reader.activeTaskElement = element;
    this.reader.activeTaskPageId = page.id;
    this.disableInputModes();
    this.reader.forceUiRefresh();
  }

  private disableInputModes(): void {
    this.reader.drawMode = false;
    this.reader.highlighterMode = false;
    this.reader.textMode = false;
    this.reader.deleteMode = false;
  }

  private createTaskResponse(
    element: BookElement,
    page: BookPage,
    value: string,
    result: 'unchecked' | 'correct' | 'incorrect',
    attempts: number
  ): BookTaskResponse {
    return {
      key: this.reader.taskResponseService.makeKey(this.reader.book.id, element.id),
      profileId: this.reader.taskResponseService.defaultProfileId,
      bookId: this.reader.book.id,
      pageId: page.id,
      taskId: element.id,
      value,
      result,
      attempts,
      updatedAt: new Date().toISOString()
    };
  }

  private setMatchConnection(page: BookPage, source: BookElement, target: BookElement): void {
    if (!this.reader.book || getMatchTaskSide(source) !== 'A' || getMatchTaskSide(target) !== 'B') return;
    const group = getMatchTaskGroupElements(page, getMatchTaskGroupId(source));
    for (const endpoint of group.filter((item) => getMatchTaskSide(item) === 'A')) {
      const existing = this.reader.taskResponses.get(endpoint.id);
      const response = this.createTaskResponse(
        endpoint,
        page,
        endpoint.id === source.id
          ? target.id
          : existing?.value === target.id ? '' : existing?.value ?? '',
        'unchecked',
        existing?.attempts ?? 0
      );
      this.reader.taskResponses.set(endpoint.id, response);
      this.reader.pendingTaskResponseIds.add(endpoint.id);
    }
    this.reader.scheduleTaskResponseSave();
  }

  private getVisibleTaskEntries(): Array<{ page: BookPage; element: BookElement }> {
    const focus = this.reader.expandedFocusElement ? getClampedFocusRect(this.reader.expandedFocusElement) : null;
    return this.reader.getActiveAnnotationPages().flatMap((page: BookPage) =>
      page.elements
        .filter(isBookTaskElement)
        .filter((element) => !focus || this.elementIntersectsRect(element, focus))
        .map((element) => ({ page, element }))
    );
  }

  private elementIntersectsRect(
    element: BookElement,
    rect: { x: number; y: number; width: number; height: number }
  ): boolean {
    const right = element.x + (element.width || 0);
    const bottom = element.y + (element.height || 0);
    return right >= rect.x && element.x <= rect.x + rect.width && bottom >= rect.y && element.y <= rect.y + rect.height;
  }

  private checkTextAndChoiceTasks(entries: Array<{ page: BookPage; element: BookElement }>, changed: BookTaskResponse[]): void {
    for (const { page, element } of entries.filter((entry) =>
      entry.element.type !== 'circleTask' && entry.element.type !== 'matchTask'
    )) {
      const existing = this.reader.taskResponses.get(element.id);
      const value = existing?.value ?? '';
      const correct = element.type === 'choiceTask'
        ? isChoiceTaskAnswerCorrect(element, value)
        : isTextTaskAnswerCorrect(element, value);
      this.storeCheckedResponse(element, page, value, correct, existing, changed);
    }
  }

  private checkCircleTasks(entries: Array<{ page: BookPage; element: BookElement }>, changed: BookTaskResponse[]): void {
    for (const { page, element } of entries.filter((entry) => entry.element.type === 'circleTask')) {
      const existing = this.reader.taskResponses.get(element.id);
      const selected = this.isCircleTaskSelected(element);
      const response = this.createTaskResponse(
        element,
        page,
        existing?.value ?? '',
        selected ? (isCircleTaskCorrectTarget(element) ? 'correct' : 'incorrect') : 'unchecked',
        (existing?.attempts ?? 0) + 1
      );
      this.reader.taskResponses.set(element.id, response);
      changed.push(response);
      this.reader.pendingTaskResponseIds.delete(element.id);
    }
  }

  private checkMatchTasks(entries: Array<{ page: BookPage; element: BookElement }>, changed: BookTaskResponse[]): void {
    const matchGroups = new Map<string, { page: BookPage; elements: BookElement[] }>();
    for (const { page, element } of entries.filter((entry) => entry.element.type === 'matchTask')) {
      const key = `${page.id}:${getMatchTaskGroupId(element)}`;
      const group = matchGroups.get(key) || { page, elements: [] };
      group.elements.push(element);
      matchGroups.set(key, group);
    }
    for (const { page, elements } of matchGroups.values()) {
      const endpointById = new Map(elements.map((element) => [element.id, element]));
      for (const source of elements.filter((element) => getMatchTaskSide(element) === 'A')) {
        const existing = this.reader.taskResponses.get(source.id);
        const value = existing?.value ?? '';
        const correct = isMatchTaskConnectionCorrect(source, endpointById.get(value) ?? null);
        this.storeCheckedResponse(source, page, value, correct, existing, changed);
      }
    }
  }

  private storeCheckedResponse(
    element: BookElement,
    page: BookPage,
    value: string,
    correct: boolean,
    existing: BookTaskResponse | undefined,
    changed: BookTaskResponse[]
  ): void {
    const response = this.createTaskResponse(element, page, value, correct ? 'correct' : 'incorrect', (existing?.attempts ?? 0) + 1);
    this.reader.taskResponses.set(element.id, response);
    changed.push(response);
    this.reader.pendingTaskResponseIds.delete(element.id);
  }
}
