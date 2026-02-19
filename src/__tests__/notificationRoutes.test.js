import { buildNotificationFallbackRoute, extractNotificationMatchId } from '../utils/notificationRoutes';

describe('notificationRoutes', () => {
  test('extracts match id from supported payload fields', () => {
    expect(extractNotificationMatchId({ data: { matchId: 123 } })).toBe(123);
    expect(extractNotificationMatchId({ data: { match_id: 456 } })).toBe(456);
    expect(extractNotificationMatchId({ partido_id: 789 })).toBe(789);
    expect(extractNotificationMatchId({ match_ref: '111' })).toBe('111');
  });

  test('builds fallback route to match when id exists', () => {
    const route = buildNotificationFallbackRoute({ data: { matchId: 42 } });
    expect(route).toBe('/partido-publico/42');
  });

  test('builds fallback route to activity feed when id is missing', () => {
    const route = buildNotificationFallbackRoute({});
    expect(route).toBe('/quiero-jugar');
  });
});

