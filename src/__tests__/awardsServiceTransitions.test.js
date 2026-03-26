const mockFrom = jest.fn();
const mockRpc = jest.fn();

jest.mock('../supabase', () => ({
  supabase: {
    from: (...args) => mockFrom(...args),
    rpc: (...args) => mockRpc(...args),
  },
}));

jest.mock('../services/surveyCompletionService', () => ({
  finalizeIfComplete: jest.fn(),
  computeAndPersistAwards: jest.fn(),
  computeResultsAverages: jest.fn(),
  setMatchAwardsStatus: jest.fn(),
}));

jest.mock('../services/db/awards', () => ({
  notifyAwardWinnersForMatch: jest.fn(async () => ({ notified: ['mvp'], skipped: [], error: null })),
}));

const {
  AWARDS_STATUS_NOT_ELIGIBLE,
  AWARDS_STATUS_READY,
} = require('../utils/awardsReadiness');
const { ensureAwards } = require('../services/awardsService');
const surveyCompletion = require('../services/surveyCompletionService');

const buildSurveyResultsFromQueue = (rows = []) => {
  let index = 0;
  return (table) => {
    if (table !== 'survey_results') {
      throw new Error(`Unexpected table in awardsServiceTransitions.test: ${table}`);
    }

    return {
      select: jest.fn(() => ({
        eq: jest.fn(() => ({
          maybeSingle: jest.fn(async () => {
            const safeIndex = Math.min(index, Math.max(rows.length - 1, 0));
            const row = rows[safeIndex] ?? null;
            index += 1;
            return { data: row, error: null };
          }),
        })),
      })),
    };
  };
};

describe('awardsService transitions', () => {
  beforeEach(() => {
    mockFrom.mockReset();
    mockRpc.mockReset();
    surveyCompletion.finalizeIfComplete.mockReset();
    surveyCompletion.computeAndPersistAwards.mockReset();
    surveyCompletion.computeResultsAverages.mockReset();
    surveyCompletion.setMatchAwardsStatus.mockReset();
  });

  test('transitions pending -> ready when awards payload is already present', async () => {
    surveyCompletion.finalizeIfComplete.mockResolvedValue({ done: true });
    surveyCompletion.setMatchAwardsStatus.mockResolvedValue({ ok: true });

    mockFrom.mockImplementation(buildSurveyResultsFromQueue([
      {
        partido_id: 100,
        results_ready: true,
        awards_status: 'pending',
        awards: { mvp: { player_id: '10' } },
      },
      {
        partido_id: 100,
        results_ready: true,
        awards_status: 'ready',
        awards: { mvp: { player_id: '10' } },
      },
    ]));

    const result = await ensureAwards(100);

    expect(result?.ok).toBe(true);
    expect(result?.applied).toBe(true);
    expect(result?.notEligible).not.toBe(true);
    expect(surveyCompletion.computeAndPersistAwards).not.toHaveBeenCalled();
    expect(surveyCompletion.setMatchAwardsStatus).toHaveBeenCalledWith(100, AWARDS_STATUS_READY);
  });

  test('transitions pending -> not_eligible when retry still has no award data (insufficient voters)', async () => {
    surveyCompletion.finalizeIfComplete.mockResolvedValue({ done: true });
    surveyCompletion.setMatchAwardsStatus.mockResolvedValue({ ok: true });
    surveyCompletion.computeAndPersistAwards.mockResolvedValue({
      persisted: false,
      reason: 'insufficient_voters',
      awardsCount: 0,
    });

    mockFrom.mockImplementation(buildSurveyResultsFromQueue([
      {
        partido_id: 101,
        results_ready: true,
        awards_status: 'pending',
        awards: {},
      },
      {
        partido_id: 101,
        results_ready: true,
        awards_status: 'pending',
        awards: {},
      },
      {
        partido_id: 101,
        results_ready: true,
        awards_status: 'not_eligible',
        awards: {},
      },
    ]));

    const result = await ensureAwards(101);

    expect(result?.ok).toBe(true);
    expect(result?.applied).toBe(false);
    expect(result?.notEligible).toBe(true);
    expect(surveyCompletion.computeAndPersistAwards).toHaveBeenCalledWith(101);
    expect(surveyCompletion.setMatchAwardsStatus).toHaveBeenCalledWith(101, AWARDS_STATUS_NOT_ELIGIBLE);
  });
});
