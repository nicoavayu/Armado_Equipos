jest.mock('../config/surveyConfig', () => ({
  SURVEY_FINALIZE_DELAY_MS: 24 * 60 * 60 * 1000,
  SURVEY_START_DELAY_MS: 60 * 60 * 1000,
  SURVEY_MIN_VOTERS_FOR_AWARDS: 3,
}));

jest.mock('../supabase', () => ({
  supabase: {
    from: jest.fn(),
    rpc: jest.fn(),
  },
}));

jest.mock('../services/db/awards', () => ({
  grantAwardsForMatch: jest.fn(),
  notifyAwardWinnersForMatch: jest.fn(async () => ({ notified: [], skipped: [], error: null })),
}));

const {
  deriveClosedSurveyRecoveryState,
  materializePersistedAwardsForMatch,
  resolveClosedAwardsTerminalState,
} = require('../services/surveyCompletionService');
const { supabase } = require('../supabase');
const { grantAwardsForMatch } = require('../services/db/awards');

describe('deriveClosedSurveyRecoveryState', () => {
  test('recovers when lifecycle is closed but survey_results row is missing', () => {
    const state = deriveClosedSurveyRecoveryState({
      lifecycle: {
        survey_status: 'closed',
        awards_status: 'pending',
      },
      surveyResultsRow: null,
    });

    expect(state).toEqual(expect.objectContaining({
      shouldRecover: true,
      surveyStatus: 'closed',
      resultsReady: false,
      awardsStatus: 'pending',
      awardsTerminal: false,
    }));
  });

  test('recovers when results are ready but awards are still pending', () => {
    const state = deriveClosedSurveyRecoveryState({
      lifecycle: {
        survey_status: 'closed',
        awards_status: 'pending',
      },
      surveyResultsRow: {
        results_ready: true,
        awards_status: 'pending',
      },
    });

    expect(state).toEqual(expect.objectContaining({
      shouldRecover: true,
      surveyStatus: 'closed',
      resultsReady: true,
      awardsStatus: 'pending',
      awardsTerminal: false,
    }));
  });

  test('does not recover when closed match already has terminal ready awards', () => {
    const state = deriveClosedSurveyRecoveryState({
      lifecycle: {
        survey_status: 'closed',
        awards_status: 'ready',
      },
      surveyResultsRow: {
        results_ready: true,
        awards_status: 'ready',
      },
    });

    expect(state).toEqual(expect.objectContaining({
      shouldRecover: false,
      surveyStatus: 'closed',
      resultsReady: true,
      awardsStatus: 'ready',
      awardsTerminal: true,
    }));
  });

  test('does not recover when closed match already has terminal not_eligible awards', () => {
    const state = deriveClosedSurveyRecoveryState({
      lifecycle: {
        survey_status: 'closed',
        awards_status: 'not_eligible',
      },
      surveyResultsRow: {
        results_ready: true,
        awards_status: 'not_eligible',
      },
    });

    expect(state).toEqual(expect.objectContaining({
      shouldRecover: false,
      surveyStatus: 'closed',
      resultsReady: true,
      awardsStatus: 'not_eligible',
      awardsTerminal: true,
    }));
  });

  test('keeps trying recovery when closed match was marked with explicit awards error', () => {
    const state = deriveClosedSurveyRecoveryState({
      lifecycle: {
        survey_status: 'closed',
        awards_status: 'error',
      },
      surveyResultsRow: {
        results_ready: true,
        awards_status: 'error',
      },
    });

    expect(state).toEqual(expect.objectContaining({
      shouldRecover: true,
      surveyStatus: 'closed',
      resultsReady: true,
      awardsStatus: 'error',
      awardsTerminal: false,
    }));
  });
});

describe('resolveClosedAwardsTerminalState', () => {
  test('marks ready when closed row already has persisted award payload', () => {
    const state = resolveClosedAwardsTerminalState({
      awardsPersistResult: {
        persisted: false,
        reason: 'retry_exception',
      },
      awardsRow: {
        results_ready: true,
        awards: { mvp: { player_id: '10' } },
      },
    });

    expect(state).toEqual({
      awardsStatus: 'ready',
      awardsSkipped: false,
      awardsError: false,
    });
  });

  test('marks not_eligible only for explicit business reasons', () => {
    const state = resolveClosedAwardsTerminalState({
      awardsPersistResult: {
        persisted: false,
        reason: 'insufficient_voters',
      },
      awardsRow: {
        results_ready: true,
        awards: {},
      },
    });

    expect(state).toEqual({
      awardsStatus: 'not_eligible',
      awardsSkipped: true,
      awardsError: false,
    });
  });

  test('marks error instead of pending when close finished without terminal awards resolution', () => {
    const state = resolveClosedAwardsTerminalState({
      awardsPersistResult: {
        persisted: false,
        reason: 'compute_exception',
      },
      awardsRow: {
        results_ready: true,
        awards: {},
      },
    });

    expect(state).toEqual({
      awardsStatus: 'error',
      awardsSkipped: false,
      awardsError: true,
    });
  });
});

describe('materializePersistedAwardsForMatch', () => {
  beforeEach(() => {
    supabase.from.mockReset();
    grantAwardsForMatch.mockReset();
  });

  test('replays persisted awards for registered winners without changing refs in survey_results', async () => {
    const eq = jest.fn(async () => ({
      data: [
        { id: 10, uuid: 'player-10', usuario_id: 'user-10' },
        { id: 11, uuid: 'player-11', usuario_id: 'user-11' },
      ],
      error: null,
    }));
    const select = jest.fn(() => ({ eq }));
    supabase.from.mockImplementation((table) => {
      if (table !== 'jugadores') throw new Error(`Unexpected table ${table}`);
      return { select };
    });
    grantAwardsForMatch.mockResolvedValue({
      granted: ['mvp', 'best_gk'],
      skipped: [],
      error: null,
      expectedRegisteredAwards: 2,
      persistedRegisteredAwards: 2,
    });

    const result = await materializePersistedAwardsForMatch(483, {
      awards: {
        mvp: { player_id: 'user-10', votes: 2 },
        best_gk: { player_id: 'player-11', votes: 2 },
      },
    });

    expect(result).toEqual(expect.objectContaining({
      ok: true,
      reason: 'ok',
      expectedRegisteredAwards: 2,
      persistedRegisteredAwards: 2,
    }));
    expect(grantAwardsForMatch).toHaveBeenCalledWith(483, expect.objectContaining({
      mvp: expect.objectContaining({ player_id: 10, votes: 2 }),
      best_gk: expect.objectContaining({ player_id: 11, votes: 2 }),
    }));
  });

  test('treats manual winners as successfully materialized without player_awards rows', async () => {
    const eq = jest.fn(async () => ({
      data: [
        { id: 21, uuid: 'guest-21', usuario_id: null },
      ],
      error: null,
    }));
    const select = jest.fn(() => ({ eq }));
    supabase.from.mockImplementation((table) => {
      if (table !== 'jugadores') throw new Error(`Unexpected table ${table}`);
      return { select };
    });
    grantAwardsForMatch.mockResolvedValue({
      granted: [],
      skipped: ['mvp (guest player)'],
      error: null,
      expectedRegisteredAwards: 0,
      persistedRegisteredAwards: 0,
    });

    const result = await materializePersistedAwardsForMatch(483, {
      awards: {
        mvp: { player_id: 'guest-21', votes: 3 },
      },
    });

    expect(result).toEqual(expect.objectContaining({
      ok: true,
      reason: 'ok',
      expectedRegisteredAwards: 0,
      persistedRegisteredAwards: 0,
    }));
    expect(grantAwardsForMatch).toHaveBeenCalledWith(483, expect.objectContaining({
      mvp: expect.objectContaining({ player_id: 21, votes: 3 }),
    }));
  });
});
