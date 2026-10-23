import { Type } from '@angular/core';
import { SeasonThemeId } from './db.model';

// A seasonal theme is a pack: a CSS backdrop (painted by the normal theme layer) plus an optional
// ambient decoration component. The decoration lives in its own lazy chunk, so a pack costs
// nothing until someone picks it.
export interface SeasonTheme {
  id: SeasonThemeId;
  nameKey: string;
  icon: string;
  background: string;
  loadAmbient: () => Promise<Type<unknown>>;
}

export const SEASON_THEMES: SeasonTheme[] = [
  {
    id: 'halloween',
    nameKey: 'themeSeasonHalloween',
    icon: '🎃',
    background: [
      'radial-gradient(ellipse 70% 45% at 50% 108%, rgba(234, 88, 12, 0.55) 0%, rgba(194, 65, 12, 0.18) 45%, transparent 75%)',
      'radial-gradient(circle at 80% 20%, rgba(253, 230, 138, 0.22) 0%, rgba(251, 191, 36, 0.08) 12%, transparent 26%)',
      'linear-gradient(180deg, #0b0618 0%, #1e0b3a 38%, #3b1250 68%, #5b1a3a 100%)'
    ].join(', '),
    loadAmbient: () => import('../shared/season-ambient/halloween-ambient').then(m => m.HalloweenAmbientComponent)
  }
];

export function seasonTheme(id: SeasonThemeId | undefined): SeasonTheme | undefined {
  return SEASON_THEMES.find(theme => theme.id === id);
}
