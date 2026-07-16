export function buildGuestMatchInviteLink({ baseUrl, matchId, matchCode, inviteToken }) {
  const normalizedBaseUrl = String(baseUrl || '').replace(/\/+$/, '');

  return `${normalizedBaseUrl}/partido/${matchId}/invitacion?c=${encodeURIComponent(matchCode)}&i=${encodeURIComponent(inviteToken)}`;
}
