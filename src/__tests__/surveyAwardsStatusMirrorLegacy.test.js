const mockFrom = jest.fn();

jest.mock('../config/surveyConfig', () => ({
  SURVEY_FINALIZE_DELAY_MS: 24 * 60 * 60 * 1000,
  SURVEY_START_DELAY_MS: 60 * 60 * 1000,
  SURVEY_MIN_VOTERS_FOR_AWARDS: 3,
}));

jest.mock('../supabase', () => ({
  supabase: {
    from: (...args) => mockFrom(...args),
  },
}));

const { setMatchAwardsStatus } = require('../services/surveyCompletionService');

const buildUpdateChain = (result) => ({
  update: jest.fn(() => ({
    eq: jest.fn(async () => result),
  })),
});

describe('setMatchAwardsStatus legacy mirror behavior', () => {
  beforeEach(() => {
    mockFrom.mockReset();
  });

  test('mirrors status to partidos when survey_results lacks awards_status column', async () => {
    const surveyResultsChain = buildUpdateChain({
      error: {
        code: '42703',
        message: 'column "awards_status" does not exist',
      },
    });
    const partidosChain = buildUpdateChain({ error: null });

    mockFrom.mockImplementation((table) => {
      if (table === 'survey_results') return surveyResultsChain;
      if (table === 'partidos') return partidosChain;
      throw new Error(`Unexpected table ${table}`);
    });

    const result = await setMatchAwardsStatus(394, 'not_eligible');

    expect(result).toEqual(expect.objectContaining({
      ok: true,
      unsupported: true,
      surveyResultsUpdated: false,
      partidosUpdated: true,
    }));
  });

  test('returns failure when both survey_results is unsupported and partidos mirror fails', async () => {
    const surveyResultsChain = buildUpdateChain({
      error: {
        code: '42703',
        message: 'column "awards_status" does not exist',
      },
    });
    const partidosChain = buildUpdateChain({
      error: {
        code: '42501',
        message: 'permission denied for table partidos',
      },
    });

    mockFrom.mockImplementation((table) => {
      if (table === 'survey_results') return surveyResultsChain;
      if (table === 'partidos') return partidosChain;
      throw new Error(`Unexpected table ${table}`);
    });

    const result = await setMatchAwardsStatus(394, 'not_eligible');

    expect(result).toEqual(expect.objectContaining({
      ok: false,
      reason: 'partidos_mirror_failed',
      unsupported: true,
    }));
  });

  test('writes awards_resolved_at when persisting a terminal status into partidos', async () => {
    const partidosUpdate = jest.fn((payload) => {
      expect(payload.awards_status).toBe('ready');
      expect(typeof payload.awards_resolved_at).toBe('string');
      return {
        eq: jest.fn(async () => ({ error: null })),
      };
    });

    mockFrom.mockImplementation((table) => {
      if (table === 'survey_results') return { update: jest.fn(() => ({ eq: jest.fn(async () => ({ error: null })) })) };
      if (table === 'partidos') return { update: partidosUpdate };
      throw new Error(`Unexpected table ${table}`);
    });

    const result = await setMatchAwardsStatus(394, 'ready');

    expect(result).toEqual(expect.objectContaining({
      ok: true,
      surveyResultsUpdated: true,
      partidosUpdated: true,
    }));
    expect(partidosUpdate).toHaveBeenCalledTimes(1);
  });
});
