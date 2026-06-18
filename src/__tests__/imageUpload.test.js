import {
  isHeicFile,
  isImageFile,
  validateImageFile,
  computeTargetSize,
  DEFAULT_MAX_IMAGE_BYTES,
} from '../utils/imageUpload';

const makeFile = ({ name = 'photo.jpg', type = 'image/jpeg', size = 1024 } = {}) => {
  const file = new File([new Uint8Array(1)], name, { type });
  // jsdom File size is derived from contents; override for size-based assertions.
  Object.defineProperty(file, 'size', { value: size, configurable: true });
  return file;
};

describe('isHeicFile', () => {
  test('detects HEIC/HEIF by MIME type', () => {
    expect(isHeicFile(makeFile({ type: 'image/heic' }))).toBe(true);
    expect(isHeicFile(makeFile({ type: 'image/heif' }))).toBe(true);
  });

  test('detects HEIC by extension even when the MIME type is empty', () => {
    expect(isHeicFile(makeFile({ name: 'IMG_0001.HEIC', type: '' }))).toBe(true);
    expect(isHeicFile(makeFile({ name: 'IMG_0001.heif', type: '' }))).toBe(true);
  });

  test('returns false for regular images', () => {
    expect(isHeicFile(makeFile({ name: 'a.jpg', type: 'image/jpeg' }))).toBe(false);
    expect(isHeicFile(null)).toBe(false);
  });
});

describe('isImageFile', () => {
  test('accepts image/* and HEIC with empty type', () => {
    expect(isImageFile(makeFile({ type: 'image/png' }))).toBe(true);
    expect(isImageFile(makeFile({ name: 'x.heic', type: '' }))).toBe(true);
  });

  test('rejects non-images', () => {
    expect(isImageFile(makeFile({ name: 'a.pdf', type: 'application/pdf' }))).toBe(false);
    expect(isImageFile(null)).toBe(false);
  });
});

describe('validateImageFile', () => {
  test('passes a normal image', () => {
    expect(validateImageFile(makeFile())).toEqual({ ok: true });
  });

  test('rejects missing file with a clear message', () => {
    const result = validateImageFile(null);
    expect(result.ok).toBe(false);
    expect(result.code).toBe('MISSING');
    expect(result.message).toMatch(/no seleccionaste/i);
  });

  test('rejects non-images with a clear message', () => {
    const result = validateImageFile(makeFile({ name: 'a.pdf', type: 'application/pdf' }));
    expect(result.ok).toBe(false);
    expect(result.code).toBe('NOT_IMAGE');
  });

  test('rejects oversized files with a clear message', () => {
    const result = validateImageFile(makeFile({ size: DEFAULT_MAX_IMAGE_BYTES + 1 }));
    expect(result.ok).toBe(false);
    expect(result.code).toBe('TOO_LARGE');
    expect(result.message).toMatch(/máximo/i);
  });

  test('honours a custom maxBytes', () => {
    const result = validateImageFile(makeFile({ size: 2048 }), { maxBytes: 1024 });
    expect(result.ok).toBe(false);
    expect(result.code).toBe('TOO_LARGE');
  });
});

describe('computeTargetSize', () => {
  test('keeps dimensions below the cap untouched', () => {
    expect(computeTargetSize(800, 600, 1280)).toEqual({ width: 800, height: 600, resized: false });
  });

  test('scales down a landscape photo preserving aspect ratio', () => {
    const { width, height, resized } = computeTargetSize(4000, 3000, 1280);
    expect(resized).toBe(true);
    expect(width).toBe(1280);
    expect(height).toBe(960);
  });

  test('scales down a portrait photo preserving aspect ratio', () => {
    const { width, height, resized } = computeTargetSize(3000, 4000, 1280);
    expect(resized).toBe(true);
    expect(height).toBe(1280);
    expect(width).toBe(960);
  });

  test('never returns a zero dimension', () => {
    const { width, height } = computeTargetSize(0, 0, 1280);
    expect(width).toBeGreaterThanOrEqual(1);
    expect(height).toBeGreaterThanOrEqual(1);
  });
});
