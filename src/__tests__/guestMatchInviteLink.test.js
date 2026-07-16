import { buildGuestMatchInviteLink } from '../utils/guestMatchInviteLink';

describe('WhatsApp guest match invitation link', () => {
  test('preserves the existing route and short c/i parameters exactly', () => {
    expect(buildGuestMatchInviteLink({
      baseUrl: 'https://app.arma2.com.ar/',
      matchId: 321,
      matchCode: 'H03G61',
      inviteToken: '0123456789abcdef0123456789abcdef',
    })).toBe(
      'https://app.arma2.com.ar/partido/321/invitacion?c=H03G61&i=0123456789abcdef0123456789abcdef',
    );
  });
});
