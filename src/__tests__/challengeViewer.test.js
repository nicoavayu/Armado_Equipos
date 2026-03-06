import { getViewerChallengeTeam } from '../features/equipos/utils/challengeViewer';

describe('getViewerChallengeTeam', () => {
  const baseMatch = {
    team_a_id: 'team-a',
    team_b_id: 'team-b',
    team_a: { id: 'team-a', name: 'Equipo A', owner_user_id: 'owner-a' },
    team_b: { id: 'team-b', name: 'Equipo B', owner_user_id: 'owner-b' },
  };

  test('resolves my team from members', () => {
    const result = getViewerChallengeTeam({
      match: baseMatch,
      userId: 'user-1',
      teamMembersByTeamId: {
        'team-a': [{ user_id: 'user-1' }],
        'team-b': [{ user_id: 'user-2' }],
      },
      challengeSquadDisplayByTeamId: {},
    });

    expect(result.isParticipant).toBe(true);
    expect(result.myTeamId).toBe('team-a');
    expect(result.rivalTeamId).toBe('team-b');
  });

  test('resolves my team from owner', () => {
    const result = getViewerChallengeTeam({
      match: baseMatch,
      userId: 'owner-b',
      teamMembersByTeamId: {
        'team-a': [],
        'team-b': [],
      },
      challengeSquadDisplayByTeamId: {},
    });

    expect(result.isParticipant).toBe(true);
    expect(result.myTeamId).toBe('team-b');
    expect(result.rivalTeamId).toBe('team-a');
  });

  test('returns non participant when user is outside both teams', () => {
    const result = getViewerChallengeTeam({
      match: baseMatch,
      userId: 'outsider',
      teamMembersByTeamId: {
        'team-a': [{ user_id: 'user-1' }],
        'team-b': [{ user_id: 'user-2' }],
      },
      challengeSquadDisplayByTeamId: {},
    });

    expect(result.isParticipant).toBe(false);
    expect(result.myTeamId).toBeNull();
    expect(result.rivalTeamId).toBeNull();
  });

  test('returns ambiguous when user appears in both teams and is not owner', () => {
    const result = getViewerChallengeTeam({
      match: baseMatch,
      userId: 'shared-user',
      teamMembersByTeamId: {
        'team-a': [{ user_id: 'shared-user' }],
        'team-b': [{ user_id: 'shared-user' }],
      },
      challengeSquadDisplayByTeamId: {},
    });

    expect(result.isParticipant).toBe(true);
    expect(result.isAmbiguous).toBe(true);
    expect(result.myTeamId).toBeNull();
  });
});

