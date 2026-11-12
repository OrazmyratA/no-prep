import { BookElement } from '../../../core/book.model';
import { PresentationLink } from '../../../core/db.model';
import { PresentationItem } from '../../../core/presentations';

/** Puts a PowerPoint file on a PPT icon (the reader plays it in No-Prep's player). */
export function applyPresentationFile(element: BookElement, item: PresentationItem): void {
  element.data['presentationKind'] = 'file';
  element.data['presentationId'] = item.id;
  // The title lets the reader find the same lesson on another computer (added there by hand).
  element.data['presentationTitle'] = item.title;
  element.data['presentationUrl'] = '';
  element.data['label'] = item.title;
  element.data['startSlide'] = 1;
}

/** Puts a Canva / Google Slides link on a PPT icon; the book carries the link itself. */
export function applyPresentationLink(element: BookElement, link: PresentationLink): void {
  element.data['presentationKind'] = 'link';
  element.data['presentationId'] = link.id;
  element.data['presentationTitle'] = link.title;
  element.data['presentationUrl'] = link.url;
  element.data['label'] = link.title;
  element.data['startSlide'] = 1;
}

/**
 * A PPT icon's "Choose a presentation": like the game icon's topic picker, the teacher goes to
 * the Presentations tab, clicks a card there and comes back to the same icon with it linked.
 */
export class BookCreatorPresentationController {
  constructor(private creator: any) {}

  async choosePresentationFromList(element: BookElement): Promise<boolean> {
    const creator = this.creator;
    if (!creator.book || element.type !== 'presentation') return false;
    if (!(await creator.confirmSaveBeforeLeaving())) return false;
    creator.bypassUnsavedGuard = true;
    const returnUrl = creator.router.serializeUrl(
      creator.router.createUrlTree(['/books', creator.book.id, 'edit'], {
        queryParams: { presentationElementId: element.id }
      })
    );
    creator.presentationPick.begin(returnUrl);
    const navigated = await creator.router.navigate(['/topics'], { queryParams: { category: 'presentations' } });
    creator.bypassUnsavedGuard = !navigated;
    if (!navigated) creator.presentationPick.reset();
    return !!navigated;
  }

  /** Back from the Presentations tab (picked or cancelled). False when this wasn't that trip. */
  async attachReturnedPresentation(): Promise<boolean> {
    const creator = this.creator;
    if (!creator.book) return false;
    const query = creator.route.snapshot.queryParamMap;
    const elementId = query.get('presentationElementId');
    if (!elementId) return false;
    const location = creator.gameController.findGameElement(elementId, 'presentation');
    const kind = query.get('pickedPresentationKind');
    const id = String(query.get('pickedPresentationId') || '');
    if (location && id && (kind === 'file' || kind === 'link')) {
      await this.apply(location.element, kind, id);
    }
    if (location) {
      // Back on the icon's page with it selected, picked or not (jump also saves and tidies the address).
      await creator.gameController.jumpToGameElement(location);
    } else {
      await creator.router.navigate(['/books', creator.book.id, 'edit'], { replaceUrl: true });
    }
    return true;
  }

  private async apply(element: BookElement, kind: 'file' | 'link', id: string): Promise<boolean> {
    const creator = this.creator;
    if (kind === 'link') {
      const link = await creator.presentationLinks.get(id);
      if (!link) return false;
      creator.captureHistory();
      applyPresentationLink(element, link);
      return true;
    }
    await creator.presentations.refresh();
    const item = (creator.presentations.items$.value as PresentationItem[]).find((entry) => entry.id === id);
    if (!item) return false;
    creator.captureHistory();
    applyPresentationFile(element, item);
    return true;
  }
}
