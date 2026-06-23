import { GAMES } from '../games.config';
import {
  filterGamesByActivityRestriction,
  normalizeAllowedActivityIds
} from './activity-restriction';

describe('book activity restrictions', () => {
  it('keeps all activities for existing and unrestricted book markers', () => {
    expect(filterGamesByActivityRestriction('all', [])).toEqual(GAMES);
  });

  it('shows only selected activities in canonical display order', () => {
    const games = filterGamesByActivityRestriction('selected', ['spin-wheel', 'flip-tiles']);
    expect(games.map((game) => game.id)).toEqual(['flip-tiles', 'spin-wheel']);
  });

  it('removes duplicates and unknown activity ids', () => {
    expect(normalizeAllowedActivityIds('anagram,unknown,anagram,match-pairs')).toEqual([
      'match-pairs',
      'anagram'
    ]);
  });

  it('fails closed when selected mode contains no valid activities', () => {
    expect(filterGamesByActivityRestriction('selected', ['unknown'])).toEqual([]);
  });
});
