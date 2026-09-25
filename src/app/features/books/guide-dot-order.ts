import { BookElement } from '../../core/book.model';

/**
 * The teacher guide dots of a page in the order the reader unlocks them: by an explicit
 * `stepNumber` when one is set, otherwise by position in the page's element list (which is also
 * what "bring forward / send backward" changes). Single source of truth for the reader's
 * sequencing and the numbers shown on the dots.
 */
export function getOrderedGuideDots(elements: readonly BookElement[]): BookElement[] {
  return elements
    .map((element, index) => ({ element, index }))
    .filter(({ element }) => element.type === 'guideDot')
    .sort((a, b) => Number(a.element.data['stepNumber'] ?? a.index) - Number(b.element.data['stepNumber'] ?? b.index))
    .map(({ element }) => element);
}

/** 1-based position of `element` among `dots`, or 0 when there is only one dot (nothing to order). */
export function getGuideDotNumber(dots: readonly { id: string }[], elementId: string): number {
  if (dots.length < 2) return 0;
  return dots.findIndex((dot) => dot.id === elementId) + 1;
}
