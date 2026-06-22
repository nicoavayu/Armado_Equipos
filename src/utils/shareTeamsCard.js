import logger from './logger';
import { SHARE_CARD_WIDTH } from '../components/share/ShareableTeamsCard';

// Renders a DOM node to a PNG and hands it to the native / web share sheet.
//
// Heavy deps (html-to-image, @capacitor/filesystem) are loaded lazily via
// dynamic import() so they stay off the cold-start bundle, matching the recent
// analytics/SDK deferral work.

const DEFAULT_FILE_NAME = 'equipos-arma2.png';
const DEFAULT_TITLE = 'Equipos armados';
const DEFAULT_TEXT = 'Equipos armados con Arma2 ⚽️';

const buildFileName = () => {
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
  return `equipos-arma2-${stamp}.png`;
};

const stripDataUrlPrefix = (dataUrl) => String(dataUrl || '').replace(/^data:[^;]+;base64,/, '');

/**
 * Captures a DOM node to a PNG data URL at the fixed card resolution.
 * @returns {Promise<string>} data URL (data:image/png;base64,...)
 */
export const captureNodeToPng = async (node) => {
  if (!node) throw new Error('No hay nada para exportar.');
  // Wait for fonts so Bebas/Oswald are embedded instead of falling back.
  if (typeof document !== 'undefined' && document.fonts?.ready) {
    try {
      await document.fonts.ready;
    } catch (_error) {
      // Non-fatal: continue with whatever fonts are available.
    }
  }
  const { toPng } = await import('html-to-image');
  // Width is fixed; height is left to the node so the card hugs its content.
  return toPng(node, {
    width: SHARE_CARD_WIDTH,
    pixelRatio: 1,
    cacheBust: true,
    backgroundColor: '#0d0820',
  });
};

/**
 * Native share: persist the PNG to the cache dir, then open the OS share sheet.
 * @returns {Promise<{ok:boolean, reason?:string}>}
 */
export const shareImageNative = async ({ dataUrl, fileName, title, text }) => {
  const { Filesystem, Directory } = await import('@capacitor/filesystem');
  const { Share } = await import('@capacitor/share');

  const writeResult = await Filesystem.writeFile({
    path: fileName,
    data: stripDataUrlPrefix(dataUrl),
    directory: Directory.Cache,
  });

  const fileUri = writeResult?.uri
    || (await Filesystem.getUri({ path: fileName, directory: Directory.Cache }))?.uri;

  await Share.share({ title, text, files: [fileUri] });
  return { ok: true };
};

/**
 * Web share: prefer the Web Share API (level 2, with files); otherwise open the
 * image in a new tab so the user can save/share it manually.
 * @returns {Promise<{ok:boolean, reason?:string}>}
 */
export const shareImageWeb = async ({ dataUrl, fileName, title, text }) => {
  try {
    const res = await fetch(dataUrl);
    const blob = await res.blob();
    const file = new File([blob], fileName, { type: 'image/png' });

    if (navigator.canShare?.({ files: [file] }) && navigator.share) {
      await navigator.share({ title, text, files: [file] });
      return { ok: true };
    }
  } catch (error) {
    logger.warn('[shareTeamsCard] Web share with files failed, falling back', error);
  }

  // Fallback: surface the image so the user can long-press / save it.
  const opened = typeof window !== 'undefined'
    ? window.open(dataUrl, '_blank', 'noopener,noreferrer')
    : null;
  if (!opened) return { ok: false, reason: 'share-unavailable' };
  return { ok: true, reason: 'fallback-open' };
};

/**
 * Captures the card node and shares it as an image. Never throws: returns a
 * { ok, reason } result so callers can drive UI without try/catch.
 *
 * @param {Object} params
 * @param {HTMLElement} params.node - The rendered card node to capture.
 * @param {boolean} [params.isNative] - Capacitor native platform flag.
 * @param {string} [params.fileName]
 * @param {string} [params.title]
 * @param {string} [params.text]
 * @returns {Promise<{ok:boolean, reason?:string}>}
 */
export const exportAndShareTeamsCard = async ({
  node,
  isNative = false,
  fileName,
  title = DEFAULT_TITLE,
  text = DEFAULT_TEXT,
} = {}) => {
  const name = fileName || buildFileName() || DEFAULT_FILE_NAME;
  try {
    const dataUrl = await captureNodeToPng(node);
    if (isNative) {
      return await shareImageNative({ dataUrl, fileName: name, title, text });
    }
    return await shareImageWeb({ dataUrl, fileName: name, title, text });
  } catch (error) {
    // A user cancelling the native share sheet is not an error.
    const message = String(error?.message || error || '').toLowerCase();
    if (message.includes('cancel') || message.includes('abort')) {
      return { ok: false, reason: 'cancelled' };
    }
    logger.error('[shareTeamsCard] Failed to export/share teams card', error);
    return { ok: false, reason: 'export-failed' };
  }
};

export default exportAndShareTeamsCard;
