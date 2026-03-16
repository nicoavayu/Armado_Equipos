jest.mock('../config/surveyConfig', () => ({
  SURVEY_START_DELAY_MS: 60 * 60 * 1000,
}));

const { resolveSurveyLifecycleBlock } = require('../utils/surveyAccess');

describe('surveyAccess lifecycle guards', () => {
  test('blocks closed surveys', () => {
    const result = resolveSurveyLifecycleBlock({
      partidoRow: {
        estado: 'finalizado',
        survey_status: 'closed',
        result_status: 'finished',
        finished_at: '2026-03-16T10:00:00.000Z',
      },
      now: new Date('2026-03-16T12:00:00.000Z').getTime(),
    });

    expect(result.blocked).toBe(true);
    expect(result.reason).toBe('survey_closed');
  });

  test('blocks unavailable cancelled matches', () => {
    const result = resolveSurveyLifecycleBlock({
      partidoRow: {
        estado: 'cancelado',
        survey_status: 'open',
        result_status: 'pending',
      },
      now: new Date('2026-03-16T12:00:00.000Z').getTime(),
    });

    expect(result.blocked).toBe(true);
    expect(result.reason).toBe('match_unavailable');
  });

  test('allows open surveys while deadline is pending', () => {
    const result = resolveSurveyLifecycleBlock({
      partidoRow: {
        estado: 'pendiente',
        survey_status: 'open',
        survey_closes_at: '2030-03-16T18:00:00.000Z',
        result_status: 'pending',
        finished_at: null,
      },
      now: new Date('2026-03-16T12:00:00.000Z').getTime(),
    });

    expect(result.blocked).toBe(false);
    expect(result.reason).toBe('ok');
  });
});
