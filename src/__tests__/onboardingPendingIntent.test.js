import {
  isSafeHomeSurface,
  hasAuthRecoveryMarkers,
  hasPendingNativePushRedirect,
  hasPendingIntent,
} from '../features/onboarding/pendingIntent';

describe('isSafeHomeSurface', () => {
  test('true for idle Home', () => {
    expect(isSafeHomeSurface({ pathname: '/', search: '' })).toBe(true);
    expect(isSafeHomeSurface({ pathname: '/home', search: '' })).toBe(true);
  });

  test('false for any non-Home route (deep links live elsewhere)', () => {
    expect(isSafeHomeSurface({ pathname: '/votar-equipos', search: '?codigo=abc' })).toBe(false);
    expect(isSafeHomeSurface({ pathname: '/partido/5/invitacion', search: '?c=x&i=y' })).toBe(false);
    expect(isSafeHomeSurface({ pathname: '/quiero-jugar', search: '?auto=1' })).toBe(false);
  });

  test('false when Home carries an action param (voting/invite/proposal/admin)', () => {
    expect(isSafeHomeSurface({ pathname: '/', search: '?codigo=ABC' })).toBe(false);
    expect(isSafeHomeSurface({ pathname: '/', search: '?partidoId=12' })).toBe(false);
    expect(isSafeHomeSurface({ pathname: '/', search: '?invite=1' })).toBe(false);
    expect(isSafeHomeSurface({ pathname: '/', search: '?proposal=9' })).toBe(false);
    expect(isSafeHomeSurface({ pathname: '/', search: '?admin=historial' })).toBe(false);
  });
});

describe('hasAuthRecoveryMarkers', () => {
  test('detects password recovery / magic link markers', () => {
    expect(hasAuthRecoveryMarkers({ hash: '#type=recovery&access_token=abc', search: '' })).toBe(true);
    expect(hasAuthRecoveryMarkers({ hash: '', search: '?type=recovery' })).toBe(true);
    expect(hasAuthRecoveryMarkers({ hash: '#access_token=xyz', search: '' })).toBe(true);
  });

  test('false for a clean URL', () => {
    expect(hasAuthRecoveryMarkers({ hash: '', search: '' })).toBe(false);
  });
});

describe('hasPendingNativePushRedirect', () => {
  afterEach(() => window.sessionStorage.clear());

  test('true when a native push redirect is queued', () => {
    window.sessionStorage.setItem('pending_native_push_redirect', JSON.stringify({ route: '/x' }));
    expect(hasPendingNativePushRedirect()).toBe(true);
  });

  test('false when nothing is queued', () => {
    expect(hasPendingNativePushRedirect()).toBe(false);
  });
});

describe('hasPendingIntent', () => {
  afterEach(() => window.sessionStorage.clear());

  test('true when an auth flow is pending', () => {
    expect(hasPendingIntent({ pendingAuthFlow: { provider: 'google' } })).toBe(true);
  });

  test('true when a native push redirect is queued', () => {
    window.sessionStorage.setItem('pending_native_push_redirect', JSON.stringify({ route: '/x' }));
    expect(hasPendingIntent({})).toBe(true);
  });

  test('false when nothing is pending', () => {
    expect(hasPendingIntent({ pendingAuthFlow: null })).toBe(false);
  });
});
