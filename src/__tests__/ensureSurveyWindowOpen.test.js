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

const { ensureSurveyWindowOpen } = require('../services/surveyCompletionService');

const buildSupabaseFromMock = ({
  rosterRows = [],
  lifecycleRow = null,
  teamMatchRow = null,
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
      select: jest.fn(() => ({
        eq: jest.fn(() => ({
          maybeSingle: jest.fn(async () => ({ data: lifecycleRow, error: null })),
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
          order: jest.fn(() => ({
            limit: jest.fn(() => ({
              maybeSingle: jest.fn(async () => ({ data: teamMatchRow, error: null })),
            })),
          })),
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

  throw new Error(`Unexpected table in mock: ${table}`);
};

describe('ensureSurveyWindowOpen', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-03-18T03:00:00.000Z'));
    mockFrom.mockReset();
    mockRpc.mockReset();
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
});
