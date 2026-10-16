import {
  isHeicFile,
  isImageFile,
  validateImageFile,
  computeTargetSize,
  DEFAULT_MAX_IMAGE_BYTES,
  IMAGE_UPLOAD_ACCEPT,
  SVG_REJECTED_MESSAGE,
  UPLOAD_RASTER_TYPES,
  isSvgFile,
  looksLikeSvgMarkup,
  prepareImageForUpload,
  sniffSvgContent,
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

describe('SVG is never accepted (public team-crests bucket → stored XSS)', () => {
  const svgMarkup = '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>';
  const contentFile = (content, name, type) => new File([content], name, { type });

  test('isSvgFile detects SVG by MIME type and by extension', () => {
    expect(isSvgFile(makeFile({ name: 'escudo.svg', type: 'image/svg+xml' }))).toBe(true);
    expect(isSvgFile(makeFile({ name: 'escudo', type: 'image/svg+xml' }))).toBe(true);
    expect(isSvgFile(makeFile({ name: 'ESCUDO.SVG', type: '' }))).toBe(true);
    expect(isSvgFile(makeFile({ name: 'escudo.svgz', type: 'application/octet-stream' }))).toBe(true);
    expect(isSvgFile(makeFile({ name: 'escudo.png', type: 'image/png' }))).toBe(false);
    expect(isSvgFile(null)).toBe(false);
  });

  test('validateImageFile rejects SVG with a clear Spanish message', () => {
    [
      makeFile({ name: 'escudo.svg', type: 'image/svg+xml' }),
      makeFile({ name: 'escudo.svg', type: '' }),
      makeFile({ name: 'foto', type: 'image/svg+xml' }),
    ].forEach((file) => {
      expect(validateImageFile(file)).toEqual({
        ok: false,
        code: 'SVG_NOT_ALLOWED',
        message: SVG_REJECTED_MESSAGE,
      });
    });
    expect(SVG_REJECTED_MESSAGE).toMatch(/no aceptamos imágenes svg/i);
    expect(SVG_REJECTED_MESSAGE).toMatch(/JPG, PNG o WEBP/);
  });

  test('looksLikeSvgMarkup detects SVG/XML markup but not raster headers', () => {
    expect(looksLikeSvgMarkup(svgMarkup)).toBe(true);
    expect(looksLikeSvgMarkup('﻿  <?xml version="1.0"?><svg/>')).toBe(true);
    expect(looksLikeSvgMarkup('<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN"><svg/>')).toBe(true);
    expect(looksLikeSvgMarkup('\u0089PNG\r\n\u001a\n')).toBe(false);
    expect(looksLikeSvgMarkup('ÿØÿàJFIF')).toBe(false);
    expect(looksLikeSvgMarkup('RIFF....WEBPVP8 ')).toBe(false);
    expect(looksLikeSvgMarkup('')).toBe(false);
  });

  test('sniffSvgContent reads the file head', async () => {
    await expect(sniffSvgContent(contentFile(svgMarkup, 'escudo.png', 'image/png'))).resolves.toBe(true);
    const png = contentFile(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a]), 'a.png', 'image/png');
    await expect(sniffSvgContent(png)).resolves.toBe(false);
    await expect(sniffSvgContent(null)).resolves.toBe(false);
  });

  test('prepareImageForUpload rejects an SVG instead of passing it through', async () => {
    await expect(prepareImageForUpload(contentFile(svgMarkup, 'escudo.svg', 'image/svg+xml')))
      .rejects.toMatchObject({ code: 'SVG_NOT_ALLOWED', message: SVG_REJECTED_MESSAGE });
  });

  test.each([
    ['escudo.png', 'image/png'],
    ['foto.jpg', 'image/jpeg'],
    ['foto.heic', ''],
  ])('prepareImageForUpload rejects SVG markup disguised as %s', async (name, type) => {
    await expect(prepareImageForUpload(contentFile(svgMarkup, name, type)))
      .rejects.toMatchObject({ code: 'SVG_NOT_ALLOWED', message: SVG_REJECTED_MESSAGE });
  });

  test('picker accept list and upload raster types never include SVG', () => {
    expect(IMAGE_UPLOAD_ACCEPT).not.toMatch(/svg/i);
    expect(IMAGE_UPLOAD_ACCEPT.split(',')).toEqual(
      expect.arrayContaining(['image/png', 'image/jpeg', 'image/webp']),
    );
    expect(UPLOAD_RASTER_TYPES).toEqual(['image/jpeg', 'image/png', 'image/webp']);
  });
});
