// Exact public web allowlist for the existing WhatsApp guest-invite contract.
// The database-backed validation still happens in PartidoInvitacion before any
// match data is rendered; this module only rejects malformed/non-invite URLs at
// the global web gate.
const PUBLIC_MATCH_INVITE_ROUTE_ALLOWLIST = Object.freeze([
  Object.freeze({
    pathnamePattern: '/partido/:partidoId/invitacion',
    requiredQueryParameters: Object.freeze([
      Object.freeze(['codigo', 'c']),
      Object.freeze(['invite', 'i']),
    ]),
  }),
]);

const PUBLIC_MATCH_INVITE_PATH_RE = /^\/partido\/([1-9]\d*)\/invitacion$/;
const MATCH_CODE_RE = /^[A-Za-z0-9]{4,16}$/;
const INVITE_TOKEN_RE = /^[a-f0-9]{32}$/i;

const getFirstQueryValue = (searchParams, names) => {
  for (const name of names) {
    const value = searchParams?.get?.(name);
    if (typeof value === 'string' && value.trim().length > 0) return value.trim();
  }
  return '';
};

const isExactPublicMatchInvitePath = (pathname) => (
  typeof pathname === 'string' && PUBLIC_MATCH_INVITE_PATH_RE.test(pathname)
);

const isAllowedPublicMatchInviteRequest = (url) => {
  if (!url || !isExactPublicMatchInvitePath(url.pathname)) return false;

  const matchCode = getFirstQueryValue(url.searchParams, ['codigo', 'c']);
  const inviteToken = getFirstQueryValue(url.searchParams, ['invite', 'i']);

  return MATCH_CODE_RE.test(matchCode) && INVITE_TOKEN_RE.test(inviteToken);
};

module.exports = {
  PUBLIC_MATCH_INVITE_ROUTE_ALLOWLIST,
  isAllowedPublicMatchInviteRequest,
  isExactPublicMatchInvitePath,
};
