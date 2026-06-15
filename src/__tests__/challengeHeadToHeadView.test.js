import { buildChallengeHeadToHeadView } from '../features/equipos/utils/challengeHeadToHead';

const TEAM_A = 'team-a';
const TEAM_B = 'team-b';

describe('buildChallengeHeadToHeadView', () => {
  test('no loaded results: shows only the played count, never invented wins/losses', () => {
    const view = buildChallengeHeadToHeadView({
      stats: {
        totalEncounters: 1,
        totalMatchesPlayed: 0,
        winsTeamA: 0,
        winsTeamB: 0,
        draws: 0,
      },
      teamAId: TEAM_A,
      teamBId: TEAM_B,
      currentUserTeamId: TEAM_A,
      teamAName: 'Tigres',
      teamBName: 'Leones',
    });

    expect(view.hasPlayedHistory).toBe(false);
    expect(view.playedCount).toBe(0);
    expect(view.emptyStateText).toBe('Partidos jugados contra este rival: 0');
    // Even though wins/losses are 0, the empty-state path must be taken so the
    // UI never renders a misleading "0G · 0E · 0P" history.
  });

  test('first ever encounter with nothing scheduled shows "Primera vez"', () => {
    const view = buildChallengeHeadToHeadView({
      stats: {
        totalEncounters: 0,
        totalMatchesPlayed: 0,
        winsTeamA: 0,
        winsTeamB: 0,
        draws: 0,
      },
      teamAId: TEAM_A,
      teamBId: TEAM_B,
      currentUserTeamId: TEAM_A,
    });

    expect(view.hasPlayedHistory).toBe(false);
    expect(view.emptyStateText).toBe('Primera vez que se enfrentan');
  });

  test('with loaded results: shows real wins/draws/losses from the challenger perspective', () => {
    const view = buildChallengeHeadToHeadView({
      stats: {
        totalEncounters: 4,
        totalMatchesPlayed: 3,
        winsTeamA: 2,
        winsTeamB: 1,
        draws: 0,
        lastWinnerTeamId: TEAM_A,
        lastResultStatus: 'team_a_win',
        lastResultAt: '2026-05-01T20:00:00Z',
      },
      teamAId: TEAM_A,
      teamBId: TEAM_B,
      currentUserTeamId: TEAM_A,
      teamAName: 'Tigres',
      teamBName: 'Leones',
    });

    expect(view.hasPlayedHistory).toBe(true);
    expect(view.playedCount).toBe(3);
    expect(view.wins).toBe(2);
    expect(view.losses).toBe(1);
    expect(view.draws).toBe(0);
    expect(view.historialValue).toBe('2G · 0E · 1P');
    expect(view.lastWinnerText).toBe('Tigres');
    expect(view.emptyStateText).toBeNull();
  });

  test('perspective flips wins/losses for the rival team', () => {
    const view = buildChallengeHeadToHeadView({
      stats: {
        totalEncounters: 3,
        totalMatchesPlayed: 3,
        winsTeamA: 2,
        winsTeamB: 1,
        draws: 0,
      },
      teamAId: TEAM_A,
      teamBId: TEAM_B,
      currentUserTeamId: TEAM_B,
    });

    expect(view.wins).toBe(1);
    expect(view.losses).toBe(2);
  });

  test('draw as last result is labelled "Empate"', () => {
    const view = buildChallengeHeadToHeadView({
      stats: {
        totalEncounters: 1,
        totalMatchesPlayed: 1,
        winsTeamA: 0,
        winsTeamB: 0,
        draws: 1,
        lastResultStatus: 'draw',
        lastWinnerTeamId: null,
      },
      teamAId: TEAM_A,
      teamBId: TEAM_B,
      currentUserTeamId: TEAM_A,
    });

    expect(view.hasPlayedHistory).toBe(true);
    expect(view.draws).toBe(1);
    expect(view.lastWinnerText).toBe('Empate');
  });
});
