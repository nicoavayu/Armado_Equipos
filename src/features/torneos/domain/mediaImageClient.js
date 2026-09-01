/**
 * Browser-side decode, orientation and rendition production.
 *
 * The browser is the only place in this pipeline with a real image codec, so
 * it is where pixels are decoded and re-encoded. That is a UX and bandwidth
 * decision, not a trust decision: the processor re-derives the container, the
 * MIME, the dimensions, the byte size and the checksum from the bytes it
 * fetches back out of the bucket, and refuses anything whose geometry does not
 * match what it computed itself.
 *
 * What the browser is responsible for:
 *   - decoding the file at all (a file that will not decode never gets an
 *     upload session, so no quota is spent and no object is created);
 *   - applying EXIF orientation to the pixels, because the processor rejects
 *     any file that still carries a non-identity orientation tag;
 *   - producing output with no metadata, which a canvas re-encode does;
 *   - producing one metadata-free display object within the selected tier.
 */

import {
  MEDIA_LIMITS,
  MEDIA_TRANSCODABLE_MIME,
  MEDIA_UPLOAD_MIME,
} from './mediaPipeline';

const JPEG_QUALITY = 0.86;

export class MediaClientError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'MediaClientError';
    this.code = code;
  }
}

function hasCanvas() {
  return typeof document !== 'undefined'
    && typeof document.createElement === 'function'
    && typeof HTMLCanvasElement !== 'undefined';
}

/**
 * Decodes with orientation already applied where the browser supports it.
 * `createImageBitmap` with `imageOrientation: 'from-image'` is the only
 * mechanism that does this without us re-implementing EXIF rotation.
 */
async function decode(file) {
  if (typeof createImageBitmap === 'function') {
    try {
      return await createImageBitmap(file, { imageOrientation: 'from-image' });
    } catch {
      // Older Safari rejects the options bag rather than ignoring it.
      try {
        return await createImageBitmap(file);
      } catch {
        /* fall through to the <img> path */
      }
    }
  }
  if (typeof Image === 'undefined' || typeof URL?.createObjectURL !== 'function') {
    throw new MediaClientError('decode_unsupported', 'Este navegador no puede procesar la foto.');
  }
  const objectUrl = URL.createObjectURL(file);
  try {
    return await new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(
        new MediaClientError('decode_failed', 'No pudimos abrir esta imagen.'),
      );
      image.src = objectUrl;
    });
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

function dimensionsOf(source) {
  const width = source.width || source.naturalWidth || 0;
  const height = source.height || source.naturalHeight || 0;
  return { width, height };
}

/**
 * Pure geometry helper shared by the browser encoder and its contract tests.
 * Flooring is intentional: the resulting bitmap can never cross either the
 * longest-edge or decoded-pixel ceiling after scaling.
 */
export function fitMediaDimensions(width, height, limits = MEDIA_LIMITS) {
  const sourceWidth = Number(width);
  const sourceHeight = Number(height);
  if (!Number.isFinite(sourceWidth) || !Number.isFinite(sourceHeight)
    || sourceWidth < 1 || sourceHeight < 1) {
    return null;
  }
  const edgeScale = Math.min(
    1,
    Number(limits.maxEdge) / Math.max(sourceWidth, sourceHeight),
  );
  const pixelScale = Math.min(
    1,
    Math.sqrt(Number(limits.maxPixels) / (sourceWidth * sourceHeight)),
  );
  const scale = Math.min(edgeScale, pixelScale);
  return {
    width: Math.max(1, Math.floor(sourceWidth * scale)),
    height: Math.max(1, Math.floor(sourceHeight * scale)),
  };
}

function drawTo(source, width, height) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) {
    throw new MediaClientError('canvas_unavailable', 'Este navegador no puede procesar la foto.');
  }
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';
  context.drawImage(source, 0, 0, width, height);
  return canvas;
}

async function encode(canvas, mime, quality) {
  const blob = await new Promise((resolve) => {
    canvas.toBlob(resolve, mime, quality);
  });
  if (!blob || blob.size < 1) {
    throw new MediaClientError('encode_failed', 'No pudimos preparar esta foto.');
  }
  // Safari silently falls back to PNG when it cannot encode the requested type.
  if (blob.type && blob.type !== mime) {
    throw new MediaClientError(
      'encode_unsupported',
      'Este navegador no puede guardar ese formato. Probá con JPEG.',
    );
  }
  return blob;
}

/** The MIME the pipeline will store for a given input. */
export function targetMimeFor(file, { allowHeicTranscode = true } = {}) {
  const declared = String(file?.type || '').toLowerCase();
  if (MEDIA_UPLOAD_MIME.includes(declared)) return declared;
  if (allowHeicTranscode && MEDIA_TRANSCODABLE_MIME.includes(declared)) return 'image/jpeg';
  return null;
}

/**
 * Pre-flight validation on the raw selection. Deliberately permissive about
 * everything the processor will check anyway — this exists to keep obvious
 * mistakes out of the queue, not to be a security boundary.
 */
export function validateSelection(file, limits = MEDIA_LIMITS) {
  if (!file) return { valid: false, code: 'missing', message: 'Elegí un archivo.' };
  if (!targetMimeFor(file, { allowHeicTranscode: limits.allowHeicTranscode !== false })) {
    return {
      valid: false,
      code: 'mime',
      message: 'Formato no admitido. Usá JPEG, PNG o WebP.',
    };
  }
  if (!Number.isFinite(file.size) || file.size < 1) {
    return { valid: false, code: 'size', message: 'El archivo está vacío.' };
  }
  const maxSelectedFileBytes = Number(limits.maxSelectedFileBytes)
    || Number(limits.maxFileBytes) * 4;
  if (file.size > maxSelectedFileBytes) {
    return {
      valid: false,
      code: 'size',
      message: `La foto seleccionada supera los ${Math.floor(maxSelectedFileBytes / 1024 / 1024)} MB.`,
    };
  }
  return { valid: true, code: null, message: '' };
}

export async function sha256Hex(blob) {
  const buffer = await blob.arrayBuffer();
  const digest = await crypto.subtle.digest('SHA-256', buffer);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Turns a selected file into the single normalized object uploaded to
 * quarantine. Published variants, when required by PROCESSOR_EXTERNAL, remain
 * the trusted worker's responsibility.
 *
 * @returns {Promise<{
 *   mime: string, width: number, height: number,
 *   source: Blob,
 * }>}
 */
export async function prepareUploadPayload(file, { signal, limits = MEDIA_LIMITS } = {}) {
  if (!hasCanvas()) {
    throw new MediaClientError('canvas_unavailable', 'Este navegador no puede procesar la foto.');
  }
  const mime = targetMimeFor(file, {
    allowHeicTranscode: limits.allowHeicTranscode !== false,
  });
  if (!mime) {
    throw new MediaClientError('mime', 'Formato no admitido. Usá JPEG, PNG o WebP.');
  }

  const decoded = await decode(file);
  try {
    if (signal?.aborted) throw new MediaClientError('cancelled', 'Carga cancelada.');
    const decodedSize = dimensionsOf(decoded);
    if (decodedSize.width < 1 || decodedSize.height < 1) {
      throw new MediaClientError('decode_failed', 'No pudimos abrir esta imagen.');
    }

    // Fit the decoded pixels inside both server-enforced limits. This also
    // bakes the browser-corrected orientation into the single display image.
    const fitted = limits.resizeToFit === true
      ? fitMediaDimensions(decodedSize.width, decodedSize.height, limits)
      : decodedSize;
    if (fitted.width > limits.maxEdge || fitted.height > limits.maxEdge
      || fitted.width * fitted.height > limits.maxPixels) {
      throw new MediaClientError(
        'dimensions', 'La foto excede las dimensiones permitidas.',
      );
    }
    const initialWidth = fitted.width;
    const initialHeight = fitted.height;

    let source = null;
    let width = initialWidth;
    let height = initialHeight;
    const attempts = limits.resizeToFit === true ? 10 : 1;
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      if (signal?.aborted) throw new MediaClientError('cancelled', 'Carga cancelada.');
      const dimensionScale = limits.resizeToFit === true
        ? 0.88 ** Math.floor(attempt / 2) : 1;
      width = Math.max(1, Math.floor(initialWidth * dimensionScale));
      height = Math.max(1, Math.floor(initialHeight * dimensionScale));
      const quality = mime === 'image/png'
        ? undefined
        : Math.max(0.58, JPEG_QUALITY - (attempt * 0.04));
      // eslint-disable-next-line no-await-in-loop
      const candidate = await encode(drawTo(decoded, width, height), mime, quality);
      if (candidate.size <= limits.maxFileBytes) {
        source = candidate;
        break;
      }
    }
    if (!source) {
      throw new MediaClientError(
        'size',
        `La foto supera los ${Math.floor(limits.maxFileBytes / 1024 / 1024)} MB una vez optimizada.`,
      );
    }

    return { mime, width, height, source };
  } finally {
    if (typeof decoded.close === 'function') decoded.close();
  }
}

/**
 * A downscaled preview for the queue. Separate from the upload on purpose:
 * previews are throwaway and must not keep a full-size bitmap alive.
 */
export async function createPreviewUrl(file, maxEdge = 320) {
  if (!hasCanvas()) return '';
  try {
    const decoded = await decode(file);
    try {
      const { width, height } = dimensionsOf(decoded);
      if (width < 1 || height < 1) return '';
      const longest = Math.max(width, height);
      const scale = longest <= maxEdge ? 1 : maxEdge / longest;
      const canvas = drawTo(
        decoded,
        Math.max(1, Math.round(width * scale)),
        Math.max(1, Math.round(height * scale)),
      );
      return canvas.toDataURL('image/jpeg', 0.7);
    } finally {
      if (typeof decoded.close === 'function') decoded.close();
    }
  } catch {
    return '';
  }
}
