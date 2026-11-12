import { Injectable } from '@angular/core';
import { Router } from '@angular/router';

export type PickedPresentationKind = 'file' | 'link';

/**
 * "Choose a presentation" round trip, like the game icon's topic picker: the book creator sends
 * the teacher to the Presentations tab, a click on a card goes back with it. The pick rides on
 * the return address as pickedPresentationKind / pickedPresentationId.
 */
@Injectable({ providedIn: 'root' })
export class PresentationPickService {
  private returnUrl: string | null = null;

  constructor(private router: Router) {}

  get isPicking(): boolean {
    return this.returnUrl !== null;
  }

  begin(returnUrl: string): void {
    this.returnUrl = returnUrl;
  }

  async complete(kind: PickedPresentationKind, id: string): Promise<void> {
    const returnUrl = this.returnUrl;
    this.returnUrl = null;
    if (!returnUrl) return;
    const tree = this.router.parseUrl(returnUrl);
    tree.queryParams = { ...tree.queryParams, pickedPresentationKind: kind, pickedPresentationId: id };
    await this.router.navigateByUrl(tree);
  }

  /** Forgets a pick the teacher walked away from (no navigation). */
  reset(): void {
    this.returnUrl = null;
  }

  cancel(): void {
    const returnUrl = this.returnUrl;
    this.returnUrl = null;
    if (returnUrl) void this.router.navigateByUrl(returnUrl);
  }
}
