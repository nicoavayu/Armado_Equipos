// Authorized branding URLs (BRANDING-V1, hybrid composition). The Torneos gateway signs, once per response, only the
// branding the caller may see (published pages for everyone; the organization's own assets for its managers; the
// team's shield for its responsibles). The composition remembers each `path → signed URL` here and the existing image
// resolution reads it. Once a composition says that branding comes only from authorized URLs, a stored path never
// turns into a storage URL of another project: no authorized URL → no image → initials.
//
// Pure module: no client, no network, nothing persisted (memory of this tab only).
const BUCKET_SEGMENT = '/object/sign/tournament-branding/';
const PATH = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/(organizations|tournaments|teams)\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png|webp)$/;
// The gateway signs for one hour; an entry is dropped well before, so a page re-reads instead of showing a dead link.
export const AUTHORIZED_URL_TTL_MS = 50 * 60 * 1000;
const LOOPBACK = new Set(['127.0.0.1', 'localhost']);

const urls = new Map();
let authorizedOnly = false;

/** The composition's statement: branding comes only from URLs the gateway signed (never a public storage URL). */
export function requireAuthorizedBrandingUrls() {
  authorizedOnly = true;
}

export function brandingRequiresAuthorizedUrls() {
  return authorizedOnly;
}

/** A signed URL of exactly this object of the branding bucket, over https (or plain http only on loopback). */
export function isAuthorizedBrandingUrl(url, path) {
  if (typeof url !== 'string' || typeof path !== 'string' || !PATH.test(path)) return false;
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  const secure = parsed.protocol === 'https:' || (parsed.protocol === 'http:' && LOOPBACK.has(parsed.hostname));
  return secure
    && !parsed.username && !parsed.password && !parsed.hash
    && parsed.pathname.endsWith(`${BUCKET_SEGMENT}${path}`)
    && Boolean(parsed.searchParams.get('token'));
}

export function rememberAuthorizedBrandingUrl(path, url, now = Date.now()) {
  if (!isAuthorizedBrandingUrl(url, path)) return false;
  urls.set(path, { url, expiresAt: now + AUTHORIZED_URL_TTL_MS });
  return true;
}

export function authorizedBrandingUrl(path, now = Date.now()) {
  const entry = typeof path === 'string' ? urls.get(path) : null;
  if (!entry) return null;
  if (entry.expiresAt <= now) {
    urls.delete(path);
    return null;
  }
  return entry.url;
}

/** Account change / sign-out / tests: nothing signed for the previous session survives. */
export function forgetAuthorizedBrandingUrls({ resetMode = false } = {}) {
  urls.clear();
  if (resetMode) authorizedOnly = false;
}
