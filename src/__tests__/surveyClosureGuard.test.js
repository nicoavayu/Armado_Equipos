jest.mock('../config/surveyConfig', () => ({
  SURVEY_FINALIZE_DELAY_MS: 12 * 60 * 60 * 1000,
  SURVEY_MIN_VOTERS_FOR_AWARDS: 4,
  SURVEY_MIN_VOTERS_IMMEDIATE_FINALIZE: 3,
}));

import {
  resolveMonotonicExpectedVoters,
  shouldBumpExpectedVoters,
  shouldFinalizeSurveyClosure,
} from '../services/surveyCompletionService';

describe('survey closure guard rails', () => {
  test('expected voters bumps from 3 to 4 while survey is open', () => {
    expect(resolveMonotonicExpectedVoters({
      storedExpectedVoters: 3,
      computedEligibleVoters: 4,
    })).toBe(4);

    expect(shouldBumpExpectedVoters({
      surveyStatus: 'open',
      storedExpectedVoters: 3,
      computedEligibleVoters: 4,
    })).toBe(true);
  });

  test('finalize runs when immediate quorum is met (3/4)', () => {
    expect(shouldFinalizeSurveyClosure({
      submissionsCount: 3,
      expectedVoters: 4,
      deadlineReached: false,
    })).toBe(true);
  });

  test('finalize still waits when quorum is not met and deadline not reached (2/4)', () => {
    expect(shouldFinalizeSurveyClosure({
      submissionsCount: 2,
      expectedVoters: 4,
      deadlineReached: false,
    })).toBe(false);
  });

  test('finalize runs at 4/4, 1/2, or when deadline is reached', () => {
    expect(shouldFinalizeSurveyClosure({
      submissionsCount: 4,
      expectedVoters: 4,
      deadlineReached: false,
    })).toBe(true);

    expect(shouldFinalizeSurveyClosure({
      submissionsCount: 1,
      expectedVoters: 2,
      deadlineReached: false,
    })).toBe(true);

    expect(shouldFinalizeSurveyClosure({
      submissionsCount: 3,
      expectedVoters: 4,
      deadlineReached: true,
    })).toBe(true);
  });
});
