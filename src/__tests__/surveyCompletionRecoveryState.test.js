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

const {
  deriveClosedSurveyRecoveryState,
  resolveClosedAwardsTerminalState,
} = require('../services/surveyCompletionService');

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
