import {
  CHALLENGE_OUTCOME,
  RESULT_STATUS,
  canResolveChallengeResult,
  canTeamReportChallengeResult,
  getChallengeResolveOptions,
  outcomeToResultStatus,
  resolveChallengePerspective,
} from '../features/equipos/utils/challengeResult';

const baseChallenge = {
  id: 'challenge-1',
  created_by_user_id: 'creator-user',
  challenger_team_id: 'team-a',
  accepted_team_id: 'team-b',
  challenger_team: { id: 'team-a', name: 'Napoli' },
  accepted_team: { id: 'team-b', name: 'Bico' },
};

describe('challenge result reporting permissions (captain scope)', () => {
  // Tests 5 & 6: a captain only reports from their own team's perspective, so the
  // outcome can never map to the rival's win.
  test('a team A captain reports from the challenger perspective only', () => {
    const perspective = resolveChallengePerspective({
      challenge: baseChallenge,
      manageableTeamIds: ['team-a'],
      userId: 'captain-a',
    });
    expect(perspective.myTeamId).toBe('team-a');
    expect(perspective.perspectiveIsChallenger).toBe(true);
    expect(perspective.canIdentifyTeam).toBe(true);
    expect(outcomeToResultStatus(CHALLENGE_OUTCOME.WON, perspective)).toBe(RESULT_STATUS.TEAM_A_WIN);
    expect(outcomeToResultStatus(CHALLENGE_OUTCOME.LOST, perspective)).toBe(RESULT_STATUS.TEAM_B_WIN);
  });

  test('a team B captain reports from the accepted perspective only', () => {
    const perspective = resolveChallengePerspective({
      challenge: baseChallenge,
      manageableTeamIds: ['team-b'],
      userId: 'captain-b',
    });
    expect(perspective.myTeamId).toBe('team-b');
    expect(perspective.perspectiveIsChallenger).toBe(false);
    expect(outcomeToResultStatus(CHALLENGE_OUTCOME.WON, perspective)).toBe(RESULT_STATUS.TEAM_B_WIN);
  });

  test('the rival team can still report while a result is provisional', () => {
    const provisionalMatch = {
      result_status: RESULT_STATUS.TEAM_B_WIN,
      result_confirmed: false,
      result_conflict: false,
      result_reported_by_team_id: 'team-b',
    };
    expect(canTeamReportChallengeResult(provisionalMatch, 'team-a')).toBe(true);
  });

  test('a team cannot overwrite its own provisional report', () => {
    const provisionalMatch = {
      result_status: RESULT_STATUS.TEAM_B_WIN,
      result_confirmed: false,
      result_conflict: false,
      result_reported_by_team_id: 'team-b',
    };
    expect(canTeamReportChallengeResult(provisionalMatch, 'team-b')).toBe(false);
  });

  test('nobody can report once the result is confirmed or in conflict', () => {
    expect(canTeamReportChallengeResult({
      result_status: RESULT_STATUS.TEAM_A_WIN,
      result_confirmed: true,
    }, 'team-a')).toBe(false);
    expect(canTeamReportChallengeResult({
      result_conflict: true,
      result_status: null,
    }, 'team-a')).toBe(false);
  });
});

describe('challenge conflict resolution permissions (creator only)', () => {
  const conflictMatch = { result_conflict: true, result_status: null };

  // Test 13: the challenge creator can resolve an active conflict.
  test('the challenge creator can resolve an active conflict', () => {
    expect(canResolveChallengeResult(conflictMatch, {
      userId: 'creator-user',
      challengeCreatorUserId: 'creator-user',
    })).toBe(true);
  });

  // Test 14: anyone who is not the creator cannot resolve.
  test('a non-creator (captain/admin/player) cannot resolve a conflict', () => {
    expect(canResolveChallengeResult(conflictMatch, {
      userId: 'captain-a',
      challengeCreatorUserId: 'creator-user',
    })).toBe(false);
  });

  test('the creator cannot resolve when there is no active conflict', () => {
    expect(canResolveChallengeResult({ result_conflict: false }, {
      userId: 'creator-user',
      challengeCreatorUserId: 'creator-user',
    })).toBe(false);
  });

  test('missing identities never grant resolution', () => {
    expect(canResolveChallengeResult(conflictMatch, { userId: null, challengeCreatorUserId: null })).toBe(false);
    expect(canResolveChallengeResult(conflictMatch, {})).toBe(false);
  });
});

describe('conflict resolution options are absolute (neutral)', () => {
  test('maps team names to absolute result_status values', () => {
    const options = getChallengeResolveOptions({ teamAName: 'Napoli', teamBName: 'Bico' });
    expect(options).toEqual([
      { value: RESULT_STATUS.TEAM_A_WIN, label: 'Ganó Napoli' },
      { value: RESULT_STATUS.DRAW, label: 'Empataron' },
      { value: RESULT_STATUS.TEAM_B_WIN, label: 'Ganó Bico' },
    ]);
  });

  test('falls back to generic labels when names are missing', () => {
    const options = getChallengeResolveOptions({});
    expect(options.map((option) => option.label)).toEqual(['Ganó Equipo A', 'Empataron', 'Ganó Equipo B']);
  });
});
