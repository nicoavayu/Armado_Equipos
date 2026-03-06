import {
  resolveChallengeSquadLimits,
  resolveTeamRosterLimit,
  TEAM_FORMAT_OPTIONS,
} from '../features/equipos/config';

describe('team format limits', () => {
  test('resolves roster limits as format x2', () => {
    expect(resolveTeamRosterLimit(5)).toBe(10);
    expect(resolveTeamRosterLimit(6)).toBe(12);
    expect(resolveTeamRosterLimit(7)).toBe(14);
    expect(resolveTeamRosterLimit(8)).toBe(16);
    expect(resolveTeamRosterLimit(9)).toBe(18);
    expect(resolveTeamRosterLimit(11)).toBe(22);
  });

  test('prefers persisted roster limit when provided', () => {
    expect(resolveTeamRosterLimit(5, 13)).toBe(13);
  });

  test('resolves challenge squad limits by format', () => {
    expect(resolveChallengeSquadLimits(5)).toEqual({ starters: 5, substitutes: 3, selected: 8 });
    expect(resolveChallengeSquadLimits(6)).toEqual({ starters: 6, substitutes: 3, selected: 9 });
    expect(resolveChallengeSquadLimits(7)).toEqual({ starters: 7, substitutes: 4, selected: 11 });
    expect(resolveChallengeSquadLimits(8)).toEqual({ starters: 8, substitutes: 4, selected: 12 });
    expect(resolveChallengeSquadLimits(9)).toEqual({ starters: 9, substitutes: 4, selected: 13 });
    expect(resolveChallengeSquadLimits(11)).toEqual({ starters: 11, substitutes: 5, selected: 16 });
  });

  test('supports the expected challenge formats', () => {
    expect(TEAM_FORMAT_OPTIONS).toEqual([5, 6, 7, 8, 9, 11]);
  });
});
