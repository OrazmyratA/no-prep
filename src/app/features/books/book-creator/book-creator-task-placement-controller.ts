import {
  BookElement,
  BookPage
} from '../../../core/book.model';
import {
  getMatchTaskGroupId,
  getMatchTaskPairId,
  getMatchTaskSide
} from '../../../core/book-tasks';

type TaskDrawType = 'textTask' | 'choiceTask' | 'circleTask';

export class BookCreatorTaskPlacementController {
  constructor(private readonly creator: any) {}

  toggleTextTaskTool(): void {
    this.creator.clearCreatorMarkModes();
    this.discardPendingMatchEndpoint();
    this.creator.placingTextTask = !this.creator.placingTextTask;
    this.creator.placingChoiceTask = false;
    this.creator.placingCircleTask = false;
    this.creator.placingMatchTask = false;
    this.creator.activeChoiceWordBankId = null;
    this.creator.activeMatchGroupId = null;
    this.creator.placingGuidePin = false;
    this.creator.selectedElementId = null;
  }

  toggleChoiceTaskTool(): void {
    this.creator.clearCreatorMarkModes();
    this.discardPendingMatchEndpoint();
    const activating = !this.creator.placingChoiceTask;
    this.creator.placingChoiceTask = activating;
    this.creator.placingTextTask = false;
    this.creator.placingCircleTask = false;
    this.creator.placingMatchTask = false;
    this.creator.activeChoiceWordBankId = activating ? this.creator.createId('word-bank') : null;
    this.creator.activeMatchGroupId = null;
    this.creator.placingGuidePin = false;
    this.creator.selectedElementId = null;
  }

  toggleCircleTaskTool(): void {
    this.creator.clearCreatorMarkModes();
    this.discardPendingMatchEndpoint();
    const activating = !this.creator.placingCircleTask;
    this.creator.placingCircleTask = activating;
    this.creator.placingTextTask = false;
    this.creator.placingChoiceTask = false;
    this.creator.placingMatchTask = false;
    this.creator.placingGuidePin = false;
    this.creator.activeChoiceWordBankId = null;
    this.creator.activeMatchGroupId = null;
    this.creator.selectedElementId = null;
  }

  toggleMatchTaskTool(): void {
    this.creator.clearCreatorMarkModes();
    const activating = !this.creator.placingMatchTask;
    this.discardPendingMatchEndpoint();
    this.creator.placingMatchTask = activating;
    this.creator.placingTextTask = false;
    this.creator.placingChoiceTask = false;
    this.creator.placingCircleTask = false;
    this.creator.placingGuidePin = false;
    this.creator.activeChoiceWordBankId = null;
    this.creator.activeMatchGroupId = activating ? this.creator.createId('match-group') : null;
    this.creator.selectedElementId = null;
  }

  clearTaskPlacementModes(): void {
    this.discardPendingMatchEndpoint();
    this.creator.placingTextTask = false;
    this.creator.placingChoiceTask = false;
    this.creator.placingCircleTask = false;
    this.creator.placingMatchTask = false;
    this.creator.placingGuidePin = false;
    this.creator.activeChoiceWordBankId = null;
    this.creator.activeMatchGroupId = null;
    this.creator.pendingMatchEndpointId = null;
    this.creator.selectedElementId = null;
  }

  finishTaskPlacement(): void {
    this.discardPendingMatchEndpoint();
    this.creator.placingTextTask = false;
    this.creator.placingChoiceTask = false;
    this.creator.placingCircleTask = false;
    this.creator.placingMatchTask = false;
    this.creator.activeChoiceWordBankId = null;
    this.creator.activeMatchGroupId = null;
  }

  placeMatchEndpoint(event: PointerEvent): void {
    const page = this.creator.selectedPage;
    const rect = this.creator.editorCanvas?.nativeElement.getBoundingClientRect();
    if (!page || !rect?.width || !rect.height) return;
    event.preventDefault();
    event.stopPropagation();

    let pending = this.creator.pendingMatchEndpointId
      ? page.elements.find((element: BookElement) => element.id === this.creator.pendingMatchEndpointId && element.type === 'matchTask') ?? null
      : null;
    if (this.creator.pendingMatchEndpointId && !pending) {
      this.discardPendingMatchEndpoint();
      pending = null;
    }

    this.creator.activeMatchGroupId ||= this.creator.createId('match-group');
    const pairId = pending ? getMatchTaskPairId(pending) : this.creator.createId('match-pair');
    const side = pending ? 'B' : 'A';
    const width = 0.034;
    const height = this.creator.clamp(width * rect.width / rect.height, 0.022, 0.06);
    const centerX = this.creator.clamp((event.clientX - rect.left) / rect.width, 0, 1);
    const centerY = this.creator.clamp((event.clientY - rect.top) / rect.height, 0, 1);
    const element: BookElement = {
      id: this.creator.createId('match-endpoint'),
      type: 'matchTask',
      x: this.creator.clamp(centerX - width / 2, 0, 1 - width),
      y: this.creator.clamp(centerY - height / 2, 0, 1 - height),
      width,
      height,
      data: { groupId: this.creator.activeMatchGroupId, pairId, side }
    };
    this.creator.captureHistory();
    page.elements.push(element);
    this.creator.selectedElementId = element.id;
    this.creator.pendingMatchEndpointId = side === 'A' ? element.id : null;
    this.creator.lastTaskDrawAt = Date.now();
  }

  startTaskDraw(event: PointerEvent, type: TaskDrawType): void {
    const page = this.creator.selectedPage;
    const rect = this.creator.editorCanvas?.nativeElement.getBoundingClientRect();
    if (!page || !rect?.width || !rect.height) return;
    event.preventDefault();
    event.stopPropagation();
    const startX = this.creator.clamp((event.clientX - rect.left) / rect.width, 0, 1);
    const startY = this.creator.clamp((event.clientY - rect.top) / rect.height, 0, 1);
    this.creator.beginHistoryCapture();
    const wordBank = type === 'choiceTask' ? this.creator.ensureActiveChoiceWordBank(page) : null;
    const element: BookElement = {
      id: this.creator.createId(type === 'choiceTask' ? 'choice-task' : type === 'circleTask' ? 'circle-task' : 'text-task'),
      type,
      x: startX,
      y: startY,
      width: 0.08,
      height: 0.035,
      data: type === 'choiceTask'
        ? { wordBankId: wordBank?.id || '', correctOptionId: '' }
        : type === 'circleTask'
          ? { correct: false }
          : { acceptedAnswers: [''] }
    };
    page.elements.push(element);
    this.creator.selectedElementId = element.id;
    this.creator.taskDrawState = { elementId: element.id, startX, startY, type };
  }

  updateTaskDraw(clientX: number, clientY: number): void {
    const state = this.creator.taskDrawState;
    const rect = this.creator.editorCanvas?.nativeElement.getBoundingClientRect();
    const element = this.creator.selectedElement;
    if (!state || !rect?.width || !rect.height || !element || element.id !== state.elementId) return;
    const currentX = this.creator.clamp((clientX - rect.left) / rect.width, 0, 1);
    const currentY = this.creator.clamp((clientY - rect.top) / rect.height, 0, 1);
    const minWidth = 0.055;
    const minHeight = 0.025;
    const left = Math.min(state.startX, currentX);
    const top = Math.min(state.startY, currentY);
    element.x = this.creator.clamp(left, 0, 1 - minWidth);
    element.y = this.creator.clamp(top, 0, 1 - minHeight);
    element.width = this.creator.clamp(Math.max(minWidth, Math.abs(currentX - state.startX)), minWidth, 1 - element.x);
    element.height = this.creator.clamp(Math.max(minHeight, Math.abs(currentY - state.startY)), minHeight, 1 - element.y);
  }

  finishTaskDraw(event: PointerEvent): void {
    this.updateTaskDraw(event?.clientX ?? 0, event?.clientY ?? 0);
    this.creator.commitHistoryCapture();
    this.creator.taskDrawState = null;
    this.creator.lastTaskDrawAt = Date.now();
  }

  cancelTaskDraw(): void {
    this.creator.commitHistoryCapture();
    this.creator.taskDrawState = null;
    this.creator.lastTaskDrawAt = Date.now();
  }

  discardPendingMatchEndpoint(): void {
    if (!this.creator.pendingMatchEndpointId || !this.creator.book) return;
    const pendingId = this.creator.pendingMatchEndpointId;
    for (const page of this.creator.getAllCreatorPages() as BookPage[]) {
      const previousLength = page.elements.length;
      page.elements = page.elements.filter((element) => element.id !== pendingId);
      if (page.elements.length !== previousLength) {
        this.creator.markBookDirty();
      }
    }
    if (this.creator.selectedElementId === pendingId) this.creator.selectedElementId = null;
    this.creator.pendingMatchEndpointId = null;
  }

  syncPendingMatchEndpoint(): void {
    this.creator.pendingMatchEndpointId = null;
    if (!this.creator.placingMatchTask || !this.creator.activeMatchGroupId) return;
    for (const page of this.creator.getAllCreatorPages() as BookPage[]) {
      const endpoints = page.elements.filter((element) =>
        element.type === 'matchTask' && getMatchTaskGroupId(element) === this.creator.activeMatchGroupId
      );
      const completedPairIds = new Set(
        endpoints.filter((element) => getMatchTaskSide(element) === 'B').map((element) => getMatchTaskPairId(element))
      );
      const pending = [...endpoints].reverse().find((element) =>
        getMatchTaskSide(element) === 'A' && !completedPairIds.has(getMatchTaskPairId(element))
      );
      if (pending) {
        this.creator.pendingMatchEndpointId = pending.id;
        return;
      }
    }
  }
}
