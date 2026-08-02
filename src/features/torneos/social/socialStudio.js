/**
 * Render, export and share for the Estudio Social.
 *
 * Private assets never reach the renderer as a URL. A signed URL is fetched,
 * turned into a bitmap, and dropped: a PNG must not carry a credential, and an
 * exported piece must keep working after the signature expires.
 */

import {
  SOCIAL_FORMATS,
  assertNoPrivateData,
  describeCurationGap,
  findSocialPiece,
  socialFileName,
  validateSocialSnapshot,
} from './socialContracts';
import {
  accentValue,
  canvasToPngBlob,
  createSocialCanvas,
  drawFrame,
  ensureSocialFonts,
} from './socialRenderer';
import { getSocialTemplate } from './socialTemplates';

export class SocialRenderError extends Error {
  constructor(code, detail = '') {
    super(detail ? `${code}: ${detail}` : code);
    this.name = 'SocialRenderError';
    this.code = code;
  }
}

/**
 * Loads a bitmap from a URL and forgets the URL.
 *
 * `createImageBitmap` on a blob keeps nothing referencing the signed URL, so
 * neither the canvas nor the exported PNG can leak it.
 */
export async function loadBitmap(url, { signal } = {}) {
  if (!url) return null;
  try {
    const response = await fetch(url, { signal, credentials: 'omit' });
    if (!response.ok) return null;
    const blob = await response.blob();
    if (typeof createImageBitmap === 'function') return await createImageBitmap(blob);
    if (typeof Image === 'undefined') return null;
    const objectUrl = URL.createObjectURL(blob);
    try {
      return await new Promise((resolve) => {
        const image = new Image();
        image.onload = () => resolve(image);
        image.onerror = () => resolve(null);
        image.src = objectUrl;
      });
    } finally {
      URL.revokeObjectURL(objectUrl);
    }
  } catch {
    return null;
  }
}

/**
 * Resolves every asset a piece may draw.
 *
 * Crests come from their existing paths; the photograph, when one is chosen,
 * comes through the Multimedia signer, which is what enforces publication,
 * audience and consent. A missing asset is a fallback, never a failure — but a
 * photo the user explicitly chose and that cannot be resolved IS a failure,
 * because silently dropping it would produce a piece they did not ask for.
 */
export async function resolveSocialAssets(snapshot, editorial, {
  signMediaReadUrls, resolveShieldUrl, signal,
} = {}) {
  const shields = {};
  const paths = new Set();
  const collect = (value) => {
    if (!value || typeof value !== 'object') return;
    if (Array.isArray(value)) {
      value.forEach(collect);
      return;
    }
    if (typeof value.shieldPath === 'string' && value.shieldPath) paths.add(value.shieldPath);
    Object.values(value).forEach(collect);
  };
  collect(snapshot.official);

  await Promise.all(Array.from(paths).map(async (path) => {
    const url = typeof resolveShieldUrl === 'function' ? resolveShieldUrl(path) : null;
    shields[path] = url ? await loadBitmap(url, { signal }) : null;
  }));

  let photo = null;
  if (editorial.photoAssetId) {
    if (typeof signMediaReadUrls !== 'function') {
      throw new SocialRenderError('ASSET_PHOTO_UNAVAILABLE', 'multimedia is not available');
    }
    const urls = await signMediaReadUrls(
      [{ assetId: editorial.photoAssetId, kind: 'detail' }], { signal },
    );
    const url = urls[`${editorial.photoAssetId}:detail`];
    if (!url) {
      // Unpublished, unauthorised, consent revoked, or still processing.
      throw new SocialRenderError('ASSET_PHOTO_FORBIDDEN', editorial.photoAssetId);
    }
    photo = await loadBitmap(url, { signal });
    if (!photo) throw new SocialRenderError('ASSET_PHOTO_UNAVAILABLE', editorial.photoAssetId);
  }
  return { shields, photo };
}

/**
 * Draws one piece. Pure: same snapshot plus same editorial state plus same
 * assets always produces the same sequence of canvas operations.
 */
export function drawSocialPiece(ctx, { snapshot, editorial, assets, format }) {
  const template = getSocialTemplate(snapshot.piece);
  if (!template) throw new SocialRenderError('TEMPLATE_MISSING', snapshot.piece);
  const accent = accentValue(editorial.accent);
  const body = drawFrame(ctx, format, { snapshot, editorial, accent });
  template(ctx, { snapshot, editorial, body, accent, assets, format });
}

/**
 * Full render. Refuses before drawing rather than producing a partial piece:
 * an invalid snapshot, an unfinished human selection or an asset the user
 * chose and we cannot resolve all stop here.
 */
export async function renderSocialPiece({
  snapshot,
  editorial,
  organizationId,
  signMediaReadUrls,
  resolveShieldUrl,
  createCanvas,
  signal,
  skipFonts = false,
}) {
  validateSocialSnapshot(snapshot, { organizationId });
  assertNoPrivateData(snapshot);
  const gap = describeCurationGap(snapshot, editorial);
  if (gap) throw new SocialRenderError('CURATION_REQUIRED', gap);

  if (!skipFonts) await ensureSocialFonts();
  const assets = await resolveSocialAssets(snapshot, editorial, {
    signMediaReadUrls, resolveShieldUrl, signal,
  });

  const { canvas, format } = createSocialCanvas(editorial.format, createCanvas);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new SocialRenderError('CANVAS_UNAVAILABLE');
  drawSocialPiece(ctx, { snapshot, editorial, assets, format });
  return { canvas, format };
}

export async function exportSocialPiece(options) {
  const { canvas, format } = await renderSocialPiece(options);
  const blob = await canvasToPngBlob(canvas);
  const expected = SOCIAL_FORMATS[options.editorial.format] || SOCIAL_FORMATS.portrait;
  if (canvas.width !== expected.width || canvas.height !== expected.height) {
    throw new SocialRenderError(
      'FORMAT_MISMATCH', `${canvas.width}x${canvas.height}`,
    );
  }
  return {
    blob,
    format,
    fileName: socialFileName(options.snapshot, options.editorial),
    pieceLabel: findSocialPiece(options.snapshot.piece)?.label || options.snapshot.piece,
  };
}

/**
 * Share, then download. `canShare({files})` is checked before offering the
 * sheet because several browsers advertise `share` and reject files; a
 * cancelled sheet is not an error and must not fall through to a download the
 * user did not ask for.
 */
export async function shareSocialPiece({ blob, fileName, title }) {
  const file = typeof File === 'function'
    ? new File([blob], fileName, { type: 'image/png' })
    : null;
  if (file && navigator?.canShare?.({ files: [file] }) && navigator.share) {
    try {
      await navigator.share({ files: [file], title });
      return { shared: true, downloaded: false };
    } catch (error) {
      if (error?.name === 'AbortError') return { shared: false, downloaded: false };
      // Anything else: fall through to the download.
    }
  }
  downloadSocialPiece({ blob, fileName });
  return { shared: false, downloaded: true };
}

export function downloadSocialPiece({ blob, fileName }) {
  const url = URL.createObjectURL(blob);
  try {
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = fileName;
    anchor.rel = 'noopener';
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  } finally {
    // Revoked on the next tick so the navigation has already started.
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }
}

/** Frees every bitmap a render allocated. Called on unmount and per re-render. */
export function releaseSocialAssets(assets) {
  if (!assets) return;
  const close = (bitmap) => {
    if (bitmap && typeof bitmap.close === 'function') bitmap.close();
  };
  Object.values(assets.shields || {}).forEach(close);
  close(assets.photo);
}
