import {
  APP_SPACE,
  createDefaultSpaceNavigation,
  getSpaceFromPath,
  getSpaceNavigationStorageKey,
  getValidRouteForSpace,
  readSpaceNavigation,
  rememberSpaceRoute,
  writeSpaceNavigation,
} from '../features/space-navigation/spaceNavigation';

const USER_ID = 'user-123';

describe('space navigation persistence', () => {
  beforeEach(() => window.localStorage.clear());

  test('derives the visible space from the pathname', () => {
    expect(getSpaceFromPath('/desafios')).toBe(APP_SPACE.ARMA2);
    expect(getSpaceFromPath('/torneos')).toBe(APP_SPACE.TORNEOS);
    expect(getSpaceFromPath('/torneos/mis-torneos')).toBe(APP_SPACE.TORNEOS);
  });

  test('stores last space and independent routes per user', () => {
    writeSpaceNavigation(USER_ID, {
      lastSpace: APP_SPACE.TORNEOS,
      lastRoute: {
        arma2: '/desafios',
        torneos: '/torneos/mis-torneos',
      },
    });
    expect(readSpaceNavigation(USER_ID)).toEqual({
      lastSpace: APP_SPACE.TORNEOS,
      lastRoute: {
        arma2: '/desafios',
        torneos: '/torneos/mis-torneos',
      },
    });
    expect(window.localStorage.getItem(getSpaceNavigationStorageKey('other-user'))).toBeNull();
  });

  test('remembers each space without overwriting the other route', () => {
    rememberSpaceRoute(USER_ID, '/desafios');
    rememberSpaceRoute(USER_ID, '/torneos/mis-partidos');
    rememberSpaceRoute(USER_ID, '/amigos');

    expect(readSpaceNavigation(USER_ID)).toEqual({
      lastSpace: APP_SPACE.ARMA2,
      lastRoute: {
        arma2: '/amigos',
        torneos: '/torneos/mis-partidos',
      },
    });
  });

  test.each([
    'https://evil.example/steal',
    '//evil.example/steal',
    '/auth/callback',
    '/i/invitation-token',
    '/torneos/publico/public-slug',
    '/desafios?token=secret',
    '/torneos/../login',
    '/torneos/%2f%2fevil.example',
  ])('rejects unsafe or non-restorable route %s', (route) => {
    expect(getValidRouteForSpace(getSpaceFromPath(route), route)).toBeNull();
  });

  // La ruta canónica de torneo se guarda con su `?categoria=`: sin la query
  // deja de reproducir lo que la persona estaba viendo.
  test('keeps ?categoria= on a canonical tournament route', () => {
    const canonical = '/torneos/organizacion/org-1/torneo/torneo-1/fixture?categoria=cat-1';
    expect(getValidRouteForSpace(APP_SPACE.TORNEOS, canonical)).toBe(canonical);

    rememberSpaceRoute(USER_ID, canonical);
    expect(readSpaceNavigation(USER_ID).lastRoute.torneos).toBe(canonical);
  });

  test.each([
    '/torneos/organizacion/org-1/torneo/torneo-1/fixture?token=secret',
    '/torneos/organizacion/org-1/torneo/torneo-1/fixture?categoria=cat-1&token=secret',
    '/torneos/organizacion/org-1/torneo/torneo-1/fixture?categoria=../otro',
    '/torneos/organizacion/org-1/torneo/torneo-1/fixture?categoria=',
  ])('refuses to remember a route carrying anything but reproducible context: %s', (route) => {
    expect(getValidRouteForSpace(APP_SPACE.TORNEOS, route)).toBeNull();
  });

  test('a query cannot turn a non-restorable route into a restorable one', () => {
    expect(getValidRouteForSpace(APP_SPACE.TORNEOS, '/torneos/publico/slug?categoria=cat-1'))
      .toBeNull();
  });

  test('ignores invalid persisted routes and applies safe fallbacks', () => {
    window.localStorage.setItem(getSpaceNavigationStorageKey(USER_ID), JSON.stringify({
      lastSpace: 'torneos',
      lastRoute: {
        arma2: '/auth/callback',
        torneos: 'https://evil.example',
      },
    }));

    expect(readSpaceNavigation(USER_ID)).toEqual({
      lastSpace: APP_SPACE.TORNEOS,
      lastRoute: createDefaultSpaceNavigation().lastRoute,
    });
  });
});
