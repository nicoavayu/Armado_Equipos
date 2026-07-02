import getNextHomeAction, {
  buildPaymentsNextStepAction,
  derivePaymentNotificationCandidates,
} from '../utils/homeNextStep';

const item = (type, overrides = {}) => ({
  id: `activity-${type}-1`,
  type,
  partidoId: 10,
  title: `title ${type}`,
  subtitle: `subtitle ${type}`,
  matchName: 'Jueves F5',
  route: `/route/${type}`,
  createdAt: '2026-07-01T12:00:00.000Z',
  ...overrides,
});

describe('getNextHomeAction', () => {
  test('returns null when there is nothing actionable', () => {
    expect(getNextHomeAction()).toBeNull();
    expect(getNextHomeAction({ activityItems: [] })).toBeNull();
  });

  test('ignores informative-only items (match_today, cancellations, insights)', () => {
    const action = getNextHomeAction({
      activityItems: [
        item('match_today'),
        item('match_cancelled', { route: null }),
        item('insight_weekly_matches'),
        item('friend_request'),
      ],
    });
    expect(action).toBeNull();
  });

  test('picks a single action by priority: missing players beats survey', () => {
    const action = getNextHomeAction({
      activityItems: [
        item('survey_start'),
        item('falta_jugadores'),
      ],
    });
    expect(action.type).toBe('falta_jugadores');
    expect(action.route).toBe('/route/falta_jugadores');
  });

  test('votes beat surveys, surveys beat results', () => {
    const action = getNextHomeAction({
      activityItems: [
        item('survey_results_ready', { partidoId: 7 }),
        item('survey_start'),
        item('call_to_vote'),
      ],
      validatedResultsMatchIds: ['7'],
    });
    expect(action.type).toBe('call_to_vote');
    expect(action.ctaLabel).toBe('Ir a votar');
  });

  test('items without route never become actions', () => {
    const action = getNextHomeAction({
      activityItems: [item('call_to_vote', { route: null })],
    });
    expect(action).toBeNull();
  });

  test('results action requires the match to be validated as real', () => {
    const items = [item('survey_results_ready', { partidoId: 7 })];

    expect(getNextHomeAction({
      activityItems: items,
      validatedResultsMatchIds: [],
    })).toBeNull();

    const action = getNextHomeAction({
      activityItems: items,
      validatedResultsMatchIds: ['7'],
    });
    expect(action.type).toBe('survey_results_ready');
    expect(action.title).toBe('Resultados listos');
    expect(action.description).toBe('Mirá cómo salió "Jueves F5"');
    expect(action.ctaLabel).toBe('Ver resumen');
    expect(action.isResultsAction).toBe(true);
  });

  test('results action hidden while validation is loading', () => {
    expect(getNextHomeAction({
      activityItems: [item('awards_ready', { partidoId: 7 })],
      validatedResultsMatchIds: ['7'],
      resultsValidationLoading: true,
    })).toBeNull();
  });

  test('payment action is included and loses to survey but beats results', () => {
    const paymentAction = {
      key: 'next-step-payment-admin-9',
      type: 'payment_admin',
      partidoId: 9,
      route: '/pagos/9',
      title: 'Tenés pagos por confirmar',
      description: '1 jugador avisó que pagó',
      ctaLabel: 'Ver pagos',
      icon: 'Wallet',
    };

    const withSurvey = getNextHomeAction({
      activityItems: [item('survey_start')],
      paymentAction,
    });
    expect(withSurvey.type).toBe('survey_start');

    const withResults = getNextHomeAction({
      activityItems: [item('survey_results_ready', { partidoId: 7 })],
      validatedResultsMatchIds: ['7'],
      paymentAction,
    });
    expect(withResults.type).toBe('payment_admin');
    expect(withResults.route).toBe('/pagos/9');
  });

  test('ties break by recency (newest first)', () => {
    const action = getNextHomeAction({
      activityItems: [
        item('survey_start', { partidoId: 1, createdAt: '2026-07-01T10:00:00.000Z', matchName: 'Viejo' }),
        item('survey_start', { partidoId: 2, createdAt: '2026-07-02T10:00:00.000Z', matchName: 'Nuevo' }),
      ],
    });
    expect(action.partidoId).toBe(2);
  });
});

describe('derivePaymentNotificationCandidates', () => {
  const now = new Date('2026-07-02T12:00:00.000Z').getTime();

  test('splits reported (admin) and reminder (player) candidates', () => {
    const { adminMatchIds, playerMatchIds } = derivePaymentNotificationCandidates([
      { type: 'payment_reported', partido_id: 5, created_at: '2026-07-01T12:00:00.000Z' },
      { type: 'payment_reminder', data: { match_id: '6' }, created_at: '2026-07-01T12:00:00.000Z' },
      { type: 'other', partido_id: 7, created_at: '2026-07-01T12:00:00.000Z' },
    ], { now });

    expect(adminMatchIds).toEqual([5]);
    expect(playerMatchIds).toEqual([6]);
  });

  test('drops stale candidates outside the 7-day window and dedupes', () => {
    const { adminMatchIds } = derivePaymentNotificationCandidates([
      { type: 'payment_reported', partido_id: 5, created_at: '2026-06-20T12:00:00.000Z' },
      { type: 'payment_reported', partido_id: 8, created_at: '2026-07-01T12:00:00.000Z' },
      { type: 'payment_reported', partido_id: 8, created_at: '2026-07-01T13:00:00.000Z' },
    ], { now });

    expect(adminMatchIds).toEqual([8]);
  });
});

describe('buildPaymentsNextStepAction', () => {
  test('admin action only when reports are actually awaiting confirmation', () => {
    const action = buildPaymentsNextStepAction({
      adminMatchIds: [5],
      adminRowsByMatch: { 5: [{ status: 'reported_paid' }, { status: 'paid' }] },
    });
    expect(action.type).toBe('payment_admin');
    expect(action.route).toBe('/pagos/5');
    expect(action.description).toBe('1 jugador avisó que pagó');
  });

  test('no admin action when nothing is reported (notification was stale)', () => {
    expect(buildPaymentsNextStepAction({
      adminMatchIds: [5],
      adminRowsByMatch: { 5: [{ status: 'paid' }, { status: 'pending' }] },
    })).toBeNull();
  });

  test('player action only when my payment is really pending', () => {
    const action = buildPaymentsNextStepAction({
      playerMatchIds: [6],
      myStatusByMatch: { 6: 'pending' },
    });
    expect(action.type).toBe('payment_player');
    expect(action.route).toBe('/pagos/6');

    expect(buildPaymentsNextStepAction({
      playerMatchIds: [6],
      myStatusByMatch: { 6: 'paid' },
    })).toBeNull();
  });

  test('closed payment rounds never produce actions', () => {
    expect(buildPaymentsNextStepAction({
      adminMatchIds: [5],
      adminRowsByMatch: { 5: [{ status: 'reported_paid' }] },
      settingsByMatch: { 5: { is_closed: true } },
    })).toBeNull();

    expect(buildPaymentsNextStepAction({
      playerMatchIds: [6],
      myStatusByMatch: { 6: 'pending' },
      settingsByMatch: { 6: { is_closed: true } },
    })).toBeNull();
  });
});
