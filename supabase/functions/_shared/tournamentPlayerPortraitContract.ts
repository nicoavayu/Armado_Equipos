export const TOURNAMENT_PLAYER_PORTRAITS_BUCKET = "tournament-player-portraits"
export const PORTRAIT_MAX_FILE_BYTES = 8 * 1024 * 1024
export const PORTRAIT_MAX_PIXELS = 36_000_000
export const PORTRAIT_MAX_EDGE = 12_000
export const PORTRAIT_SIGNED_URL_TTL_SECONDS = 300
export const PORTRAIT_ALLOWED_MIME = ["image/jpeg", "image/png", "image/webp"] as const
export const PORTRAIT_PATH_RE =
  /^organizations\/[0-9a-f-]{36}\/roster-players\/[0-9a-f-]{36}\/[0-9a-f-]{36}\.(?:jpg|png|webp)$/
