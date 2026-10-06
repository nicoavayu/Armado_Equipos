// BRANDING-V1 scope snapshot of the gateway contract (torneos-gateway/branding-v1-rpc-allowlist.json); guards verify
// equality. The existing branding contract on the authenticated route (switch a durable reference, read the
// organization's branding context) plus the object route of one versioned object. Opt-in: the client permits it only
// when the composition says so (`branding: true`); the gateway (TORNEOS_BRANDING_MODE) and the database
// (00000000000010_branding_v1.sql, storage RLS) decide what is served.
const features = {
  "branding_assets": [
    "set_tournament_branding_reference",
    "get_tournament_branding_context"
  ]
};

export const brandingV1Scope = Object.freeze(Object.fromEntries(
  Object.entries(features).map(([feature, names]) => [feature, Object.freeze([...names])]),
));
const OPERATIONS = new Set(Object.values(features).flat());

export function isBrandingV1Operation(operation) {
  return OPERATIONS.has(operation);
}

// The one public read BRANDING-V1 adds to the anonymous route: the public page's logos.
export const brandingV1PublicScope = Object.freeze({ public_pages: Object.freeze(['get_public_tournament_branding']) });
export function isBrandingV1PublicOperation(operation) {
  return operation === 'get_public_tournament_branding';
}

/** One versioned object of the branding bucket: `<org>/<organizations|tournaments|teams>/<entity>/<uuid>.<ext>`. */
export const BRANDING_OBJECT_PATH = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/(organizations|tournaments|teams)\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png|webp)$/;
