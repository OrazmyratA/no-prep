import { clampTeamCount, finishOrderRankings } from './team-results';

describe('team results', () => {
  it('keeps the team count between 1 and 3', () => {
    expect([clampTeamCount(0), clampTeamCount(2), clampTeamCount(9), clampTeamCount(NaN)]).toEqual([1, 2, 3, 1]);
  });

  it('ranks by finishing order, whatever the stars say', () => {
    const ranking = finishOrderRankings(
      [{ team: 0, place: 2, stars: 5 }, { team: 1, place: 1, stars: 1 }, { team: 2, place: 3, stars: 3 }],
      team => `Team ${team + 1}`
    );
    expect(ranking.map(row => row.name)).toEqual(['Team 2', 'Team 1', 'Team 3']);
    expect(ranking.map(row => row.medal)).toEqual(['🥇', '🥈', '🥉']);
    expect(ranking.map(row => row.score)).toEqual(['⭐ 1', '⭐ 5', '⭐ 3']);
  });
});
