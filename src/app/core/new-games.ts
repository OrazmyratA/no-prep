// "NEW" on newly added games in the games list, so teachers notice what an update brought. A game
// is new for NEW_GAME_DAYS after its `newSince` date (games.config.ts) until it is first started
// on this device. Per device on purpose: nothing to sync, and a fresh install sees it too.

const PLAYED_KEY = 'np-played-games';
export const NEW_GAME_DAYS = 60;
const DAY_MS = 24 * 60 * 60 * 1000;

function playedGames(): string[] {
  try {
    const raw = JSON.parse(localStorage.getItem(PLAYED_KEY) || '[]');
    return Array.isArray(raw) ? raw.filter((id): id is string => typeof id === 'string') : [];
  } catch {
    return [];
  }
}

/** Whether to show "NEW" on this game. `newSince` is an ISO date (yyyy-mm-dd). */
export function isNewGame(game: { id: string; newSince?: string }, now: Date = new Date()): boolean {
  if (!game.newSince) return false;
  const since = Date.parse(game.newSince);
  if (Number.isNaN(since) || now.getTime() - since > NEW_GAME_DAYS * DAY_MS) return false;
  return !playedGames().includes(game.id);
}

/** The teacher started this game: it is not new any more on this device. */
export function markGamePlayed(id: string): void {
  const played = playedGames();
  if (played.includes(id)) return;
  try {
    localStorage.setItem(PLAYED_KEY, JSON.stringify([...played, id]));
  } catch {
    // Storage unavailable: the badge just stays until it expires.
  }
}
