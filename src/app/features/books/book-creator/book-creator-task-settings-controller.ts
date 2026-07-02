import {
  BookElement,
  BookWordBank,
  BookWordBankOption
} from '../../../core/book.model';
import {
  getChoiceTaskBankId,
  getMatchTaskGroupId,
  getMatchTaskPairId,
  getMatchTaskSide,
  getPageWordBank
} from '../../../core/book-tasks';

export class BookCreatorTaskSettingsController {
  constructor(private readonly creator: any) {}

  getTextTaskAnswers(element: BookElement): string[] {
    if (element.type !== 'textTask') return [];
    return Array.isArray(element.data['acceptedAnswers'])
      ? element.data['acceptedAnswers'] as string[]
      : [];
  }

  updateTextTaskAnswer(element: BookElement, index: number, value: string): void {
    if (element.type !== 'textTask') return;
    const answers = this.getTextTaskAnswers(element);
    answers[index] = value;
    while (answers.length > 1 && !answers[answers.length - 1] && !answers[answers.length - 2]) {
      answers.pop();
    }
    if (answers[answers.length - 1] !== '') answers.push('');
    element.data['acceptedAnswers'] = answers;
    this.creator.markBookDirty();
  }

  removeTextTaskAnswer(element: BookElement, index: number): void {
    if (element.type !== 'textTask') return;
    this.creator.captureHistory();
    const answers = this.getTextTaskAnswers(element);
    answers.splice(index, 1);
    if (!answers.length || answers[answers.length - 1] !== '') answers.push('');
    element.data['acceptedAnswers'] = answers;
  }

  getChoiceTaskBanks(): BookWordBank[] {
    return this.creator.selectedPage?.wordBanks || [];
  }

  getChoiceTaskBank(element: BookElement): BookWordBank | null {
    return getPageWordBank(this.creator.selectedPage, getChoiceTaskBankId(element));
  }

  getChoiceTaskCorrectText(element: BookElement): string {
    const bank = this.getChoiceTaskBank(element);
    const optionId = String(element.data['correctOptionId'] || '');
    return bank?.options.find((option) => option.id === optionId)?.text || '';
  }

  getWordBankOptions(bank: BookWordBank): BookWordBankOption[] {
    return bank.options || [];
  }

  getWordBankLabel(bank: BookWordBank): string {
    const index = this.getChoiceTaskBanks().findIndex((item) => item.id === bank.id);
    return `Word bank ${Math.max(0, index) + 1}`;
  }

  createWordBankForTask(element: BookElement): void {
    if (element.type !== 'choiceTask') return;
    this.creator.discardPendingMatchEndpoint();
    this.creator.activeChoiceWordBankId = this.creator.createId('word-bank');
    this.creator.placingChoiceTask = true;
    this.creator.placingTextTask = false;
    this.creator.placingCircleTask = false;
    this.creator.placingMatchTask = false;
    this.creator.placingGuidePin = false;
    this.creator.activeMatchGroupId = null;
    this.creator.selectedElementId = null;
  }

  selectChoiceTaskBank(element: BookElement, bankId: string): void {
    if (element.type !== 'choiceTask' || getChoiceTaskBankId(element) === bankId) return;
    this.creator.captureHistory();
    element.data['wordBankId'] = bankId;
    element.data['correctOptionId'] = '';
  }

  updateWordBankOption(bank: BookWordBank, index: number, value: string): void {
    const option = bank.options[index];
    if (!option) return;
    option.text = value;
    while (bank.options.length > 1 && !bank.options.at(-1)?.text && !bank.options.at(-2)?.text) {
      bank.options.pop();
    }
    if (bank.options.at(-1)?.text) {
      bank.options.push({ id: this.creator.createId('word-option'), text: '' });
    }
    this.creator.markBookDirty();
  }

  removeWordBankOption(bank: BookWordBank, index: number): void {
    const page = this.creator.selectedPage;
    const option = bank.options[index];
    if (!page || !option) return;
    this.creator.captureHistory();
    bank.options.splice(index, 1);
    if (!bank.options.length || bank.options.at(-1)?.text) {
      bank.options.push({ id: this.creator.createId('word-option'), text: '' });
    }
    for (const gap of page.elements) {
      if (gap.type === 'choiceTask' && gap.data['correctOptionId'] === option.id) {
        gap.data['correctOptionId'] = '';
      }
    }
  }

  setChoiceTaskCorrectOption(element: BookElement, optionId: string): void {
    if (element.type !== 'choiceTask' || element.data['correctOptionId'] === optionId) return;
    this.creator.captureHistory();
    element.data['correctOptionId'] = optionId;
  }

  setCircleTaskCorrect(element: BookElement, correct: boolean): void {
    if (element.type !== 'circleTask' || element.data['correct'] === correct) return;
    this.creator.captureHistory();
    element.data['correct'] = correct;
  }

  getMatchTaskGroupIds(): string[] {
    const groupIds = (this.creator.selectedPage?.elements || [])
      .filter((element: BookElement) => element.type === 'matchTask')
      .map((element: BookElement) => getMatchTaskGroupId(element))
      .filter(Boolean);
    return Array.from(new Set(groupIds));
  }

  getMatchTaskGroupLabel(groupId: string): string {
    const index = this.getMatchTaskGroupIds().indexOf(groupId);
    return `Matching ${Math.max(0, index) + 1}`;
  }

  getMatchTaskPairNumber(element: BookElement): number {
    const groupId = getMatchTaskGroupId(element);
    const pairIds = (this.creator.selectedPage?.elements || [])
      .filter((item: BookElement) => item.type === 'matchTask' && getMatchTaskGroupId(item) === groupId)
      .map((item: BookElement) => getMatchTaskPairId(item));
    return Math.max(0, Array.from(new Set(pairIds)).indexOf(getMatchTaskPairId(element))) + 1;
  }

  getMatchTaskSideLabel(element: BookElement): string {
    return getMatchTaskSide(element) || '';
  }

  isPendingMatchEndpoint(element: BookElement): boolean {
    return element.type === 'matchTask' && element.id === this.creator.pendingMatchEndpointId;
  }

  setMatchTaskGroup(element: BookElement, groupId: string): void {
    const page = this.creator.selectedPage;
    if (!page || element.type !== 'matchTask' || !groupId || getMatchTaskGroupId(element) === groupId) return;
    this.creator.captureHistory();
    const pairId = getMatchTaskPairId(element);
    for (const endpoint of page.elements) {
      if (endpoint.type === 'matchTask' && getMatchTaskPairId(endpoint) === pairId) {
        endpoint.data['groupId'] = groupId;
      }
    }
    this.creator.activeMatchGroupId = groupId;
  }

  createMatchTaskGroup(element: BookElement): void {
    if (element.type !== 'matchTask') return;
    this.creator.discardPendingMatchEndpoint();
    this.creator.activeMatchGroupId = this.creator.createId('match-group');
    this.creator.placingMatchTask = true;
    this.creator.placingTextTask = false;
    this.creator.placingChoiceTask = false;
    this.creator.placingCircleTask = false;
    this.creator.placingGuidePin = false;
    this.creator.activeChoiceWordBankId = null;
    this.creator.selectedElementId = null;
  }
}
