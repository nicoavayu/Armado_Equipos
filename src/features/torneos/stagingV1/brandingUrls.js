// BRANDING-V1 in the hybrid composition: what the gateway signed becomes the only way a branding path turns into an
// image. For every object of a response, a path with a valid signed URL of that exact object is remembered and kept;
// any other path is dropped (null), exactly as before branding existed, so a page never resolves it against another
// project's storage. The URL keys themselves never reach the pages: they keep reading paths.
import {
  rememberAuthorizedBrandingUrl,
  requireAuthorizedBrandingUrls,
} from '../domain/brandingUrlRegistry';

const URL_KEYS = Object.freeze({ logoPath: 'logoUrl', organizationLogoPath: 'organizationLogoUrl', shieldPath: 'shieldUrl' });
const URL_KEY_NAMES = new Set(Object.values(URL_KEYS));

function walk(value) {
  if (Array.isArray(value)) return value.map(walk);
  if (!value || typeof value !== 'object') return value;
  const out = {};
  for (const [key, item] of Object.entries(value)) {
    if (URL_KEY_NAMES.has(key)) continue;
    if (key in URL_KEYS) {
      out[key] = typeof item === 'string' && rememberAuthorizedBrandingUrl(item, value[URL_KEYS[key]]) ? item : null;
    } else {
      out[key] = walk(item);
    }
  }
  return out;
}

export function withSignedBranding(value) {
  requireAuthorizedBrandingUrls();
  return walk(value);
}
