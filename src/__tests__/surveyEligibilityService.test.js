jest.mock('../services/db/teamChallenges', () => ({
  listChallengeApprovedSquad: jest.fn(async () => ({ byTeamId: {} })),
  listTeamMatchMembers: jest.fn(async () => ({})),
}));

const {
  resolveChallengeSurveyEligibleUsers,
} = require('../services/surveyEligibilityService');
const {
  SURVEY_CHALLENGE_DISABLED_REASON,
} = require('../utils/surveyChallengePolicy');

describe('survey challenge eligibility', () => {
  test('non-challenge fallback excludes substitutes from the effective survey roster', async () => {
    const eligibility = await resolveChallengeSurveyEligibleUsers({
      matchId: 12,
      rosterRows: [
        { id: 1, usuario_id: 'u1', uuid: 'u1', nombre: 'Titular Uno', is_substitute: false },
        { id: 2, usuario_id: 'u2', uuid: 'u2', nombre: 'Titular Dos', is_substitute: false },
        { id: 3, usuario_id: 'u3', uuid: 'u3', nombre: 'Suplente Tres', is_substitute: true },
      ],
      teamMatchRow: null,
      matchRow: null,
      confirmationRow: null,
    });

    expect(eligibility.source).toBe('starter_roster');
    expect(Array.from(eligibility.eligibleUserIds).sort()).toEqual(['u1', 'u2']);
    expect(eligibility.excludeSubstitutesByDefault).toBe(true);
  });

  test('non-challenge confirmed participants can include a substitute who actually entered the match', async () => {
    const eligibility = await resolveChallengeSurveyEligibleUsers({
      matchId: 13,
      rosterRows: [
        { id: 1, usuario_id: 'u1', uuid: 'u1', nombre: 'Titular Uno', is_substitute: false },
        { id: 2, usuario_id: 'u2', uuid: 'u2', nombre: 'Titular Dos', is_substitute: false },
        { id: 3, usuario_id: 'u3', uuid: 'u3', nombre: 'Suplente Tres', is_substitute: true },
      ],
      teamMatchRow: null,
      matchRow: null,
      confirmationRow: {
        participants: [
          { user_id: 'u1', jugador: { usuario_id: 'u1', uuid: 'u1', nombre: 'Titular Uno' } },
          { user_id: 'u3', jugador: { usuario_id: 'u3', uuid: 'u3', nombre: 'Suplente Tres' } },
        ],
        team_a: ['u1'],
        team_b: ['u3'],
      },
    });

    expect(eligibility.source).toBe('confirmed_participants');
    expect(Array.from(eligibility.eligibleUserIds).sort()).toEqual(['u1', 'u3']);
    expect(eligibility.excludeSubstitutesByDefault).toBe(false);
  });

  test('non-challenge persisted effective teams exclude substitutes that never entered', async () => {
    const eligibility = await resolveChallengeSurveyEligibleUsers({
      matchId: 14,
      rosterRows: [
        { id: 1, usuario_id: 'u1', uuid: 'u1', nombre: 'Titular Uno', is_substitute: false },
        { id: 2, usuario_id: 'u2', uuid: 'u2', nombre: 'Titular Dos', is_substitute: false },
        { id: 3, usuario_id: 'u3', uuid: 'u3', nombre: 'Suplente Tres', is_substitute: true },
      ],
      teamMatchRow: null,
      matchRow: {
        equipos_json: [
          { players: ['u1'] },
          { players: ['u2'] },
        ],
      },
      confirmationRow: null,
    });

    expect(eligibility.source).toBe('persisted_match_roster');
    expect(Array.from(eligibility.eligibleUserIds).sort()).toEqual(['u1', 'u2']);
    expect(eligibility.excludeSubstitutesByDefault).toBe(false);
  });

  test('challenge/team_match rows are not survey eligible even with approved squad data', async () => {
    const eligibility = await resolveChallengeSurveyEligibleUsers({
      matchId: 55,
      rosterRows: [
        { id: 1, usuario_id: 'u1', uuid: 'u1', nombre: 'Uno' },
        { id: 2, usuario_id: 'u2', uuid: 'u2', nombre: 'Dos' },
        { id: 3, usuario_id: 'u3', uuid: 'u3', nombre: 'Tres' },
      ],
      teamMatchRow: {
        id: 55,
        origin_type: 'challenge',
        challenge_id: 'c1',
        team_a_id: 'ta',
        team_b_id: 'tb',
      },
      approvedByTeamId: {
        ta: [{ user_id: 'u1', jugador: { usuario_id: 'u1' } }],
        tb: [{ user_id: 'u2', jugador: { usuario_id: 'u2' } }],
      },
      membersByTeamId: {
        ta: [{ user_id: 'u1' }],
        tb: [{ user_id: 'u2' }, { user_id: 'u3' }],
      },
    });

    expect(eligibility.source).toBe(SURVEY_CHALLENGE_DISABLED_REASON);
    expect(eligibility.reason).toBe(SURVEY_CHALLENGE_DISABLED_REASON);
    expect(eligibility.disabledForChallenge).toBe(true);
    expect(Array.from(eligibility.eligibleUserIds)).toEqual([]);
  });

  test('challenge/team_match rows ignore persisted survey teams', async () => {
    const eligibility = await resolveChallengeSurveyEligibleUsers({
      matchId: 99,
      rosterRows: [
        { id: 10, usuario_id: 'u10', uuid: 'u10', nombre: 'Diez' },
        { id: 11, usuario_id: 'u11', uuid: 'u11', nombre: 'Once' },
        { id: 12, usuario_id: 'u12', uuid: 'u12', nombre: 'Doce' },
      ],
      teamMatchRow: {
        id: 99,
        origin_type: 'challenge',
        challenge_id: 'c9',
        team_a_id: 'ta',
        team_b_id: 'tb',
      },
      matchRow: {
        survey_team_a: ['u10'],
        survey_team_b: ['u11'],
        final_team_a: [],
        final_team_b: [],
      },
    });

    expect(eligibility.source).toBe(SURVEY_CHALLENGE_DISABLED_REASON);
    expect(eligibility.reason).toBe(SURVEY_CHALLENGE_DISABLED_REASON);
    expect(eligibility.disabledForChallenge).toBe(true);
    expect(Array.from(eligibility.eligibleUserIds)).toEqual([]);
  });
});
