/**
 * The real codec tier.
 *
 * Everything the Edge processor could not do lives here, because here there is
 * libvips. Each exported function DECODES PIXELS — a container walk is not a
 * decode and never substitutes for one:
 *
 *   * `decodeSanitizedOriginal` fully decodes the quarantined bytes, applies
 *     the EXIF orientation to the pixels, drops every metadata carrier and
 *     re-encodes from the decoded raster. The result — not the uploaded
 *     bytes — is what becomes the publishable original.
 *   * `renderVariant` derives each rendition from those same decoded pixels.
 *     Nothing the browser produced is ever published.
 *
 * Limits are enforced by libvips itself rather than by inspection:
 *   * `limitInputPixels` caps the decompressed raster, which is what stops a
 *     decompression bomb — a 40 KB PNG that expands to 20 GB fails to decode
 *     instead of exhausting the container.
 *   * `failOn: 'warning'` turns "structurally valid but semantically broken"
 *     into an error. This is the case the structural verifier accepted.
 *   * `.timeout()` bounds wall-clock time per image.
 *   * `MEDIA_MAX_EDGE` bounds either side independently of the pixel budget.
 */

import {
  MEDIA_ALLOWED_MIME,
  MEDIA_EXTENSION_BY_MIME,
  MEDIA_MAX_EDGE,
  MEDIA_MAX_FILE_BYTES,
  MEDIA_MAX_PIXELS,
  variantGeometry,
} from './contract.mjs';

export class CodecError extends Error {
  constructor(code, detail) {
    super(detail ? `${code}: ${detail}` : code);
    this.name = 'CodecError';
    this.code = code;
  }
}

/** libvips format name → the MIME we store it as. */
const FORMAT_TO_MIME = Object.freeze({
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
});

export const DEFAULT_LIMITS = Object.freeze({
  maxBytes: MEDIA_MAX_FILE_BYTES,
  maxPixels: MEDIA_MAX_PIXELS,
  maxEdge: MEDIA_MAX_EDGE,
  timeoutSeconds: 20,
  /** libvips operation cache, in bytes. Bounds resident memory per worker. */
  cacheBytes: 64 * 1024 * 1024,
});

let sharpModule = null;

/**
 * Loaded lazily and injectable, so the pure decision logic in `pipeline.mjs`
 * stays testable on a host without libvips — while everything in THIS module
 * refuses to pretend when libvips is missing.
 */
export async function loadSharp(inject) {
  if (inject) {
    sharpModule = inject;
    return sharpModule;
  }
  if (sharpModule) return sharpModule;
  try {
    const imported = await import('sharp');
    sharpModule = imported.default || imported;
  } catch (error) {
    throw new CodecError('CODEC_UNAVAILABLE', error?.message || 'sharp not installed');
  }
  sharpModule.cache({ memory: Math.floor(DEFAULT_LIMITS.cacheBytes / (1024 * 1024)) });
  sharpModule.concurrency(1);
  return sharpModule;
}

export async function codecVersion() {
  const sharp = await loadSharp();
  return {
    name: 'libvips',
    version: String(sharp.versions?.vips || '0'),
    binding: `sharp@${String(sharp.versions?.sharp || '0')}`,
  };
}

function open(sharp, bytes, limits) {
  return sharp(bytes, {
    // The decompression-bomb gate. libvips refuses before allocating.
    limitInputPixels: limits.maxPixels,
    sequentialRead: true,
    // Any recoverable decode warning — truncated scan, bad Huffman table,
    // premature EOI — is fatal here.
    failOn: 'warning',
    animated: false,
  }).timeout({ seconds: limits.timeoutSeconds });
}

function encoderFor(pipeline, mime) {
  switch (mime) {
    case 'image/jpeg':
      return pipeline.jpeg({ quality: 88, chromaSubsampling: '4:2:0', mozjpeg: false });
    case 'image/png':
      return pipeline.png({ compressionLevel: 9, palette: false });
    case 'image/webp':
      return pipeline.webp({ quality: 88 });
    default:
      throw new CodecError('MEDIA_MIME_UNSUPPORTED', mime);
  }
}

async function probe(sharp, bytes, declaredMime, limits) {
  if (!(bytes instanceof Uint8Array) || bytes.length < 1) {
    throw new CodecError('MEDIA_EMPTY');
  }
  if (bytes.length > limits.maxBytes) throw new CodecError('MEDIA_TOO_LARGE');
  if (!MEDIA_ALLOWED_MIME.includes(declaredMime)) {
    throw new CodecError('MEDIA_MIME_UNSUPPORTED', declaredMime);
  }
  let metadata;
  try {
    metadata = await open(sharp, bytes, limits).metadata();
  } catch (error) {
    throw new CodecError('MEDIA_CONTENT_CORRUPT', error?.message);
  }
  const actualMime = FORMAT_TO_MIME[metadata.format];
  if (!actualMime) throw new CodecError('MEDIA_MIME_UNSUPPORTED', String(metadata.format));
  // The container the bytes really are, versus the one the session reserved.
  // An SVG, a GIF, a ZIP or a `.png` that is really a JPEG dies here.
  if (actualMime !== declaredMime) {
    throw new CodecError('MEDIA_MIME_MISMATCH', `${actualMime} != ${declaredMime}`);
  }
  // `animated: false` makes libvips read the first frame only, so `pages` on
  // that handle is always 1. Counting frames needs its own read.
  let frames = 1;
  try {
    const animatedProbe = await sharp(bytes, {
      limitInputPixels: limits.maxPixels,
      failOn: 'warning',
      animated: true,
    }).timeout({ seconds: limits.timeoutSeconds }).metadata();
    frames = Number(animatedProbe.pages || 1);
  } catch {
    // A file that cannot even be opened as animated is handled by the decode
    // below; it is not evidence of animation.
    frames = 1;
  }
  if (frames > 1) {
    throw new CodecError('MEDIA_ANIMATION_UNSUPPORTED', `${frames} pages`);
  }
  const width = Number(metadata.width || 0);
  const height = Number(metadata.height || 0);
  if (width < 1 || height < 1
    || width > limits.maxEdge || height > limits.maxEdge
    || width * height > limits.maxPixels) {
    throw new CodecError('MEDIA_DIMENSIONS_INVALID', `${width}x${height}`);
  }
  return { metadata, actualMime, width, height };
}

/**
 * Full decode → orientation normalisation → metadata strip → re-encode.
 *
 * The returned buffer shares no bytes with the input: it is produced from the
 * decoded raster, so an EXIF block, an ICC profile, an XMP packet, a PNG text
 * chunk, a trailing ZIP or an appended payload cannot survive it, whether or
 * not this code knows the carrier exists.
 */
export async function decodeSanitizedOriginal(bytes, declaredMime, options = {}) {
  const limits = { ...DEFAULT_LIMITS, ...(options.limits || {}) };
  const sharp = await loadSharp(options.sharp);
  const { metadata, width, height } = await probe(sharp, bytes, declaredMime, limits);

  let output;
  try {
    output = await encoderFor(
      // `.rotate()` with no argument bakes the EXIF orientation into the
      // pixels; the tag itself is then gone because nothing is copied over.
      open(sharp, bytes, limits).rotate(),
      declaredMime,
    ).toBuffer({ resolveWithObject: true });
  } catch (error) {
    throw new CodecError('MEDIA_CONTENT_CORRUPT', error?.message);
  }

  const orientation = Number(metadata.orientation || 1);
  const rotated = orientation >= 5 && orientation <= 8;
  return {
    bytes: new Uint8Array(output.data),
    mime: declaredMime,
    extension: MEDIA_EXTENSION_BY_MIME[declaredMime],
    // Post-rotation geometry: the DB derives the variant boxes from these, so
    // they must describe the sanitised original, not the uploaded one.
    width: rotated ? height : width,
    height: rotated ? width : height,
    sourceWidth: width,
    sourceHeight: height,
    exifOrientation: orientation === 1 ? null : orientation,
    orientationApplied: rotated,
    pixelDecoded: true,
    pixelTranscoded: true,
    metadataStripped: true,
  };
}

/**
 * One rendition, derived from the SANITISED original's pixels. Never from the
 * uploaded bytes and never from anything a browser produced.
 */
export async function renderVariant(sanitizedBytes, mime, kind, width, height, options = {}) {
  const limits = { ...DEFAULT_LIMITS, ...(options.limits || {}) };
  const sharp = await loadSharp(options.sharp);
  const target = variantGeometry(kind, width, height);
  if (!target) throw new CodecError('MEDIA_KIND_INVALID', kind);
  let output;
  try {
    output = await encoderFor(
      open(sharp, sanitizedBytes, limits).resize({
        width: target.width,
        height: target.height,
        fit: 'fill',
        withoutEnlargement: false,
        kernel: 'lanczos3',
      }),
      mime,
    ).toBuffer({ resolveWithObject: true });
  } catch (error) {
    throw new CodecError('MEDIA_CONTENT_CORRUPT', error?.message);
  }
  if (output.info.width !== target.width || output.info.height !== target.height) {
    throw new CodecError('MEDIA_VARIANT_GEOMETRY', `${kind} ${output.info.width}x${output.info.height}`);
  }
  return {
    kind,
    bytes: new Uint8Array(output.data),
    mime,
    width: target.width,
    height: target.height,
    pixelTranscoded: true,
    metadataStripped: true,
  };
}

/**
 * Reads back what an object actually contains. Used to prove, after writing,
 * that the stored bytes still carry no metadata — the check that turns
 * "we stripped it" into "the object is clean".
 */
export async function inspectMetadataCarriers(bytes, options = {}) {
  const limits = { ...DEFAULT_LIMITS, ...(options.limits || {}) };
  const sharp = await loadSharp(options.sharp);
  let metadata;
  try {
    metadata = await open(sharp, bytes, limits).metadata();
  } catch (error) {
    throw new CodecError('MEDIA_CONTENT_CORRUPT', error?.message);
  }
  const carriers = [];
  if (metadata.exif) carriers.push('exif');
  if (metadata.icc) carriers.push('icc');
  if (metadata.xmp) carriers.push('xmp');
  if (metadata.iptc) carriers.push('iptc');
  if (metadata.comments && metadata.comments.length > 0) carriers.push('comments');
  if (metadata.orientation && Number(metadata.orientation) !== 1) carriers.push('orientation');
  return { carriers, clean: carriers.length === 0, width: metadata.width, height: metadata.height };
}
