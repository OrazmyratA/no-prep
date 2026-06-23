import { BookElement, BookPage, BookWordBank, BookWordBankOption } from './book.model';

export function isBookTaskElement(element: BookElement): boolean {
  return element.type === 'textTask' || element.type === 'choiceTask' || element.type === 'circleTask' || element.type === 'matchTask';
}

export function getAcceptedTextTaskAnswers(element: BookElement): string[] {
  if (element.type !== 'textTask' || !Array.isArray(element.data?.['acceptedAnswers'])) return [];
  return (element.data['acceptedAnswers'] as unknown[])
    .map((answer) => String(answer ?? '').trim())
    .filter(Boolean);
}

export function isTextTaskAnswerCorrect(element: BookElement, response: string): boolean {
  const value = String(response ?? '').trim();
  return !!value && getAcceptedTextTaskAnswers(element).includes(value);
}

export function getChoiceTaskBankId(element: BookElement): string {
  return element.type === 'choiceTask' ? String(element.data?.['wordBankId'] || '') : '';
}

export function getChoiceTaskCorrectOptionId(element: BookElement): string {
  return element.type === 'choiceTask' ? String(element.data?.['correctOptionId'] || '') : '';
}

export function getPageWordBank(page: BookPage | null, bankId: string): BookWordBank | null {
  if (!page || !bankId) return null;
  return (page.wordBanks || []).find((bank) => bank.id === bankId) ?? null;
}

export function getUsableWordBankOptions(bank: BookWordBank | null): BookWordBankOption[] {
  return (bank?.options || []).filter((option) => !!String(option.text || '').trim());
}

export function isChoiceTaskAnswerCorrect(element: BookElement, optionId: string): boolean {
  return !!optionId && getChoiceTaskCorrectOptionId(element) === optionId;
}

export function getAvailableWordBankOptions(
  page: BookPage,
  bankId: string
): BookWordBankOption[] {
  return getUsableWordBankOptions(getPageWordBank(page, bankId));
}

export function isCircleTaskCorrectTarget(element: BookElement): boolean {
  return element.type === 'circleTask' && element.data?.['correct'] === true;
}

export type MatchTaskSide = 'A' | 'B';

export function getMatchTaskGroupId(element: BookElement): string {
  return element.type === 'matchTask' ? String(element.data?.['groupId'] || '') : '';
}

export function getMatchTaskPairId(element: BookElement): string {
  return element.type === 'matchTask' ? String(element.data?.['pairId'] || '') : '';
}

export function getMatchTaskSide(element: BookElement): MatchTaskSide | null {
  const side = element.type === 'matchTask' ? element.data?.['side'] : null;
  return side === 'A' || side === 'B' ? side : null;
}

export function getMatchTaskGroupElements(page: BookPage, groupId: string): BookElement[] {
  return page.elements.filter((element) =>
    element.type === 'matchTask' && getMatchTaskGroupId(element) === groupId
  );
}

export function isMatchTaskConnectionCorrect(source: BookElement, target: BookElement | null): boolean {
  return source.type === 'matchTask'
    && target?.type === 'matchTask'
    && getMatchTaskSide(source) === 'A'
    && getMatchTaskSide(target) === 'B'
    && !!getMatchTaskPairId(source)
    && getMatchTaskPairId(source) === getMatchTaskPairId(target)
    && getMatchTaskGroupId(source) === getMatchTaskGroupId(target);
}
