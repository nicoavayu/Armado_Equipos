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
import { adaptSnapshotToResultsContent } from './resultsContent';
import { resolveResultsVariant } from './resultsVariants';
import {
  DEFAULT_SOCIAL_THEME,
  resolveSocialTheme,
} from './socialThemes';
import {
  normalizeSocialBranding,
  resolveBrandingAccent,
} from './socialBranding';
import { getResultsThemeLayout } from './resultsThemeLayouts';

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
export function createSocialAssetPlan(snapshot, editorial, content = null, options = {}) {
  const paths = new Set();
  if (content?.kind === 'results') {
    content.matches.forEach((match) => {
      if (match.home?.shieldPath) paths.add(match.home.shieldPath);
      if (match.away?.shieldPath) paths.add(match.away.shieldPath);
    });
  } else {
    // Temporary bridge for pieces not migrated to a content model in Phase 1.
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
  }
  const branding = normalizeSocialBranding(options.branding, content);
  const includeResultsBrand = content?.kind === 'results';
  return Object.freeze({
    shieldPaths: Object.freeze(Array.from(paths).sort()),
    photoAssetId: editorial.photoAssetId || null,
    branding: Object.freeze({
      tournamentLogoUrl: includeResultsBrand ? branding.tournamentLogo : null,
      officialLockupUrl: includeResultsBrand ? options.brandAssetUrls?.lockup || null : null,
    }),
  });
}

export async function resolveSocialAssets(snapshot, editorial, {
  signMediaReadUrls, resolveShieldUrl, signal, assetPlan,
} = {}) {
  const shields = {};
  const plan = assetPlan || createSocialAssetPlan(snapshot, editorial);
  let photo = null;
  const branding = { tournamentLogo: null, officialLockup: null };
  try {
    await Promise.all(plan.shieldPaths.map(async (path) => {
      let url = null;
      try {
        url = typeof resolveShieldUrl === 'function' ? resolveShieldUrl(path) : null;
      } catch {
        // A crest remains optional; the layout will draw its monogram fallback.
      }
      shields[path] = url ? await loadBitmap(url, { signal }) : null;
    }));

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
    branding.tournamentLogo = plan.branding?.tournamentLogoUrl
      ? await loadBitmap(plan.branding.tournamentLogoUrl, { signal }) : null;
    if (plan.branding?.officialLockupUrl) {
      branding.officialLockup = await loadBitmap(plan.branding.officialLockupUrl, { signal });
      if (!branding.officialLockup) {
        throw new SocialRenderError('ASSET_BRAND_UNAVAILABLE', 'official-lockup');
      }
    }
    return { shields, photo, branding };
  } catch (error) {
    releaseSocialAssets({ shields, photo, branding });
    throw error;
  }
}

/**
 * Draws one piece. Pure: same snapshot plus same editorial state plus same
 * assets always produces the same sequence of canvas operations.
 */
export function drawSocialPiece(ctx, {
  snapshot,
  content = null,
  editorial,
  assets,
  format,
  theme = DEFAULT_SOCIAL_THEME,
  variant = null,
  branding = null,
}) {
  const normalizedBranding = normalizeSocialBranding(branding, content);
  const selectedTheme = snapshot.piece === 'round_results'
    ? resolveSocialTheme(theme) : DEFAULT_SOCIAL_THEME;
  const accent = resolveBrandingAccent(
    normalizedBranding,
    accentValue(editorial.accent, selectedTheme),
    selectedTheme,
  );
  if (snapshot.piece === 'round_results') {
    const resultsContent = content || adaptSnapshotToResultsContent(snapshot, editorial);
    const resultsVariant = variant || resolveResultsVariant({
      matchCount: resultsContent.matches.length,
      format: editorial.format,
    });
    const layout = getResultsThemeLayout(selectedTheme.id);
    layout(ctx, {
      snapshot, content: resultsContent, editorial, accent, assets, format,
      theme: selectedTheme, variant: resultsVariant, branding: normalizedBranding,
    });
    return;
  }
  const template = getSocialTemplate(snapshot.piece);
  if (!template) throw new SocialRenderError('TEMPLATE_MISSING', snapshot.piece);
  const body = drawFrame(ctx, format, {
    snapshot, editorial, accent, theme: DEFAULT_SOCIAL_THEME,
  });
  template(ctx, {
    snapshot, editorial, body, accent, assets, format, theme: DEFAULT_SOCIAL_THEME,
  });
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== 'object') return value;
  return Object.keys(value).sort().reduce((result, key) => {
    result[key] = stableValue(value[key]);
    return result;
  }, {});
}

export function createSocialRenderKey({
  snapshot, content, editorial, format, theme, variant, assetPlan, branding,
}) {
  return JSON.stringify(stableValue({
    piece: snapshot.piece,
    content: content || snapshot,
    editorial,
    format: format.id,
    theme,
    variant,
    branding: normalizeSocialBranding(branding, content),
    assets: assetPlan,
  }));
}

/**
 * Full render. Refuses before drawing rather than producing a partial piece:
 * an invalid snapshot, an unfinished human selection or an asset the user
 * chose and we cannot resolve all stop here.
 */
export async function prepareSocialRender({
  snapshot,
  editorial,
  organizationId,
  signMediaReadUrls,
  resolveShieldUrl,
  createCanvas,
  signal,
  skipFonts = false,
  theme = DEFAULT_SOCIAL_THEME,
  branding = null,
  brandAssetUrls = null,
  onStatus,
}) {
  validateSocialSnapshot(snapshot, { organizationId });
  assertNoPrivateData(snapshot);
  const gap = describeCurationGap(snapshot, editorial);
  if (gap) throw new SocialRenderError('CURATION_REQUIRED', gap);

  const content = snapshot.piece === 'round_results'
    ? adaptSnapshotToResultsContent(snapshot, editorial)
    : null;
  const variant = content ? resolveResultsVariant({
    matchCount: content.matches.length,
    format: editorial.format,
  }) : null;
  const selectedTheme = content ? resolveSocialTheme(theme) : DEFAULT_SOCIAL_THEME;
  const normalizedBranding = normalizeSocialBranding(branding, content);
  const assetPlan = createSocialAssetPlan(snapshot, editorial, content, {
    branding: normalizedBranding,
    brandAssetUrls,
  });
  onStatus?.('loading');
  if (!skipFonts) await ensureSocialFonts();
  let assets = null;
  try {
    assets = await resolveSocialAssets(snapshot, editorial, {
      signMediaReadUrls, resolveShieldUrl, signal, assetPlan,
    });
    onStatus?.('rendering');
    const { canvas, format } = createSocialCanvas(editorial.format, createCanvas);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new SocialRenderError('CANVAS_UNAVAILABLE');
    drawSocialPiece(ctx, {
      snapshot, content, editorial, assets, format, theme: selectedTheme, variant,
      branding: normalizedBranding,
    });
    const renderKey = createSocialRenderKey({
      snapshot, content, editorial, format, theme: selectedTheme, variant, assetPlan,
      branding: normalizedBranding,
    });
    return {
      canvas, format, content, theme: selectedTheme, variant, assets, assetPlan,
      branding: normalizedBranding, brandAssetUrls, renderKey,
    };
  } catch (error) {
    releaseSocialAssets(assets);
    throw error;
  }
}

export async function renderSocialPiece(options) {
  return prepareSocialRender(options);
}

export async function exportSocialPiece(options) {
  if (Object.prototype.hasOwnProperty.call(options, 'prepared') && !options.prepared) {
    throw new SocialRenderError('RENDER_NOT_READY');
  }
  const prepared = options.prepared || await prepareSocialRender(options);
  const { canvas, format } = prepared;
  let expectedRenderKey = options.expectedRenderKey;
  if (!expectedRenderKey && options.prepared && options.snapshot && options.editorial) {
    const content = options.snapshot.piece === 'round_results'
      ? adaptSnapshotToResultsContent(options.snapshot, options.editorial)
      : null;
    const variant = content ? resolveResultsVariant({
      matchCount: content.matches.length,
      format: options.editorial.format,
    }) : null;
    const expectedFormat = SOCIAL_FORMATS[options.editorial.format] || SOCIAL_FORMATS.portrait;
    expectedRenderKey = createSocialRenderKey({
      snapshot: options.snapshot,
      content,
      editorial: options.editorial,
      format: expectedFormat,
      theme: prepared.theme,
      variant,
      branding: prepared.branding,
      assetPlan: createSocialAssetPlan(options.snapshot, options.editorial, content, {
        branding: prepared.branding,
        brandAssetUrls: prepared.brandAssetUrls,
      }),
    });
  }
  if (expectedRenderKey && prepared.renderKey !== expectedRenderKey) {
    throw new SocialRenderError('RENDER_STALE');
  }
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
  Object.values(assets.branding || {}).forEach(close);
}

export function releasePreparedSocialRender(prepared) {
  releaseSocialAssets(prepared?.assets);
}

export function replacePreparedSocialRender(preparedRef, nextPrepared) {
  const previous = preparedRef.current;
  preparedRef.current = nextPrepared;
  if (previous !== nextPrepared) releasePreparedSocialRender(previous);
}
