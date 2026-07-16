import publicVotingRoutes from '../config/publicVotingRoutes';
import publicMatchInviteRoutes from '../config/publicMatchInviteRoutes';
import { PUBLIC_APP_ORIGIN } from './publicAppUrl';

const { isAllowedPublicVotingRequest } = publicVotingRoutes;
const { isAllowedPublicMatchInviteRequest } = publicMatchInviteRoutes;
const SENSITIVE_QUERY_KEYS = new Set([
  'access_token',
  'c',
  'code',
  'codigo',
  'i',
  'id_token',
  'invite',
  'refresh_token',
  'token',
]);

const parseUrl = (incomingUrl) => {
  if (incomingUrl instanceof URL) return incomingUrl;
  const rawUrl = String(incomingUrl || '').trim();
  if (!rawUrl) return null;
  return new URL(rawUrl, PUBLIC_APP_ORIGIN);
};

export function getNativeAppLinkRoute(incomingUrl) {
  let parsed;
  try {
    parsed = parseUrl(incomingUrl);
  } catch {
    return null;
  }

  if (!parsed || parsed.origin !== PUBLIC_APP_ORIGIN) return null;
  if (
    !isAllowedPublicVotingRequest(parsed)
    && !isAllowedPublicMatchInviteRequest(parsed)
  ) {
    return null;
  }

  return `${parsed.pathname}${parsed.search}${parsed.hash}`;
}

export function redactUrlForLog(incomingUrl) {
  const rawUrl = String(incomingUrl || '').trim();
  if (!rawUrl) return '';

  try {
    const isRelative = rawUrl.startsWith('/');
    const parsed = parseUrl(rawUrl);
    for (const key of Array.from(parsed.searchParams.keys())) {
      if (SENSITIVE_QUERY_KEYS.has(key.toLowerCase())) {
        parsed.searchParams.set(key, '[redacted]');
      }
    }
    if (parsed.hash) parsed.hash = '[redacted]';

    if (isRelative) return `${parsed.pathname}${parsed.search}${parsed.hash}`;
    return parsed.toString();
  } catch {
    return '[unparseable-url]';
  }
}
