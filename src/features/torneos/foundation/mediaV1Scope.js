// MEDIA-V1 scope snapshot of the gateway contract (torneos-gateway/media-v1-rpc-allowlist.json); guards verify equality.
// The baseline gallery contract on the authenticated route (organizer: galleries, review, cover / order, publication,
// retiring content, reports; participant: published galleries and the private report) plus the gateway's two media
// routes. Opt-in: the client permits it only when the composition says so (`media: true`); the gateway
// (TORNEOS_MEDIA_MODE) and the database (00000000000012_media_gallery_v1.sql) decide what is served.
const features = {
  "media_management": [
    "get_tournament_media_admin_context",
    "get_tournament_media_upload_capability",
    "get_tournament_media_asset_processing_tiers",
    "get_tournament_season_media_usage",
    "create_tournament_media_gallery",
    "update_tournament_media_gallery",
    "cancel_tournament_media_upload_session",
    "transition_tournament_media_asset",
    "set_tournament_media_cover",
    "reorder_tournament_media_item",
    "publish_tournament_media_gallery",
    "change_tournament_media_gallery_state",
    "handle_tournament_media_report"
  ],
  "media_participant": [
    "get_published_tournament_media",
    "report_tournament_media_asset"
  ]
};

export const mediaV1Scope = Object.freeze(Object.fromEntries(
  Object.entries(features).map(([feature, names]) => [feature, Object.freeze([...names])]),
));
const OPERATIONS = new Set(Object.values(features).flat());

export function isMediaV1Operation(operation) {
  return OPERATIONS.has(operation);
}

// The gateway's two media routes (torneos-gateway/media.ts).
export const MEDIA_UPLOAD_ROUTE = '/torneos/media/v1/upload';
export const MEDIA_URLS_ROUTE = '/torneos/media/v1/urls';
export const MEDIA_UPLOAD_TYPES = Object.freeze(['image/jpeg', 'image/png', 'image/webp']);
export const MEDIA_UPLOAD_MAX_BYTES = 4 * 1024 * 1024;
export const MEDIA_THUMBNAIL_MAX_BYTES = 512 * 1024;
export const MEDIA_READ_KINDS = Object.freeze(['thumbnail', 'grid', 'detail']);
export const MEDIA_URLS_MAX_ITEMS = 120;
