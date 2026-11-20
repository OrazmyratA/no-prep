import { isNewGame, markGamePlayed, NEW_GAME_DAYS } from './new-games';

describe('new-games', () => {
  beforeEach(() => localStorage.removeItem('np-played-games'));
  afterEach(() => localStorage.removeItem('np-played-games'));

  const game = { id: 'story-talk', newSince: '2026-11-20' };
  const day = (n: number) => new Date(Date.parse('2026-11-20') + n * 24 * 60 * 60 * 1000);

  it('is new after its release until it is played', () => {
    expect(isNewGame(game, day(1))).toBe(true);
    markGamePlayed('story-talk');
    expect(isNewGame(game, day(1))).toBe(false);
    expect(isNewGame({ id: 'puzzle-builder', newSince: '2026-11-20' }, day(1))).toBe(true);
  });

  it('stops being new after a while, and older games never are', () => {
    expect(isNewGame(game, day(NEW_GAME_DAYS - 1))).toBe(true);
    expect(isNewGame(game, day(NEW_GAME_DAYS + 1))).toBe(false);
    expect(isNewGame({ id: 'anagram' }, day(1))).toBe(false);
    expect(isNewGame({ id: 'x', newSince: 'soon' }, day(1))).toBe(false);
  });

  it('survives broken storage', () => {
    localStorage.setItem('np-played-games', '{oops');
    expect(isNewGame(game, day(1))).toBe(true);
    markGamePlayed('story-talk');
    expect(isNewGame(game, day(1))).toBe(false);
  });
});
