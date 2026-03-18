jest.mock('../config/surveyConfig', () => ({
  SURVEY_FINALIZE_DELAY_MS: 24 * 60 * 60 * 1000,
  SURVEY_START_DELAY_MS: 60 * 60 * 1000,
}));

import { isAwardsRingNotificationType } from '../components/FifaHomeContent';

describe('FifaHome awards ring notification guard', () => {
  test('solo tipos de premios habilitan el ring', () => {
    expect(isAwardsRingNotificationType('awards_ready')).toBe(true);
    expect(isAwardsRingNotificationType('award_won')).toBe(true);
    expect(isAwardsRingNotificationType('survey_results_ready')).toBe(false);
  });
});
