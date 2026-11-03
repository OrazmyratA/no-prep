import { GameFinishRanking } from '../../shared/game-finish-overlay';

export const MAX_TEAMS = 3;
export const TEAM_COLORS = ['#ef4444', '#3b82f6', '#22c55e'];

export const MEDALS = ['🥇', '🥈', '🥉'];

export function clampTeamCount(value: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.min(MAX_TEAMS, Math.max(1, Math.round(value)));
}

export interface TeamFinish {
  team: number;
  /** 1 for the first team to finish, and so on. */
  place: number | null;
  stars: number;
}

/** Teams that play at their own speed are ranked by who finished first; stars don't change it. */
export function finishOrderRankings(teams: TeamFinish[], teamName: (team: number) => string): GameFinishRanking[] {
  return [...teams]
    .sort((a, b) => (a.place ?? 0) - (b.place ?? 0))
    .map(({ team, place, stars }) => ({
      position: place ?? undefined,
      medal: MEDALS[(place ?? 1) - 1],
      name: teamName(team),
      score: `⭐ ${stars}`,
      color: TEAM_COLORS[team]
    }));
}
