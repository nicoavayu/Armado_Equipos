// Shared image-upload helper.
//
// Why this exists: several screens (team crest, team member photo, profile
// avatar, match photos) each had their own ad-hoc file handling. None of them
// normalized phone photos, so HEIC/HEIF pictures taken on iPhones — and very
// large JPEGs — either uploaded as a format the browser cannot render (blank
// crest on Android) or failed silently. Centralizing the logic guarantees a
// single, predictable behaviour: validate, normalize to a web-displayable
// image, and surface a clear error when the file truly cannot be processed.

export const DEFAULT_MAX_IMAGE_BYTES = 15 * 1024 * 1024; // hard cap on the raw input
const DEFAULT_MAX_DIMENSION = 1280;
const DEFAULT_JPEG_QUALITY = 0.85;
const REENCODE_SIZE_THRESHOLD = 1.5 * 1024 * 1024; // re-encode displayable images heavier than this

const HEIC_MIME_TYPES = ['image/heic', 'image/heif', 'image/heic-sequence', 'image/heif-sequence'];
const HEIC_EXTENSIONS = ['.heic', '.heif'];
const DISPLAYABLE_RASTER_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const PASSTHROUGH_TYPES = ['image/svg+xml', 'image/gif'];

const lowerType = (file) => String(file?.type || '').toLowerCase();
const lowerName = (file) => String(file?.name || '').toLowerCase();

export const isHeicFile = (file) => {
  if (!file) return false;
  if (HEIC_MIME_TYPES.includes(lowerType(file))) return true;
  const name = lowerName(file);
  return HEIC_EXTENSIONS.some((ext) => name.endsWith(ext));
};

export const isImageFile = (file) => {
  if (!file) return false;
  if (lowerType(file).startsWith('image/')) return true;
  // iOS occasionally hands over HEIC files with an empty MIME type.
  return isHeicFile(file);
};

// Pure validation so it can be unit tested without a DOM/canvas.
export const validateImageFile = (file, { maxBytes = DEFAULT_MAX_IMAGE_BYTES } = {}) => {
  if (!file) {
    return { ok: false, code: 'MISSING', message: 'No seleccionaste ninguna imagen.' };
  }
  if (!isImageFile(file)) {
    return {
      ok: false,
      code: 'NOT_IMAGE',
      message: 'Ese archivo no es una imagen. Elegí una foto JPG, PNG o WEBP.',
    };
  }
  if (Number.isFinite(file.size) && file.size > maxBytes) {
    const mb = Math.round(maxBytes / (1024 * 1024));
    return {
      ok: false,
      code: 'TOO_LARGE',
      message: `La imagen supera el máximo de ${mb} MB. Probá con una foto más liviana.`,
    };
  }
  return { ok: true };
};

// Pure resize math so it can be unit tested.
export const computeTargetSize = (width, height, maxDimension = DEFAULT_MAX_DIMENSION) => {
  const w = Math.max(1, Math.round(Number(width) || 0) || 1);
  const h = Math.max(1, Math.round(Number(height) || 0) || 1);
  const longest = Math.max(w, h);
  if (!Number.isFinite(maxDimension) || maxDimension <= 0 || longest <= maxDimension) {
    return { width: w, height: h, resized: false };
  }
  const ratio = maxDimension / longest;
  return {
    width: Math.max(1, Math.round(w * ratio)),
    height: Math.max(1, Math.round(h * ratio)),
    resized: true,
  };
};

const replaceExtension = (name, ext) => {
  const base = String(name || 'imagen').replace(/\.[^./\\]+$/, '').trim() || 'imagen';
  return `${base}.${ext}`;
};

const makeError = (message, code) => {
  const error = new Error(message);
  error.code = code;
  return error;
};

const loadImageElement = (objectUrl) => new Promise((resolve, reject) => {
  const img = new Image();
  img.decoding = 'async';
  img.onload = () => resolve(img);
  img.onerror = () => reject(makeError('decode-failed', 'DECODE_FAILED'));
  img.src = objectUrl;
});

const canvasToBlob = (canvas, type, quality) => new Promise((resolve, reject) => {
  if (typeof canvas.toBlob === 'function') {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(makeError('encode-failed', 'ENCODE_FAILED'))),
      type,
      quality,
    );
    return;
  }
  // Fallback for environments without canvas.toBlob.
  try {
    const dataUrl = canvas.toDataURL(type, quality);
    const [, base64] = dataUrl.split(',');
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    resolve(new Blob([bytes], { type }));
  } catch (err) {
    reject(makeError('encode-failed', 'ENCODE_FAILED'));
  }
});

/**
 * Normalize a user-selected image into a web-displayable file ready for upload.
 *
 * - Rejects non-images and oversized files with a clear, user-facing message.
 * - Passes SVG/GIF through untouched (vector / animation).
 * - Decodes the image; if it cannot be decoded (e.g. real HEIC on Android, or a
 *   corrupt file) it throws a clear error instead of failing silently.
 * - Re-encodes HEIC/HEIF, oversized photos and exotic formats to JPEG, keeping
 *   PNG sources as PNG so logo transparency is preserved. EXIF orientation is
 *   applied because the browser draws the already-oriented <img> onto the canvas.
 *
 * @returns {Promise<{ file: File, converted: boolean, width: number, height: number }>}
 */
export const prepareImageForUpload = async (file, options = {}) => {
  const {
    maxDimension = DEFAULT_MAX_DIMENSION,
    quality = DEFAULT_JPEG_QUALITY,
    maxBytes = DEFAULT_MAX_IMAGE_BYTES,
    forceJpeg = false,
  } = options;

  const validation = validateImageFile(file, { maxBytes });
  if (!validation.ok) {
    throw makeError(validation.message, validation.code);
  }

  const type = lowerType(file);
  const heic = isHeicFile(file);

  if (!heic && PASSTHROUGH_TYPES.includes(type)) {
    return { file, converted: false, width: 0, height: 0 };
  }

  const objectUrl = URL.createObjectURL(file);
  let img;
  try {
    img = await loadImageElement(objectUrl);
  } catch (err) {
    URL.revokeObjectURL(objectUrl);
    if (heic) {
      throw makeError(
        'No pudimos procesar esa foto HEIC. En tu teléfono cambiá el formato de cámara a "Más compatible" o elegí una foto JPG.',
        'HEIC_UNSUPPORTED',
      );
    }
    throw makeError(
      'No pudimos leer esa imagen. Probá con otra foto en formato JPG o PNG.',
      'DECODE_FAILED',
    );
  }

  const naturalW = img.naturalWidth || img.width || 0;
  const naturalH = img.naturalHeight || img.height || 0;
  const { width, height, resized } = computeTargetSize(naturalW, naturalH, maxDimension);

  const isPng = type === 'image/png';
  const isDisplayable = DISPLAYABLE_RASTER_TYPES.includes(type);
  const oversized = Number.isFinite(file.size) && file.size > REENCODE_SIZE_THRESHOLD;

  // Already a small, displayable raster that needs no resizing → keep as-is so we
  // never strip PNG transparency or recompress an already-light image.
  if (!heic && !forceJpeg && isDisplayable && !resized && !oversized) {
    URL.revokeObjectURL(objectUrl);
    return { file, converted: false, width: naturalW, height: naturalH };
  }

  const outputType = isPng && !forceJpeg ? 'image/png' : 'image/jpeg';
  const outputQuality = outputType === 'image/jpeg' ? quality : undefined;

  let blob;
  try {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw makeError('no-2d-context', 'ENCODE_FAILED');
    ctx.drawImage(img, 0, 0, width, height);
    blob = await canvasToBlob(canvas, outputType, outputQuality);
  } catch (err) {
    URL.revokeObjectURL(objectUrl);
    // If re-encoding failed but the source is already displayable, fall back to it.
    if (!heic && isDisplayable) {
      return { file, converted: false, width: naturalW, height: naturalH };
    }
    throw makeError(
      'No pudimos procesar la imagen. Probá con otra foto JPG o PNG.',
      'ENCODE_FAILED',
    );
  }
  URL.revokeObjectURL(objectUrl);

  const ext = outputType === 'image/png' ? 'png' : 'jpg';
  const normalized = new File([blob], replaceExtension(file.name, ext), {
    type: outputType,
    lastModified: Date.now(),
  });

  return { file: normalized, converted: true, width, height };
};

export default prepareImageForUpload;
