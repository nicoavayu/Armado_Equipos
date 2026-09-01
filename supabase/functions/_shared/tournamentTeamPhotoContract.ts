export const TOURNAMENT_TEAM_PHOTOS_BUCKET = "tournament-team-photos"
export const TEAM_PHOTO_MAX_FILE_BYTES = 8 * 1024 * 1024
export const TEAM_PHOTO_MAX_PIXELS = 36_000_000
export const TEAM_PHOTO_MAX_EDGE = 12_000
export const TEAM_PHOTO_SIGNED_URL_TTL_SECONDS = 300
export const TEAM_PHOTO_ALLOWED_MIME = ["image/jpeg", "image/png", "image/webp"] as const
export const TEAM_PHOTO_PATH_RE =
  /^organizations\/[0-9a-f-]{36}\/team-entries\/[0-9a-f-]{36}\/[0-9a-f-]{36}\.(?:jpg|png|webp)$/
