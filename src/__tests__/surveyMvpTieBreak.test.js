jest.mock('../config/surveyConfig', () => ({
  SURVEY_FINALIZE_DELAY_MS: 12 * 60 * 60 * 1000,
  SURVEY_MIN_VOTERS_FOR_AWARDS: 4,
}));

import { resolveMvpTieBreakWinner } from '../services/surveyCompletionService';

describe('MVP tie-break', () => {
  test('picks MVP from winning team when votes are tied', () => {
    const winner = resolveMvpTieBreakWinner({
      candidateIds: [12, 42],
      resultStatus: 'finished',
      winnerTeam: 'B',
      teamAIds: new Set([12]),
      teamBIds: new Set([42]),
    });

    expect(winner).toBe(42);
  });

  test('uses deterministic fallback on draw (lowest jugador_id)', () => {
    const winner = resolveMvpTieBreakWinner({
      candidateIds: [42, 12],
      resultStatus: 'draw',
      winnerTeam: null,
      teamAIds: new Set([12]),
      teamBIds: new Set([42]),
    });

    expect(winner).toBe(12);
  });
});
