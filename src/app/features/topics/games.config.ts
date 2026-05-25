// src/app/features/topics/games.config.ts
export interface GameConfig {
  id: string;
  nameKey: string;        // translation key for game name
  descKey: string;        // translation key for description
  icon: string;
  requiresSettings: boolean;
  // For backward compatibility, we can keep name/description but they will not be used in template.
  name?: string;
  description?: string;
}

export const GAMES: GameConfig[] = [
    {
    id: 'flip-tiles',
    nameKey: 'gameFlipTilesName',
    descKey: 'gameFlipTilesDesc',
    icon: '\u{1F504}',
    requiresSettings: false,
  },
    {
    id: 'match-pairs',
    nameKey: 'gameMatchPairsName',
    descKey: 'gameMatchPairsDesc',
    icon: '\u{1F0CF}',
    requiresSettings: false,
  },
    {
    id: 'watch-memorize',
    nameKey: 'gameWatchMemorizeName',
    descKey: 'gameWatchMemorizeDesc',
    icon: '\u{1F440}',
    requiresSettings: true,
  },
  {
    id: 'spotlight',
    nameKey: 'gameSpotlightName',
    descKey: 'gameSpotlightDesc',
    icon: '\u{1F56F}',
    requiresSettings: true,
  },
  {
    id: 'spin-wheel',
    nameKey: 'gameSpinWheelName',
    descKey: 'gameSpinWheelDesc',
    icon: '\u{1F3A1}',
    requiresSettings: true,
  },
  {
    id: 'reveal-game',
    nameKey: 'gameRevealGameName',
    descKey: 'gameRevealGameDesc',
    icon: '\u{1F9E9}',
    requiresSettings: true,
  },
    {
    id: 'pop-balloon',
    nameKey: 'gamePopBalloonName',
    descKey: 'gamePopBalloonDesc',
    icon: '\u{1F388}',
    requiresSettings: true,
  },
    {
    id: 'test-abc',
    nameKey: 'gameTestAbcName',
    descKey: 'gameTestAbcDesc',
    icon: '\u{2611}',
    requiresSettings: true,
  },
  {
    id: 'anagram',
    nameKey: 'gameAnagramName',
    descKey: 'gameAnagramDesc',
    icon: '\u{1F524}',
    requiresSettings: false,
  },
  {
    id: 'word-search',
    nameKey: 'gameWordSearchName',
    descKey: 'gameWordSearchDesc',
    icon: '\u{1F50E}',
    requiresSettings: false,
  },
  {
    id: 'unjumble',
    nameKey: 'gameUnjumbleName',
    descKey: 'gameUnjumbleDesc',
    icon: '\u{1F4DD}',
    requiresSettings: false,
  },
  {
    id: 'team-tug',
    nameKey: 'gameTeamTugName',
    descKey: 'gameTeamTugDesc',
    icon: '🤼',
    requiresSettings: true,
  },
  {
    id: 'spelling-check',
    nameKey: 'gameSpellingCheckName',
    descKey: 'gameSpellingCheckDesc',
    icon: '\u{1F4DD}',
    requiresSettings: true,
  },
  {
    id: 'cup-clash',
    nameKey: 'gameCupClashName',
    descKey: 'gameCupClashDesc',
    icon: '\u{1F964}',
    requiresSettings: true,
  },
  {
    id: 'odd-one-out',
    nameKey: 'gameOddOneOutName',
    descKey: 'gameOddOneOutDesc',
    icon: '\u{1F53A}',
    requiresSettings: true,
  },
  {
    id: 'team-sentence',
    nameKey: 'gameTeamSentenceName',
    descKey: 'gameTeamSentenceDesc',
    icon: '\u{1F3A3}',
    requiresSettings: true,
  }
];
