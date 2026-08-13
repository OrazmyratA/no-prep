import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { db } from '../../core/db.model';
import { LanguageService } from '../../core/language';
import { showAppNotification } from '../../core/notification';

// Guards every :id-based topic route (edit/activities/play/**) so a malformed
// or stale topic id redirects gracefully instead of leaving child components
// stuck on an unhandled IndexedDB key rejection (NaN is not a valid IDB key).
export const topicExistsGuard: CanActivateFn = async (route) => {
  const router = inject(Router);
  const langService = inject(LanguageService);

  const id = Number(route.paramMap.get('id'));
  const topic = Number.isFinite(id) && id > 0 ? await db.topics.get(id) : undefined;

  if (!topic) {
    showAppNotification(langService.translate('topicNotFound'), 'error');
    return router.createUrlTree(['/topics']);
  }

  return true;
};
