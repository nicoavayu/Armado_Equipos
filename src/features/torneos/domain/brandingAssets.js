import { supabase } from '../../../services/api/supabase';
import { BRANDING_BUCKET, isVersionedBrandingPath } from './brandingFiles';
import { authorizedBrandingUrl, brandingRequiresAuthorizedUrls } from './brandingUrlRegistry';

export {
  BRANDING_ALLOWED_MIME,
  BRANDING_BUCKET,
  BRANDING_LIMITS,
  buildBrandingPath,
  isVersionedBrandingPath,
  prepareBrandingFile,
  validateBrandingFile,
} from './brandingFiles';

const LEGACY_TEAM_PATH = /^[a-zA-Z0-9][a-zA-Z0-9._/-]{0,511}$/;

export function resolveBrandingAssetUrl({ kind, path }, client = supabase) {
  if (!path || /^https?:\/\//i.test(path)) return null;
  // BRANDING-V1: a URL the gateway signed for this exact object wins; in the hybrid composition it is the only source.
  const authorized = authorizedBrandingUrl(path);
  if (authorized) return authorized;
  if (brandingRequiresAuthorizedUrls()) return null;
  let bucket = BRANDING_BUCKET;
  if (!isVersionedBrandingPath(path, kind)) {
    // Read-only compatibility for global Arma2 team crests that predate the
    // Torneos branding domain. New Torneos writes never use this bucket.
    if (kind !== 'team' || !LEGACY_TEAM_PATH.test(path) || path.includes('..')) return null;
    bucket = 'team-crests';
  }
  const { data } = client.storage.from(bucket).getPublicUrl(path);
  return data?.publicUrl || null;
}

export function resolveBrandingAssetCandidates({
  kind,
  path = null,
  fallbackPath = null,
}, client = supabase) {
  return [
    resolveBrandingAssetUrl({ kind, path }, client),
    fallbackPath
      ? resolveBrandingAssetUrl({ kind: 'organization', path: fallbackPath }, client)
      : null,
  ].filter((value, index, values) => value && values.indexOf(value) === index);
}
