import {
  buildAutoMatchNotificationRoute,
  isAutoMatchNotificationType,
} from '../utils/notificationRoutes';

const notif = (type, data) => ({ type, data });

describe('auto-match notification routes', () => {
  test('recognises every auto-match type, including the substitute ones', () => {
    for (const type of [
      'auto_match_gestating',
      'auto_match_ready',
      'auto_match_created',
      'auto_match_cancelled',
      'auto_match_invite_expired',
      'auto_match_substitute_invite',
      'auto_match_substitute_joined',
      'auto_match_vacancy_reopened',
    ]) {
      expect(isAutoMatchNotificationType(type)).toBe(true);
    }
    expect(isAutoMatchNotificationType('match_invite')).toBe(false);
  });

  test('gestation-stage notifications open the proposal detail by proposal_id', () => {
    expect(buildAutoMatchNotificationRoute(notif('auto_match_gestating', { proposal_id: 42 })))
      .toBe('/quiero-jugar?auto=1&proposal=42');
    expect(buildAutoMatchNotificationRoute(notif('auto_match_invite_expired', { proposal_id: 42 })))
      .toBe('/quiero-jugar?auto=1&proposal=42');
  });

  test('the substitute INVITE opens the gestation detail (where you accept), not the match', () => {
    // Trae proposal_id y partido_id, pero la acción (aceptar de suplente) vive
    // en el detalle de la propuesta.
    const route = buildAutoMatchNotificationRoute(
      notif('auto_match_substitute_invite', { proposal_id: 42, partido_id: 900, route: '/quiero-jugar?auto=1&proposal=42' }),
    );
    expect(route).toBe('/quiero-jugar?auto=1&proposal=42');
  });

  test('created + substitute-joined + vacancy-reopened open the real match', () => {
    expect(buildAutoMatchNotificationRoute(notif('auto_match_created', { proposal_id: 42, partido_id: 900 })))
      .toBe('/partido-publico/900');
    expect(buildAutoMatchNotificationRoute(notif('auto_match_substitute_joined', { proposal_id: 42, partido_id: 900 })))
      .toBe('/partido-publico/900');
    expect(buildAutoMatchNotificationRoute(notif('auto_match_vacancy_reopened', { proposal_id: 42, partido_id: 900 })))
      .toBe('/partido-publico/900');
  });
});
