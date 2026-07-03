const TEAM_KEY_LAYOUTS: Record<number, readonly string[]> = {
  1: ['a'],
  2: ['a', 'l'],
  3: ['a', 'g', 'l'],
  4: ['a', 'd', 'j', 'l'],
  5: ['a', 'd', 'g', 'j', 'l'],
  6: ['a', 's', 'd', 'j', 'k', 'l'],
};

export function getTeamKeyboardKeys(teamCount: number): readonly string[] {
  const safeCount = Math.max(1, Math.min(6, Math.round(teamCount) || 1));
  return TEAM_KEY_LAYOUTS[safeCount];
}

export function getTeamIndexForKey(key: string, teamCount: number): number {
  return getTeamKeyboardKeys(teamCount).indexOf(key.toLowerCase());
}

export function teamKeyboardShortcutLabel(teamCount: number): string {
  return getTeamKeyboardKeys(teamCount).map(key => key.toUpperCase()).join(' / ');
}
