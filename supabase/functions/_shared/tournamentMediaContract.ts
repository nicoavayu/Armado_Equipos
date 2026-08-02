// supabase/functions/_shared/tournamentMediaContract.ts
//
// The one place where the media pipeline's shared constants live on the Deno
// side. Mirrors, bit for bit:
//   * `public.tournament_media_variant_box` / `_geometry` (PostgreSQL)
//   * `src/features/torneos/domain/mediaPipeline.js` (browser)
// A drift between the three is a test failure, not a runtime surprise.

export const TOURNAMENT_MEDIA_BUCKET = "tournament-media"

export const MEDIA_MAX_FILE_BYTES = 12 * 1024 * 1024
export const MEDIA_MAX_PIXELS = 36_000_000
export const MEDIA_MAX_EDGE = 12_000
export const MEDIA_SIGNED_URL_TTL_SECONDS = 300
export const MEDIA_UPLOAD_URL_TTL_SECONDS = 300

export const MEDIA_ALLOWED_MIME = ["image/jpeg", "image/png", "image/webp"] as const
export type MediaMime = (typeof MEDIA_ALLOWED_MIME)[number]

export const MEDIA_DERIVED_KINDS = ["thumbnail", "grid", "detail"] as const
export type MediaDerivedKind = (typeof MEDIA_DERIVED_KINDS)[number]
export type MediaVariantKind = MediaDerivedKind | "original"

export const MEDIA_VARIANT_BOX: Record<MediaDerivedKind, number> = {
  thumbnail: 320,
  grid: 800,
  detail: 1600,
}

export const MEDIA_EXTENSION_BY_MIME: Record<MediaMime, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
}

/**
 * Deterministic "fit inside a box, never upscale" geometry.
 * floor(x + 0.5) keeps PostgreSQL, TypeScript and the browser in agreement.
 */
export function variantGeometry(
  kind: MediaDerivedKind,
  width: number,
  height: number,
): { kind: MediaDerivedKind; width: number; height: number } {
  const box = MEDIA_VARIANT_BOX[kind]
  const longest = Math.max(width, height)
  if (longest <= box) return { kind, width, height }
  return {
    kind,
    width: Math.max(1, Math.floor((width * box) / longest + 0.5)),
    height: Math.max(1, Math.floor((height * box) / longest + 0.5)),
  }
}

export function variantPlan(width: number, height: number) {
  return MEDIA_DERIVED_KINDS.map((kind) => variantGeometry(kind, width, height))
}

/** `<uuid>/<uuid>/<uuid>/<uuid>.ext` — exactly what the DB check constraint allows. */
export const MEDIA_SOURCE_PATH_RE =
  /^[0-9a-f-]{36}\/[0-9a-f-]{36}\/[0-9a-f-]{36}\/[0-9a-f-]{36}\.(jpg|png|webp)$/

export function variantObjectName(sourcePath: string, kind: MediaVariantKind): string {
  const match = sourcePath.match(/^(.*)\.(jpg|png|webp)$/)
  if (!match || !MEDIA_SOURCE_PATH_RE.test(sourcePath)) {
    throw new Error("MEDIA_PATH_INVALID")
  }
  return `${match[1]}-${kind}.${match[2]}`
}
