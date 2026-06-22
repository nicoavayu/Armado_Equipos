const {
  getPaymentStatusMeta,
  resolvePaymentAmount,
  formatPaymentAmount,
  summarizePayments,
  shouldShowPostMatchCard,
  POST_MATCH_PLAYER_WINDOW_MS,
  POST_MATCH_ADMIN_WINDOW_MS,
} = require('../utils/paymentStatus');

describe('getPaymentStatusMeta', () => {
  test('returns label per status', () => {
    expect(getPaymentStatusMeta('paid').label).toBe('Pagado');
    expect(getPaymentStatusMeta('reported_paid').label).toBe('Avisó pago');
    expect(getPaymentStatusMeta('pending').label).toBe('Debe');
    expect(getPaymentStatusMeta('exempt').label).toBe('Exento');
  });

  test('falls back to pending for unknown / empty', () => {
    expect(getPaymentStatusMeta('weird').key).toBe('pending');
    expect(getPaymentStatusMeta(null).key).toBe('pending');
  });
});

describe('resolvePaymentAmount', () => {
  test('prefers explicit settings amount', () => {
    expect(resolvePaymentAmount({ amount_per_player: 6000 }, { precio_cancha_por_persona: 5000 })).toBe(6000);
  });

  test('falls back to match price when no settings amount', () => {
    expect(resolvePaymentAmount(null, { precio_cancha_por_persona: 5000 })).toBe(5000);
    expect(resolvePaymentAmount({ amount_per_player: null }, { precio_cancha_por_persona: 4500 })).toBe(4500);
  });

  test('returns null when nothing usable', () => {
    expect(resolvePaymentAmount(null, {})).toBeNull();
    expect(resolvePaymentAmount({ amount_per_player: 0 }, { precio_cancha_por_persona: 0 })).toBeNull();
  });

  test('parses plain numeric strings (as stored from the edit form)', () => {
    expect(resolvePaymentAmount({ amount_per_player: '6000' }, null)).toBe(6000);
  });
});

describe('formatPaymentAmount', () => {
  test('formats ARS currency', () => {
    expect(formatPaymentAmount(6000)).toContain('6.000');
  });

  test('uses fallback for null / zero', () => {
    expect(formatPaymentAmount(null)).toBe('A definir');
    expect(formatPaymentAmount(0, 'Sin precio')).toBe('Sin precio');
  });
});

describe('summarizePayments', () => {
  test('counts each status and computes settled', () => {
    const rows = [
      { status: 'paid' },
      { status: 'paid' },
      { status: 'reported_paid' },
      { status: 'pending' },
      { status: 'exempt' },
    ];
    expect(summarizePayments(rows)).toEqual({
      total: 5,
      paid: 2,
      reported: 1,
      pending: 1,
      exempt: 1,
      settled: false,
    });
  });

  test('settled when no pending and no reported', () => {
    expect(summarizePayments([{ status: 'paid' }, { status: 'exempt' }]).settled).toBe(true);
  });

  test('empty list', () => {
    expect(summarizePayments([]).total).toBe(0);
    expect(summarizePayments(undefined).total).toBe(0);
  });
});

describe('shouldShowPostMatchCard', () => {
  const start = new Date('2026-06-20T20:00:00');

  test('keeps showing right after kickoff', () => {
    const now = new Date(start.getTime() + 30 * 60 * 1000);
    expect(shouldShowPostMatchCard({ isAdmin: false, startsAt: start, now, hasCompletedSurvey: false, paymentsConfigured: true, myPaymentStatus: 'pending' })).toBe(true);
  });

  test('player: hidden once survey done AND payment settled', () => {
    const now = new Date(start.getTime() + 60 * 60 * 1000);
    expect(shouldShowPostMatchCard({ isAdmin: false, startsAt: start, now, hasCompletedSurvey: true, paymentsConfigured: true, myPaymentStatus: 'paid' })).toBe(false);
    expect(shouldShowPostMatchCard({ isAdmin: false, startsAt: start, now, hasCompletedSurvey: true, paymentsConfigured: true, myPaymentStatus: 'exempt' })).toBe(false);
  });

  test('player: still shown if survey done but payment pending', () => {
    const now = new Date(start.getTime() + 60 * 60 * 1000);
    expect(shouldShowPostMatchCard({ isAdmin: false, startsAt: start, now, hasCompletedSurvey: true, paymentsConfigured: true, myPaymentStatus: 'reported_paid' })).toBe(true);
  });

  test('player: hidden once survey done when no payments configured', () => {
    const now = new Date(start.getTime() + 60 * 60 * 1000);
    expect(shouldShowPostMatchCard({ isAdmin: false, startsAt: start, now, hasCompletedSurvey: true, paymentsConfigured: false })).toBe(false);
  });

  test('player: hidden after 72h regardless', () => {
    const now = new Date(start.getTime() + POST_MATCH_PLAYER_WINDOW_MS + 1000);
    expect(shouldShowPostMatchCard({ isAdmin: false, startsAt: start, now, hasCompletedSurvey: false, paymentsConfigured: true, myPaymentStatus: 'pending' })).toBe(false);
  });

  test('admin: shown up to 7 days, hidden after', () => {
    const within = new Date(start.getTime() + POST_MATCH_PLAYER_WINDOW_MS + 1000); // >72h still < 7d
    const after = new Date(start.getTime() + POST_MATCH_ADMIN_WINDOW_MS + 1000);
    expect(shouldShowPostMatchCard({ isAdmin: true, startsAt: start, now: within })).toBe(true);
    expect(shouldShowPostMatchCard({ isAdmin: true, startsAt: start, now: after })).toBe(false);
  });

  test('admin: hidden when payments closed', () => {
    const now = new Date(start.getTime() + 60 * 60 * 1000);
    expect(shouldShowPostMatchCard({ isAdmin: true, startsAt: start, now, isClosed: true })).toBe(false);
  });

  test('no date => keep showing (defensive)', () => {
    expect(shouldShowPostMatchCard({ isAdmin: false, startsAt: null })).toBe(true);
  });
});
