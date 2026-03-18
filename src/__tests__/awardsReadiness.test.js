import {
  AWARDS_READY_NOTIFICATION_TYPES,
  AWARDS_STATUS_NOT_ELIGIBLE,
  AWARDS_STATUS_PENDING,
  AWARDS_STATUS_READY,
  isAwardsNotEligibleStatus,
  isAwardsReadyStatus,
  isAwardsTrulyReady,
  normalizeAwardsStatus,
} from '../utils/awardsReadiness';

describe('awardsReadiness', () => {
  test('tipos de notificación de premios no incluyen survey_results_ready', () => {
    expect(AWARDS_READY_NOTIFICATION_TYPES.has('awards_ready')).toBe(true);
    expect(AWARDS_READY_NOTIFICATION_TYPES.has('award_won')).toBe(true);
    expect(AWARDS_READY_NOTIFICATION_TYPES.has('survey_results_ready')).toBe(false);
  });

  test('normaliza estados legacy a estados canónicos', () => {
    expect(normalizeAwardsStatus('ready')).toBe(AWARDS_STATUS_READY);
    expect(normalizeAwardsStatus('applied')).toBe(AWARDS_STATUS_READY);
    expect(normalizeAwardsStatus('pending_retry')).toBe(AWARDS_STATUS_PENDING);
    expect(normalizeAwardsStatus('processing')).toBe(AWARDS_STATUS_PENDING);
    expect(normalizeAwardsStatus('insufficient')).toBe(AWARDS_STATUS_NOT_ELIGIBLE);
    expect(normalizeAwardsStatus('skipped_not_played')).toBe(AWARDS_STATUS_NOT_ELIGIBLE);
  });

  test('premios listos dependen de estado explícito', () => {
    expect(isAwardsReadyStatus({ awards_status: 'ready' })).toBe(true);
    expect(isAwardsReadyStatus({ awards_status: 'pending', awards: { mvp: { player_id: '10' } } })).toBe(false);
    expect(isAwardsReadyStatus({ awards_generated: true })).toBe(true);
  });

  test('estado not_eligible queda terminal', () => {
    expect(isAwardsNotEligibleStatus({ awards_status: 'not_eligible' })).toBe(true);
    expect(isAwardsNotEligibleStatus({ awards_status: 'pending' })).toBe(false);
  });

  test('isAwardsTrulyReady usa la misma regla fuerte de disponibilidad', () => {
    expect(isAwardsTrulyReady({ awards_status: 'ready' })).toBe(true);
    expect(isAwardsTrulyReady({ awards_status: 'pending', mvp: '7' })).toBe(false);
  });
});
