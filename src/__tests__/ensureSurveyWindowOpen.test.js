jest.mock('../config/surveyConfig', () => ({
  SURVEY_FINALIZE_DELAY_MS: 24 * 60 * 60 * 1000,
  SURVEY_START_DELAY_MS: 60 * 60 * 1000,
  SURVEY_MIN_VOTERS_FOR_AWARDS: 3,
  SURVEY_MIN_VOTERS_IMMEDIATE_FINALIZE: 3,
}));

const mockFrom = jest.fn();
const mockRpc = jest.fn();

jest.mock('../supabase', () => ({
  supabase: {
    from: (...args) => mockFrom(...args),
    rpc: (...args) => mockRpc(...args),
  },
}));

jest.mock('../api/supabaseWrapper', () => ({
  db: {
    fetchMany: jest.fn(async () => []),
  },
}));

jest.mock('../services/db/awards', () => ({
  grantAwardsForMatch: jest.fn(async () => ({ ok: true })),
}));

jest.mock('../services/db/penalties', () => ({
  ensureNoShowRanking: jest.fn(async () => ({ error: null })),
}));

jest.mock('../services/historySnapshotService', () => ({
  ensureParticipantsSnapshot: jest.fn(async () => null),
  ensureSurveyResultsSnapshot: jest.fn(async () => null),
}));

jest.mock('../services/db/userIdentity', () => ({
  resolveStablePlayerRef: jest.fn(async () => null),
}));

jest.mock('../services/db/teamChallenges', () => ({
  listChallengeApprovedSquad: jest.fn(async () => ({ byTeamId: {} })),
  listTeamMatchMembers: jest.fn(async () => ({})),
}));

const { listChallengeApprovedSquad } = require('../services/db/teamChallenges');
const { ensureSurveyWindowOpen } = require('../services/surveyCompletionService');

const buildSupabaseFromMock = ({
  rosterRows = [],
  lifecycleRow = null,
  rosterContextRow = null,
  teamMatchRow = null,
  confirmationRow = null,
  surveyRows = [],
  updateCalls = [],
}) => (table) => {
  if (table === 'jugadores') {
    return {
      select: jest.fn(() => ({
        eq: jest.fn(async () => ({ data: rosterRows, error: null })),
      })),
    };
  }

  if (table === 'partidos') {
    const chain = {
      eq: jest.fn(() => chain),
      neq: jest.fn(async () => ({ data: null, error: null })),
      lt: jest.fn(async () => ({ data: null, error: null })),
    };

    return {
      select: jest.fn((columns) => ({
        eq: jest.fn(() => ({
          maybeSingle: jest.fn(async () => ({
            data: String(columns || '').includes('equipos_json')
              ? (rosterContextRow || lifecycleRow)
              : lifecycleRow,
            error: null,
          })),
        })),
      })),
      update: jest.fn((payload) => {
        updateCalls.push(payload);
        return chain;
      }),
    };
  }

  if (table === 'team_matches') {
    return {
      select: jest.fn(() => ({
        eq: jest.fn(() => ({
          maybeSingle: jest.fn(async () => ({ data: teamMatchRow, error: null })),
        })),
      })),
    };
  }

  if (table === 'post_match_surveys') {
    return {
      select: jest.fn(() => ({
        eq: jest.fn(async () => ({ data: surveyRows, error: null })),
      })),
    };
  }

  if (table === 'partido_team_confirmations') {
    return {
      select: jest.fn(() => ({
        eq: jest.fn(() => ({
          maybeSingle: jest.fn(async () => ({ data: confirmationRow, error: null })),
        })),
      })),
    };
  }

  throw new Error(`Unexpected table in mock: ${table}`);
};

describe('ensureSurveyWindowOpen', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-03-18T03:00:00.000Z'));
    mockFrom.mockReset();
    mockRpc.mockReset();
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test('recalculates and persists stale survey window from kickoff date/time', async () => {
    const lifecycleRow = {
      survey_status: 'open',
      survey_opened_at: '2026-03-13T02:12:35.170Z',
      survey_closes_at: '2026-03-14T02:12:35.170Z',
      survey_expected_voters: 1,
      result_status: 'pending',
      winner_team: null,
      finished_at: null,
      fecha: '2026-03-17',
      hora: '22:00',
    };

    const updateCalls = [];
    mockFrom.mockImplementation(buildSupabaseFromMock({
      rosterRows: [
        { id: 1, usuario_id: 'u1' },
        { id: 2, usuario_id: 'u2' },
      ],
      lifecycleRow,
      teamMatchRow: null,
      surveyRows: [],
      updateCalls,
    }));

    const result = await ensureSurveyWindowOpen(101, {
      nowIso: '2026-03-18T03:00:00.000Z',
    });

    const expectedOpenedAt = '2026-03-18T02:00:00.000Z';
    const expectedClosesAt = '2026-03-19T02:00:00.000Z';

    expect(result.openedAt).toBe(expectedOpenedAt);
    expect(result.closesAt).toBe(expectedClosesAt);
    expect(result.deadlineReached).toBe(false);
    expect(result.expectedVoters).toBe(2);

    expect(updateCalls.length).toBe(1);
    expect(updateCalls[0]).toMatchObject({
      survey_status: 'open',
      survey_opened_at: expectedOpenedAt,
      survey_closes_at: expectedClosesAt,
      survey_expected_voters: 2,
    });
  });

  test('anchors to team_matches.scheduled_at when partido fecha/hora is missing', async () => {
    const lifecycleRow = {
      survey_status: 'open',
      survey_opened_at: null,
      survey_closes_at: null,
      survey_expected_voters: 0,
      result_status: 'pending',
      winner_team: null,
      finished_at: null,
      fecha: null,
      hora: null,
    };

    const updateCalls = [];
    mockFrom.mockImplementation(buildSupabaseFromMock({
      rosterRows: [{ id: 7, usuario_id: 'u7' }],
      lifecycleRow,
      teamMatchRow: { scheduled_at: '2026-03-20T01:00:00.000Z' },
      surveyRows: [],
      updateCalls,
    }));

    const result = await ensureSurveyWindowOpen(202, {
      nowIso: '2026-03-18T03:00:00.000Z',
    });

    expect(result.openedAt).toBe('2026-03-20T02:00:00.000Z');
    expect(result.closesAt).toBe('2026-03-21T02:00:00.000Z');
    expect(result.expectedVoters).toBe(1);

    expect(updateCalls.length).toBe(1);
    expect(updateCalls[0].survey_opened_at).toBe('2026-03-20T02:00:00.000Z');
    expect(updateCalls[0].survey_closes_at).toBe('2026-03-21T02:00:00.000Z');
  });

  test('uses scheduled_at as zero-delay survey opening for challenge matches and counts logged substitutes', async () => {
    const lifecycleRow = {
      survey_status: 'open',
      survey_opened_at: '2026-03-30T01:19:00.000Z',
      survey_closes_at: '2026-03-31T01:19:00.000Z',
      survey_expected_voters: 0,
      result_status: 'pending',
      winner_team: null,
      finished_at: '2026-03-30T01:19:00.000Z',
      fecha: '2026-03-29',
      hora: '22:19',
    };

    listChallengeApprovedSquad.mockResolvedValueOnce({
      byTeamId: {
        ta: [
          { user_id: 'u1', jugador: { usuario_id: 'u1' } },
          { user_id: 'u3', jugador: { usuario_id: 'u3' } },
        ],
        tb: [{ user_id: 'u2', jugador: { usuario_id: 'u2' } }],
      },
    });

    const updateCalls = [];
    mockFrom.mockImplementation(buildSupabaseFromMock({
      rosterRows: [
        { id: 1, usuario_id: 'u1', is_substitute: false },
        { id: 2, usuario_id: 'u2', is_substitute: false },
        { id: 3, usuario_id: 'u3', is_substitute: true },
      ],
      lifecycleRow,
      rosterContextRow: lifecycleRow,
      teamMatchRow: {
        id: 'tm-477',
        origin_type: 'challenge',
        challenge_id: 'c-477',
        team_a_id: 'ta',
        team_b_id: 'tb',
        scheduled_at: '2026-03-30T01:19:00.000Z',
      },
      surveyRows: [],
      updateCalls,
    }));

    const result = await ensureSurveyWindowOpen(477, {
      nowIso: '2026-03-30T01:20:00.000Z',
    });

    expect(result.openedAt).toBe('2026-03-30T01:19:00.000Z');
    expect(result.closesAt).toBe('2026-03-31T01:19:00.000Z');
    expect(result.expectedVoters).toBe(3);
    expect(result.remainingVotes).toBe(3);
    expect(updateCalls.length).toBe(1);
    expect(updateCalls[0]).toMatchObject({ survey_expected_voters: 3 });
  });

  test('does not rewrite canonical survey window when runtime TZ differs', async () => {
    const originalTz = process.env.TZ;
    try {
      process.env.TZ = 'America/Los_Angeles';

      const lifecycleRow = {
        survey_status: 'open',
        survey_opened_at: '2026-03-18T02:00:00.000Z',
        survey_closes_at: '2026-03-19T02:00:00.000Z',
        survey_expected_voters: 1,
        result_status: 'pending',
        winner_team: null,
        finished_at: null,
        fecha: '2026-03-17',
        hora: '22:00',
      };

      const updateCalls = [];
      mockFrom.mockImplementation(buildSupabaseFromMock({
        rosterRows: [{ id: 9, usuario_id: 'u9' }],
        lifecycleRow,
        teamMatchRow: null,
        surveyRows: [],
        updateCalls,
      }));

      const result = await ensureSurveyWindowOpen(303, {
        nowIso: '2026-03-18T03:00:00.000Z',
      });

      expect(result.openedAt).toBe('2026-03-18T02:00:00.000Z');
      expect(result.closesAt).toBe('2026-03-19T02:00:00.000Z');
      expect(updateCalls.length).toBe(0);
    } finally {
      process.env.TZ = originalTz;
    }
  });

  test('counts only approved challenge squad users as expected voters', async () => {
    listChallengeApprovedSquad.mockResolvedValueOnce({
      byTeamId: {
        ta: [{ user_id: 'u1', jugador: { usuario_id: 'u1' } }],
        tb: [{ user_id: 'u2', jugador: { usuario_id: 'u2' } }],
      },
    });

    const updateCalls = [];
    mockFrom.mockImplementation(buildSupabaseFromMock({
      rosterRows: [
        { id: 1, usuario_id: 'u1', uuid: 'u1', nombre: 'Uno' },
        { id: 2, usuario_id: 'u2', uuid: 'u2', nombre: 'Dos' },
        { id: 3, usuario_id: 'u3', uuid: 'u3', nombre: 'Tres' },
      ],
      lifecycleRow: {
        survey_status: 'open',
        survey_opened_at: '2026-03-18T02:00:00.000Z',
        survey_closes_at: '2026-03-19T02:00:00.000Z',
        survey_expected_voters: 0,
        result_status: 'pending',
        winner_team: null,
        finished_at: null,
        fecha: '2026-03-17',
        hora: '22:00',
        survey_team_a: [],
        survey_team_b: [],
        final_team_a: [],
        final_team_b: [],
      },
      teamMatchRow: {
        id: 404,
        origin_type: 'challenge',
        challenge_id: 'c404',
        team_a_id: 'ta',
        team_b_id: 'tb',
        scheduled_at: '2026-03-18T01:00:00.000Z',
      },
      surveyRows: [],
      updateCalls,
    }));

    const result = await ensureSurveyWindowOpen(404, {
      nowIso: '2026-03-18T03:00:00.000Z',
    });

    expect(result.expectedVoters).toBe(2);
    expect(result.remainingVotes).toBe(2);
    expect(Array.from(result.eligibleByPlayerId.keys()).sort((a, b) => a - b)).toEqual([1, 2]);
    expect(updateCalls[0]).toMatchObject({
      survey_expected_voters: 2,
    });
  });

  test('supports read-only progress checks without persisting lifecycle writes', async () => {
    const updateCalls = [];
    mockFrom.mockImplementation(buildSupabaseFromMock({
      rosterRows: [
        { id: 1, usuario_id: 'u1' },
        { id: 2, usuario_id: 'u2' },
      ],
      lifecycleRow: {
        survey_status: 'open',
        survey_opened_at: null,
        survey_closes_at: null,
        survey_expected_voters: 0,
        result_status: 'pending',
        winner_team: null,
        finished_at: null,
        fecha: '2026-03-17',
        hora: '22:00',
      },
      teamMatchRow: null,
      surveyRows: [{ votante_id: 1 }],
      updateCalls,
    }));

    const result = await ensureSurveyWindowOpen(505, {
      nowIso: '2026-03-18T03:00:00.000Z',
      persistLifecycle: false,
    });

    expect(result.openedAt).toBe('2026-03-18T02:00:00.000Z');
    expect(result.closesAt).toBe('2026-03-19T02:00:00.000Z');
    expect(result.expectedVoters).toBe(2);
    expect(result.submittedVoters).toBe(1);
    expect(result.remainingVotes).toBe(1);
    expect(updateCalls).toHaveLength(0);
  });

  test('excludes substitutes from expected voters when no effective roster evidence says they entered', async () => {
    const updateCalls = [];
    mockFrom.mockImplementation(buildSupabaseFromMock({
      rosterRows: [
        { id: 1, usuario_id: 'u1', uuid: 'u1', nombre: 'Titular Uno', is_substitute: false },
        { id: 2, usuario_id: 'u2', uuid: 'u2', nombre: 'Titular Dos', is_substitute: false },
        { id: 3, usuario_id: 'u3', uuid: 'u3', nombre: 'Suplente Tres', is_substitute: true },
      ],
      lifecycleRow: {
        survey_status: 'open',
        survey_opened_at: null,
        survey_closes_at: null,
        survey_expected_voters: 0,
        result_status: 'pending',
        winner_team: null,
        finished_at: null,
        fecha: '2026-03-17',
        hora: '22:00',
      },
      rosterContextRow: {
        equipos_json: null,
        equipos: null,
        survey_team_a: [],
        survey_team_b: [],
        final_team_a: [],
        final_team_b: [],
      },
      confirmationRow: null,
      teamMatchRow: null,
      surveyRows: [],
      updateCalls,
    }));

    const result = await ensureSurveyWindowOpen(606, {
      nowIso: '2026-03-18T03:00:00.000Z',
    });

    expect(result.expectedVoters).toBe(2);
    expect(result.remainingVotes).toBe(2);
    expect(Array.from(result.eligibleByPlayerId.keys()).sort((a, b) => a - b)).toEqual([1, 2]);
  });
});
