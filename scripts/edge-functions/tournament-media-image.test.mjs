// Exercises the Edge Function image verifier from Node.
//
// The module ships to Deno as TypeScript and is never bundled by the repo's
// build, so it would otherwise have no automated coverage at all. Transpiling
// it here keeps the real shipped source under test against real image files
// produced by real encoders (see fixtures/tournament-media/README.md).

import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';

const repoRoot = process.cwd();
const sharedRoot = path.join(repoRoot, 'supabase', 'functions', '_shared');
const fixturesRoot = path.join(
  repoRoot, 'scripts', 'edge-functions', 'fixtures', 'tournament-media',
);

const MODULES = [
  'tournamentMediaContract.ts',
  'tournamentMediaImage.ts',
  'tournamentMediaSelfTest.ts',
];

async function loadEdgeModules() {
  const outDir = await fs.mkdtemp(path.join(os.tmpdir(), 'arma2-media-edge-'));
  for (const name of MODULES) {
    const source = await fs.readFile(path.join(sharedRoot, name), 'utf8');
    const { outputText } = ts.transpileModule(source, {
      compilerOptions: {
        module: ts.ModuleKind.ESNext,
        target: ts.ScriptTarget.ES2022,
        isolatedModules: true,
      },
      fileName: name,
    });
    await fs.writeFile(
      path.join(outDir, name.replace(/\.ts$/, '.mjs')),
      outputText.replace(/(from\s+["']\.\/[A-Za-z]+)\.ts(["'])/g, '$1.mjs$2'),
      'utf8',
    );
  }
  const load = (name) => import(
    pathToFileURL(path.join(outDir, `${name}.mjs`)).href
  );
  return {
    contract: await load('tournamentMediaContract'),
    image: await load('tournamentMediaImage'),
    selfTest: await load('tournamentMediaSelfTest'),
    cleanup: () => fs.rm(outDir, { recursive: true, force: true }),
  };
}

const edge = await loadEdgeModules();
const fixture = async (name) => new Uint8Array(
  await fs.readFile(path.join(fixturesRoot, name)),
);

function expectCode(run, code) {
  try {
    run();
    assert.fail(`expected ${code}, but the call succeeded`);
  } catch (error) {
    assert.equal(error?.code, code, `expected ${code}, got ${error?.message}`);
  }
}

test('magic bytes decide the container, never the declared MIME', async () => {
  const { sniffImageMime } = edge.image;
  assert.equal(sniffImageMime(await fixture('clean-64x48.jpg')), 'image/jpeg');
  assert.equal(sniffImageMime(await fixture('clean-64x48.png')), 'image/png');
  assert.equal(sniffImageMime(await fixture('clean-64x48.webp')), 'image/webp');
  assert.equal(sniffImageMime(await fixture('sample-8x8.gif')), null);
  assert.equal(sniffImageMime(await fixture('payload.svg')), null);
  assert.equal(sniffImageMime(new Uint8Array(0)), null);
});

test('true dimensions come out of the bitstream for all three formats', async () => {
  const { inspectImage } = edge.image;
  for (const [file, mime] of [
    ['clean-64x48.jpg', 'image/jpeg'],
    ['clean-64x48.png', 'image/png'],
    ['clean-64x48.webp', 'image/webp'],
  ]) {
    const inspection = inspectImage(await fixture(file), mime);
    assert.equal(inspection.width, 64, file);
    assert.equal(inspection.height, 48, file);
    assert.equal(inspection.mime, mime, file);
  }
});

test('a clean encoder output passes verification untouched', async () => {
  const { verifyNormalizedImage } = edge.image;
  for (const [file, mime] of [
    ['clean-64x48.jpg', 'image/jpeg'],
    ['clean-64x48.png', 'image/png'],
    ['clean-64x48.webp', 'image/webp'],
  ]) {
    const bytes = await fixture(file);
    const inspection = verifyNormalizedImage(bytes, mime);
    assert.equal(inspection.alreadyClean, true, file);
    assert.equal(inspection.byteSize, bytes.length, file);
    assert.deepEqual(inspection.sanitized, bytes, file);
  }
});

test('a lying MIME is rejected in both directions', async () => {
  const { verifyNormalizedImage } = edge.image;
  const png = await fixture('clean-64x48.png');
  const jpeg = await fixture('clean-64x48.jpg');
  expectCode(() => verifyNormalizedImage(png, 'image/jpeg'), 'MEDIA_MIME_MISMATCH');
  expectCode(() => verifyNormalizedImage(jpeg, 'image/webp'), 'MEDIA_MIME_MISMATCH');
});

test('SVG and other markup never pass as a photograph', async () => {
  const { verifyNormalizedImage } = edge.image;
  const svg = await fixture('payload.svg');
  for (const mime of ['image/png', 'image/jpeg', 'image/webp']) {
    expectCode(() => verifyNormalizedImage(svg, mime), 'MEDIA_MIME_MISMATCH');
  }
});

test('an unsupported container is rejected even when it is a real image', async () => {
  const { verifyNormalizedImage } = edge.image;
  const gif = await fixture('sample-8x8.gif');
  expectCode(() => verifyNormalizedImage(gif, 'image/png'), 'MEDIA_MIME_MISMATCH');
});

test('EXIF orientation other than the identity is refused, not silently kept', async () => {
  const { inspectImage, verifyNormalizedImage } = edge.image;
  const bytes = await fixture('exif-orient6-64x48.jpg');
  assert.equal(inspectImage(bytes, 'image/jpeg').exifOrientation, 6);
  expectCode(
    () => verifyNormalizedImage(bytes, 'image/jpeg'),
    'MEDIA_ORIENTATION_NOT_NORMALIZED',
  );
});

test('the stripper finds and removes every metadata carrier', async () => {
  const { inspectImage } = edge.image;

  const jpeg = inspectImage(await fixture('exif-orient6-64x48.jpg'), 'image/jpeg');
  assert.ok(jpeg.metadataFound.includes('JPEG:APP1'), 'EXIF segment found');
  assert.equal(jpeg.alreadyClean, false);
  assert.ok(jpeg.sanitized.length < jpeg.byteSize);
  // Re-inspecting the sanitised bytes must now come back clean and identical.
  const rejpeg = inspectImage(jpeg.sanitized, 'image/jpeg');
  assert.equal(rejpeg.alreadyClean, true);
  assert.equal(rejpeg.exifOrientation, null);
  assert.equal(rejpeg.width, 64);
  assert.equal(rejpeg.height, 48);

  const png = inspectImage(await fixture('text-64x48.png'), 'image/png');
  assert.ok(png.metadataFound.includes('PNG:tEXt'), 'tEXt chunk found');
  assert.equal(inspectImage(png.sanitized, 'image/png').alreadyClean, true);

  const webp = inspectImage(await fixture('exif-64x48.webp'), 'image/webp');
  assert.ok(webp.metadataFound.includes('WEBP:EXIF'), 'EXIF chunk found');
  const rewebp = inspectImage(webp.sanitized, 'image/webp');
  assert.equal(rewebp.alreadyClean, true);
  assert.equal(rewebp.width, 64);
  assert.equal(rewebp.height, 48);
});

test('a sanitised PNG keeps valid CRCs', async () => {
  const { inspectImage } = edge.image;
  const png = inspectImage(await fixture('text-64x48.png'), 'image/png');
  // inspectImage re-validates every CRC, so re-inspecting proves the rebuilt
  // chunk stream is still a structurally valid PNG.
  assert.doesNotThrow(() => inspectImage(png.sanitized, 'image/png'));
});

test('a corrupted chunk is caught by CRC verification', async () => {
  const { verifyNormalizedImage } = edge.image;
  const bytes = await fixture('clean-64x48.png');
  const tampered = Uint8Array.from(bytes);
  tampered[tampered.length - 20] ^= 0xff;
  expectCode(
    () => verifyNormalizedImage(tampered, 'image/png'),
    'MEDIA_CONTENT_CORRUPT',
  );
});

test('truncated files are rejected for all three formats', async () => {
  const { verifyNormalizedImage } = edge.image;
  for (const [file, mime] of [
    ['clean-64x48.jpg', 'image/jpeg'],
    ['clean-64x48.png', 'image/png'],
    ['clean-64x48.webp', 'image/webp'],
  ]) {
    const bytes = await fixture(file);
    const cut = bytes.subarray(0, Math.floor(bytes.length * 0.6));
    assert.throws(
      () => verifyNormalizedImage(cut, mime),
      (error) => ['MEDIA_CONTENT_CORRUPT', 'MEDIA_TRAILING_BYTES'].includes(error.code),
      file,
    );
  }
});

test('bytes appended after the terminator are rejected (polyglot defence)', async () => {
  const { verifyNormalizedImage } = edge.image;
  for (const [file, mime, code] of [
    ['clean-64x48.png', 'image/png', 'MEDIA_TRAILING_BYTES'],
    ['clean-64x48.jpg', 'image/jpeg', 'MEDIA_TRAILING_BYTES'],
    ['clean-64x48.webp', 'image/webp', 'MEDIA_TRAILING_BYTES'],
  ]) {
    const bytes = await fixture(file);
    const padded = new Uint8Array(bytes.length + 22);
    padded.set(bytes);
    padded.set(new TextEncoder().encode('PK<script>x</script>'), bytes.length);
    expectCode(() => verifyNormalizedImage(padded, mime), code);
  }
});

test('animation is refused rather than flattened', async () => {
  const { verifyNormalizedImage } = edge.image;
  const apng = await fixture('animated-16x16.png');
  const awebp = await fixture('animated-16x16.webp');
  expectCode(
    () => verifyNormalizedImage(apng, 'image/png'),
    'MEDIA_ANIMATION_UNSUPPORTED',
  );
  expectCode(
    () => verifyNormalizedImage(awebp, 'image/webp'),
    'MEDIA_ANIMATION_UNSUPPORTED',
  );
});

test('an empty or oversized payload is refused before parsing', async () => {
  const { verifyNormalizedImage } = edge.image;
  expectCode(() => verifyNormalizedImage(new Uint8Array(0), 'image/png'), 'MEDIA_EMPTY');
  const huge = new Uint8Array(12 * 1024 * 1024 + 1);
  huge.set(await fixture('clean-64x48.png'));
  expectCode(() => verifyNormalizedImage(huge, 'image/png'), 'MEDIA_TOO_LARGE');
});

test('checksums are stable and lowercase hex', async () => {
  const { sha256Hex } = edge.image;
  const bytes = await fixture('clean-64x48.png');
  const first = await sha256Hex(bytes);
  const second = await sha256Hex(bytes);
  assert.equal(first, second);
  assert.match(first, /^[0-9a-f]{64}$/);
  assert.notEqual(first, await sha256Hex(await fixture('clean-64x48.jpg')));
});

test('variant geometry is deterministic, never upscales, and matches the box', () => {
  const { variantGeometry, variantPlan, variantObjectName } = edge.contract;
  assert.deepEqual(variantGeometry('thumbnail', 4000, 3000), {
    kind: 'thumbnail', width: 320, height: 240,
  });
  assert.deepEqual(variantGeometry('grid', 3000, 4000), {
    kind: 'grid', width: 600, height: 800,
  });
  assert.deepEqual(variantGeometry('detail', 100, 50), {
    kind: 'detail', width: 100, height: 50,
  });
  assert.deepEqual(variantGeometry('thumbnail', 1, 1), {
    kind: 'thumbnail', width: 1, height: 1,
  });
  assert.equal(variantPlan(4000, 3000).length, 3);

  const source = '11111111-1111-4111-8111-111111111111/'
    + '22222222-2222-4222-8222-222222222222/'
    + '33333333-3333-4333-8333-333333333333/'
    + '44444444-4444-4444-8444-444444444444.jpg';
  assert.equal(variantObjectName(source, 'original'), source.replace('.jpg', '-original.jpg'));
  assert.equal(variantObjectName(source, 'grid'), source.replace('.jpg', '-grid.jpg'));
  assert.throws(() => variantObjectName('../escape.jpg', 'grid'), /MEDIA_PATH_INVALID/);
});

test('the processor self-test passes every capability it attests', async () => {
  const result = await edge.selfTest.runProcessorSelfTest();
  const failed = Object.entries(result.checks)
    .filter(([, passed]) => !passed)
    .map(([name]) => name);
  assert.deepEqual(failed, [], `failing checks: ${failed.join(', ')}`);
  assert.equal(result.passed, true);
});

test.after(() => edge.cleanup());
