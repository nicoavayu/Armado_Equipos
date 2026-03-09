jest.mock('../config/surveyConfig', () => ({
  SURVEY_FINALIZE_DELAY_MS: 12 * 60 * 60 * 1000,
  SURVEY_MIN_VOTERS_FOR_AWARDS: 4,
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

  test('finalize does not run at 3/4 without deadline', () => {
    expect(shouldFinalizeSurveyClosure({
      submissionsCount: 3,
      expectedVoters: 4,
      deadlineReached: false,
    })).toBe(false);
  });

  test('finalize runs at 4/4 or when deadline is reached', () => {
    expect(shouldFinalizeSurveyClosure({
      submissionsCount: 4,
      expectedVoters: 4,
      deadlineReached: false,
    })).toBe(true);

    expect(shouldFinalizeSurveyClosure({
      submissionsCount: 3,
      expectedVoters: 4,
      deadlineReached: true,
    })).toBe(true);
  });
});
