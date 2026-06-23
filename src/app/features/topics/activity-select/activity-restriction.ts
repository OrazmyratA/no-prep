import { GAMES, GameConfig } from '../games.config';

export type ActivityAccessMode = 'all' | 'selected';

export function normalizeAllowedActivityIds(value: unknown): string[] {
  const rawIds = Array.isArray(value) ? value : String(value || '').split(',');
  const requested = new Set(rawIds.map((id) => String(id || '').trim()).filter(Boolean));
  return GAMES.map((game) => game.id).filter((id) => requested.has(id));
}

export function filterGamesByActivityRestriction(
  mode: ActivityAccessMode,
  allowedActivityIds: unknown
): GameConfig[] {
  if (mode !== 'selected') return GAMES;
  const allowed = new Set(normalizeAllowedActivityIds(allowedActivityIds));
  return GAMES.filter((game) => allowed.has(game.id));
}
