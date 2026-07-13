import {
  buildAutoMatchNotificationRoute,
  isAutoMatchNotificationType,
} from '../utils/notificationRoutes';

const notif = (type, data) => ({ type, data });

describe('auto-match notification routes', () => {
  test('recognises every auto-match type, including invites, waitlist and promotion', () => {
    for (const type of [
      'auto_match_gestating',
      'auto_match_ready',
      'auto_match_created',
      'auto_match_cancelled',
      'auto_match_invite_expired',
      'auto_match_substitute_invite',
      'auto_match_substitute_joined',
      'auto_match_vacancy_reopened',
      'auto_match_waitlisted',
      'auto_match_starter_invite',
      'auto_match_promoted',
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

  test('post-materialization invites open the MATCH invitation view, never the gestation detail', () => {
    // El partido ya está creado: la gestación (y su chat) se cerraron. La
    // invitación se resuelve por proposal_id pero el destino visible es la
    // vista de invitación asociada al partido (?invite=), no ?proposal=.
    expect(buildAutoMatchNotificationRoute(
      notif('auto_match_substitute_invite', { proposal_id: 42, partido_id: 900, route: '/quiero-jugar?auto=1&invite=42' }),
    )).toBe('/quiero-jugar?auto=1&invite=42');
    expect(buildAutoMatchNotificationRoute(
      notif('auto_match_starter_invite', { proposal_id: 42, partido_id: 900, route: '/quiero-jugar?auto=1&invite=42' }),
    )).toBe('/quiero-jugar?auto=1&invite=42');
  });

  test('created + substitute-joined + vacancy-reopened + promoted open the real match', () => {
    expect(buildAutoMatchNotificationRoute(notif('auto_match_created', { proposal_id: 42, partido_id: 900 })))
      .toBe('/partido-publico/900');
    expect(buildAutoMatchNotificationRoute(notif('auto_match_substitute_joined', { proposal_id: 42, partido_id: 900 })))
      .toBe('/partido-publico/900');
    expect(buildAutoMatchNotificationRoute(notif('auto_match_vacancy_reopened', { proposal_id: 42, partido_id: 900 })))
      .toBe('/partido-publico/900');
    expect(buildAutoMatchNotificationRoute(notif('auto_match_promoted', { proposal_id: 42, partido_id: 900 })))
      .toBe('/partido-publico/900');
  });

  test('waitlisted goes to the general screen, not a closed gestation detail', () => {
    expect(buildAutoMatchNotificationRoute(notif('auto_match_waitlisted', { proposal_id: 42, route: '/quiero-jugar?auto=1' })))
      .toBe('/quiero-jugar?auto=1');
  });
});
