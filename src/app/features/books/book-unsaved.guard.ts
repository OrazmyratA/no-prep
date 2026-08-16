import { CanDeactivateFn } from '@angular/router';
import { BookCreatorComponent } from './book-creator/book-creator';
import { BookReaderComponent } from './book-reader/book-reader';

export const canDeactivateBookCreator: CanDeactivateFn<BookCreatorComponent> = (component) => {
  return component.canDeactivate();
};

export const canDeactivateBookReader: CanDeactivateFn<BookReaderComponent> = (component) => {
  return component.canDeactivate();
};
