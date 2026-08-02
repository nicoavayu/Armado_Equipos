// Real libvips, real pixels. Nothing here is mocked: if these pass, the codec
// tier is genuinely present on this host, and if libvips is missing they fail
// loudly rather than silently degrading — which is the whole point of the
// capability being attested rather than assumed.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  CodecError,
  codecVersion,
  decodeSanitizedOriginal,
  inspectMetadataCarriers,
  loadSharp,
  renderVariant,
} from '../src/codec.mjs';

const sharp = await loadSharp();
const FIXTURES = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..', '..', '..', 'scripts', 'edge-functions', 'fixtures', 'tournament-media',
);

async function make({ width = 64, height = 48, mime = 'image/jpeg', dirty = false } = {}) {
  let pipeline = sharp({
    create: { width, height, channels: 3, background: { r: 20, g: 120, b: 60 } },
  });
  if (dirty) {
    pipeline = pipeline.withMetadata({
      orientation: 6,
      exif: { IFD0: { Artist: 'Arma2 QA', ImageDescription: 'cancha 3 - Nicolas' } },
      icc: 'srgb',
    });
  }
  const encoded = mime === 'image/png'
    ? await pipeline.png().toBuffer()
    : mime === 'image/webp'
      ? await pipeline.webp().toBuffer()
      : await pipeline.jpeg({ quality: 90 }).toBuffer();
  return new Uint8Array(encoded);
}

async function rejectsWith(action, code) {
  await assert.rejects(action, (error) => {
    assert.ok(error instanceof CodecError, `esperaba CodecError, vino ${error?.name}`);
    assert.equal(error.code, code);
    return true;
  });
}

test('el codec real está presente y se identifica', async () => {
  const version = await codecVersion();
  assert.equal(version.name, 'libvips');
  assert.match(version.version, /^\d+\.\d+/);
});

test('decodifica una imagen buena y mide sus dimensiones reales', async () => {
  const bytes = await make({ width: 64, height: 48 });
  const decoded = await decodeSanitizedOriginal(bytes, 'image/jpeg');
  assert.equal(decoded.width, 64);
  assert.equal(decoded.height, 48);
  assert.equal(decoded.pixelDecoded, true);
  assert.equal(decoded.pixelTranscoded, true);
});

test('un archivo que pasa los magic bytes pero falla el codec es rechazado', async () => {
  // Exactamente el caso que el verificador estructural aceptaba: cabecera JPEG
  // intacta, scan entrópico cortado. Sólo un decode real lo distingue.
  const bytes = await make({ width: 200, height: 150 });
  const truncated = bytes.subarray(0, Math.floor(bytes.length * 0.5));
  assert.equal(truncated[0], 0xff, 'la cabecera JPEG sigue ahí');
  assert.equal(truncated[1], 0xd8, 'y el SOI también');
  await rejectsWith(
    () => decodeSanitizedOriginal(truncated, 'image/jpeg'), 'MEDIA_CONTENT_CORRUPT',
  );
});

test('un PNG declarado como JPEG es rechazado', async () => {
  const png = await make({ mime: 'image/png' });
  await rejectsWith(() => decodeSanitizedOriginal(png, 'image/jpeg'), 'MEDIA_MIME_MISMATCH');
});

test('un SVG y un GIF nunca pasan como imagen del pipeline', async () => {
  const svg = new TextEncoder().encode(
    '<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg"><script/></svg>',
  );
  await rejectsWith(() => decodeSanitizedOriginal(svg, 'image/png'), 'MEDIA_CONTENT_CORRUPT');
  const gif = new Uint8Array(await sharp({
    create: { width: 8, height: 8, channels: 3, background: '#000' },
  }).gif().toBuffer());
  // Un GIF ni siquiera tiene MIME de destino en el contrato: muere antes.
  await rejectsWith(() => decodeSanitizedOriginal(gif, 'image/png'), 'MEDIA_MIME_UNSUPPORTED');
});

test('una bomba de descompresión muere en el presupuesto de píxeles', async () => {
  const bytes = await make({ width: 2000, height: 2000 });
  // El archivo es chico; lo que no cabe es el ráster. El límite es de píxeles,
  // no de bytes, que es la única forma de frenar una bomba.
  assert.ok(bytes.length < 1_000_000, 'el archivo comprimido es chico');
  await rejectsWith(
    () => decodeSanitizedOriginal(bytes, 'image/jpeg', { limits: { maxPixels: 1000 } }),
    'MEDIA_CONTENT_CORRUPT',
  );
});

test('una imagen animada es rechazada', async () => {
  // La misma muestra animada que ya usaban las pruebas del verificador
  // estructural, ahora contra el decoder real.
  const animated = new Uint8Array(
    fs.readFileSync(path.join(FIXTURES, 'animated-16x16.webp')),
  );
  await rejectsWith(
    () => decodeSanitizedOriginal(animated, 'image/webp'), 'MEDIA_ANIMATION_UNSUPPORTED',
  );
});

test('el original final no conserva EXIF, ICC ni orientación', async () => {
  const dirty = await make({ dirty: true });
  const before = await inspectMetadataCarriers(dirty);
  assert.equal(before.clean, false, 'la muestra realmente venía sucia');
  assert.ok(before.carriers.includes('exif'));
  assert.ok(before.carriers.includes('icc'));

  const sanitized = await decodeSanitizedOriginal(dirty, 'image/jpeg');
  const after = await inspectMetadataCarriers(sanitized.bytes);
  assert.deepEqual(after.carriers, [], `quedaron portadores: ${after.carriers}`);
  assert.equal(after.clean, true);
  // La orientación 6 se aplica a los píxeles, no se copia como tag.
  assert.equal(sanitized.orientationApplied, true);
  assert.equal(sanitized.width, 48);
  assert.equal(sanitized.height, 64);
});

test('el original final no es una copia de los bytes subidos', async () => {
  const bytes = await make();
  const sanitized = await decodeSanitizedOriginal(bytes, 'image/jpeg');
  assert.notEqual(Buffer.compare(Buffer.from(sanitized.bytes), Buffer.from(bytes)), 0);
});

test('las variantes salen de los píxeles decodificados con geometría exacta', async () => {
  const bytes = await make({ width: 4000, height: 3000 });
  const sanitized = await decodeSanitizedOriginal(bytes, 'image/jpeg');
  const expected = { thumbnail: [320, 240], grid: [800, 600], detail: [1600, 1200] };
  for (const [kind, [width, height]] of Object.entries(expected)) {
    const rendition = await renderVariant(
      sanitized.bytes, sanitized.mime, kind, sanitized.width, sanitized.height,
    );
    assert.equal(rendition.width, width, kind);
    assert.equal(rendition.height, height, kind);
    const carriers = await inspectMetadataCarriers(rendition.bytes);
    assert.deepEqual(carriers.carriers, [], `${kind} quedó con metadata`);
  }
});

test('una imagen chica nunca se agranda', async () => {
  const bytes = await make({ width: 100, height: 50 });
  const sanitized = await decodeSanitizedOriginal(bytes, 'image/jpeg');
  const detail = await renderVariant(
    sanitized.bytes, sanitized.mime, 'detail', sanitized.width, sanitized.height,
  );
  assert.equal(detail.width, 100);
  assert.equal(detail.height, 50);
});

test('un archivo vacío o demasiado grande no llega al decoder', async () => {
  await rejectsWith(() => decodeSanitizedOriginal(new Uint8Array(0), 'image/jpeg'), 'MEDIA_EMPTY');
  const bytes = await make();
  await rejectsWith(
    () => decodeSanitizedOriginal(bytes, 'image/jpeg', { limits: { maxBytes: 10 } }),
    'MEDIA_TOO_LARGE',
  );
  await rejectsWith(
    () => decodeSanitizedOriginal(bytes, 'image/gif'), 'MEDIA_MIME_UNSUPPORTED',
  );
});
