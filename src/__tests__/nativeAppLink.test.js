import { getNativeAppLinkRoute, redactUrlForLog } from '../utils/nativeAppLink';

const INVITE_TOKEN = '0123456789abcdef0123456789abcdef';

describe('canonical native app links', () => {
  test('opens only valid canonical voting and invitation links', () => {
    expect(getNativeAppLinkRoute(
      'https://app.arma2.com.ar/votar-equipos?codigo=H03G61',
    )).toBe('/votar-equipos?codigo=H03G61');
    expect(getNativeAppLinkRoute(
      `https://app.arma2.com.ar/partido/321/invitacion?c=H03G61&i=${INVITE_TOKEN}`,
    )).toBe(`/partido/321/invitacion?c=H03G61&i=${INVITE_TOKEN}`);
    expect(getNativeAppLinkRoute(
      `https://app.arma2.com.ar/partido/321/invitacion?codigo=H03G61&invite=${INVITE_TOKEN}`,
    )).toBe(`/partido/321/invitacion?codigo=H03G61&invite=${INVITE_TOKEN}`);
  });

  test.each([
    'https://app.arma2.com.ar/votar-equipos',
    'https://app.arma2.com.ar/partido/321/invitacion?c=H03G61&i=invalid',
    `https://arma2.vercel.app/partido/321/invitacion?c=H03G61&i=${INVITE_TOKEN}`,
    'https://app.arma2.com.ar/profile',
    'https://www.arma2.com.ar/votar-equipos?codigo=H03G61',
  ])('rejects non-public or non-canonical URL %s', (url) => {
    expect(getNativeAppLinkRoute(url)).toBeNull();
  });

  test('redacts codes, tokens and fragments before logging', () => {
    const sensitive = `https://app.arma2.com.ar/partido/321/invitacion?c=H03G61&i=${INVITE_TOKEN}#secret`;
    const safe = redactUrlForLog(sensitive);

    expect(safe).not.toContain('H03G61');
    expect(safe).not.toContain(INVITE_TOKEN);
    expect(safe).not.toContain('secret');
    expect(safe).toContain('redacted');
  });
});
