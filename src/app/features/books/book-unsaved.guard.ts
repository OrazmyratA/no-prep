import { CanDeactivateFn } from '@angular/router';
import { BookCreatorComponent } from './book-creator/book-creator';

export const canDeactivateBookCreator: CanDeactivateFn<BookCreatorComponent> = (component) => {
  return component.canDeactivate();
};
