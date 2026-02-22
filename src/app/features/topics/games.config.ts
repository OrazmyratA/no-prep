// src/app/features/topics/games.config.ts
export interface GameConfig {
  id: string;
  name: string;
  icon: string;
  requiresSettings: boolean;
  description: string;
}

export const GAMES: GameConfig[] = [
  {
    id: 'spin-wheel',
    name: 'Spin the Wheel',
    icon: '\u{1F3A1}',
    requiresSettings: false,
    description: 'Spin to land on an item. Eliminate segments and continue.'
  },
  {
    id: 'reveal-game',
    name: 'Reveal Game',
    icon: '\u{1F50D}',
    requiresSettings: true,
    description: 'Image covered by squares that disappear over time.'
  },
  {
    id: 'match-pairs',
    name: 'Match the Pairs',
    icon: '\u{1F0CF}',
    requiresSettings: false,
    description: 'Find matching pairs of cards.'
  },
  {
    id: 'flip-tiles',
    name: 'Flip Tiles',
    icon: '\u{1F504}',
    requiresSettings: false,
    description: 'Flip cards to explore items.'
  },
  {
    id: 'watch-memorize',
    name: 'Watch & Memorize',
    icon: '\u{1F440}',
    requiresSettings: true,
    description: 'Watch items scroll, then recall them.'
  },
  {
    id: 'anagram',
    name: 'Anagram',
    icon: '\u{1F524}',
    requiresSettings: true,
    description: 'Unscramble the letters to form the word.'
  },
  {
    id: 'unjumble',
    name: 'Unjumble',
    icon: '\u{1F4DD}',
    requiresSettings: true,
    description: 'Unscramble the words.'
  },
  {
    id: 'word-search',
    name: 'Word Search',
    icon: '\u{1F50E}',
    requiresSettings: false,
    description: 'Find words in the grid.'
  }
];
