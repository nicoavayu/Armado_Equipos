/**
 * Fourth mirror of the Multimedia geometry contract.
 *
 * The same numbers already live in PostgreSQL
 * (`public.tournament_media_variant_geometry`), in the Deno shared module
 * (`supabase/functions/_shared/tournamentMediaContract.ts`) and in the browser
 * (`src/features/torneos/domain/mediaPipeline.js`). The worker ships as its own
 * container and cannot import any of them, so it carries a copy — and
 * `test/contract.test.mjs` pins this copy to the browser one, which the DB
 * suite already pins to PostgreSQL.
 */

export const TOURNAMENT_MEDIA_BUCKET = 'tournament-media';

export const MEDIA_MAX_FILE_BYTES = 12 * 1024 * 1024;
export const MEDIA_MAX_PIXELS = 36_000_000;
export const MEDIA_MAX_EDGE = 12_000;

export const MEDIA_ALLOWED_MIME = Object.freeze(['image/jpeg', 'image/png', 'image/webp']);
export const MEDIA_DERIVED_KINDS = Object.freeze(['thumbnail', 'grid', 'detail']);
export const MEDIA_VARIANT_KINDS = Object.freeze([...MEDIA_DERIVED_KINDS, 'original']);

export const MEDIA_VARIANT_BOX = Object.freeze({
  thumbnail: 320,
  grid: 800,
  detail: 1600,
});

export const MEDIA_EXTENSION_BY_MIME = Object.freeze({
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
});

export const MEDIA_SOURCE_PATH_RE =
  /^[0-9a-f-]{36}\/[0-9a-f-]{36}\/[0-9a-f-]{36}\/[0-9a-f-]{36}\.(jpg|png|webp)$/;

/** Deterministic "fit inside a box, never upscale". `floor(x + 0.5)` matches SQL. */
export function variantGeometry(kind, width, height) {
  const box = MEDIA_VARIANT_BOX[kind];
  if (!box) return null;
  const longest = Math.max(width, height);
  if (longest <= box) return { kind, width, height };
  return {
    kind,
    width: Math.max(1, Math.floor((width * box) / longest + 0.5)),
    height: Math.max(1, Math.floor((height * box) / longest + 0.5)),
  };
}

export function variantPlan(width, height) {
  return MEDIA_DERIVED_KINDS.map((kind) => variantGeometry(kind, width, height));
}

/**
 * `<...>.jpg` → `<...>-thumbnail.jpg`. The quarantined upload and every final
 * object are therefore different object names, and the variants table's own
 * CHECK constraint refuses anything that is not a derived name.
 */
export function variantObjectName(sourcePath, kind) {
  if (!MEDIA_SOURCE_PATH_RE.test(sourcePath)) throw new Error('MEDIA_PATH_INVALID');
  if (!MEDIA_VARIANT_KINDS.includes(kind)) throw new Error('MEDIA_KIND_INVALID');
  const match = sourcePath.match(/^(.*)\.(jpg|png|webp)$/);
  return `${match[1]}-${kind}.${match[2]}`;
}
