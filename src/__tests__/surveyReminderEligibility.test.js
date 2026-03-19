const { isSurveyReminderActionRequired } = require('../utils/surveyReminderEligibility');

describe('survey reminder eligibility', () => {
  test('returns false when survey_status is closed', () => {
    const result = isSurveyReminderActionRequired({
      surveyStatus: 'closed',
      resultStatus: 'pending',
      matchStatus: 'finalizado',
      surveyClosesAt: '2030-01-01T00:00:00.000Z',
      nowMs: Date.parse('2029-12-31T20:00:00.000Z'),
    });

    expect(result).toBe(false);
  });

  test('returns false when result_status is finished', () => {
    const result = isSurveyReminderActionRequired({
      surveyStatus: 'open',
      resultStatus: 'finished',
      matchStatus: 'finalizado',
      surveyClosesAt: '2030-01-01T00:00:00.000Z',
      nowMs: Date.parse('2029-12-31T20:00:00.000Z'),
    });

    expect(result).toBe(false);
  });

  test('returns false when survey deadline is already passed', () => {
    const result = isSurveyReminderActionRequired({
      surveyStatus: 'open',
      resultStatus: 'pending',
      matchStatus: 'finalizado',
      surveyClosesAt: '2029-12-31T20:00:00.000Z',
      nowMs: Date.parse('2029-12-31T21:00:00.000Z'),
    });

    expect(result).toBe(false);
  });

  test('returns true when survey is open and deadline is still pending', () => {
    const result = isSurveyReminderActionRequired({
      surveyStatus: 'open',
      resultStatus: 'pending',
      matchStatus: 'finalizado',
      surveyClosesAt: '2030-01-01T00:00:00.000Z',
      nowMs: Date.parse('2029-12-31T21:00:00.000Z'),
    });

    expect(result).toBe(true);
  });
});
