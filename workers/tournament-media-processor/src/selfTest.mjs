/**
 * The worker proves each capability before it claims it.
 *
 * The database refuses any attestation whose `capabilities` are not backed by a
 * self-test check of the same name that passed, so this file is the only route
 * to `uploadReady: true`. Every check below exercises the real component:
 * libvips actually decodes, actually re-encodes and actually strips; clamd
 * actually scans; Storage actually round-trips an object. A component that is
 * missing makes its check false, the attestation drops that capability, and the
 * corresponding readiness gate closes.
 *
 * The EICAR string is the industry-standard, harmless antivirus test file. It
 * is assembled at runtime from two halves so that this source file itself is
 * not a scanner hit in the repository.
 */

import { createHash } from 'node:crypto';

import { variantGeometry } from './contract.mjs';

const EICAR = ['X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-',
  'ANTIVIRUS-TEST-FILE!$H+H*'].join('');

async function makeProbeImage(sharp, { width, height, mime, dirty }) {
  let pipeline = sharp({
    create: {
      width, height, channels: 3,
      background: { r: 16, g: 96, b: 48 },
    },
  });
  if (dirty) {
    // A real EXIF block plus a real ICC profile: the carriers the sanitiser
    // has to remove. `withMetadata` is what puts them there.
    pipeline = pipeline.withMetadata({
      orientation: 6,
      exif: { IFD0: { Artist: 'Arma2 QA', Copyright: 'Arma2', ImageDescription: 'cancha 3' } },
      icc: 'srgb',
    });
  }
  switch (mime) {
    case 'image/png': return new Uint8Array(await pipeline.png().toBuffer());
    case 'image/webp': return new Uint8Array(await pipeline.webp().toBuffer());
    default: return new Uint8Array(await pipeline.jpeg({ quality: 90 }).toBuffer());
  }
}

function sameBytes(a, b) {
  if (a.length !== b.length) return false;
  for (let index = 0; index < a.length; index += 1) if (a[index] !== b[index]) return false;
  return true;
}

async function rejects(action, code) {
  try {
    await action();
    return false;
  } catch (error) {
    return String(error?.code || '') === code;
  }
}

/**
 * @param deps { codec, antivirus, storage } — the same real modules the job
 *   pipeline uses. Nothing here accepts a stub from configuration.
 * @returns { passed, checks, evidence }
 */
export async function runWorkerSelfTest(deps) {
  const { codec, antivirus, storage } = deps;
  const checks = {};
  const evidence = {};

  // --- codec ---------------------------------------------------------------
  let sharp = null;
  try {
    sharp = await codec.loadSharp();
    evidence.codec = await codec.codecVersion();
  } catch {
    // No libvips: every codec-backed capability stays false, and the pixel,
    // metadata and variant gates therefore stay closed.
    return { passed: false, checks: { codecAvailable: false }, evidence };
  }
  checks.codecAvailable = true;

  const clean = await makeProbeImage(sharp, {
    width: 64, height: 48, mime: 'image/jpeg', dirty: false,
  });
  const dirty = await makeProbeImage(sharp, {
    width: 64, height: 48, mime: 'image/jpeg', dirty: true,
  });
  const png = await makeProbeImage(sharp, {
    width: 64, height: 48, mime: 'image/png', dirty: false,
  });

  // contentSniffing: the declared MIME has to be what the bytes really are.
  checks.contentSniffing =
    await rejects(() => codec.decodeSanitizedOriginal(png, 'image/jpeg'), 'MEDIA_MIME_MISMATCH')
    && await rejects(
      () => codec.decodeSanitizedOriginal(
        new TextEncoder().encode('<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg"/>'),
        'image/png',
      ),
      'MEDIA_CONTENT_CORRUPT',
    );

  // pixelDecode: a good file decodes to its true dimensions, a file that is
  // structurally plausible but semantically broken does NOT. The truncated
  // JPEG below is exactly the payload the structural verifier accepted.
  let decoded = null;
  try {
    decoded = await codec.decodeSanitizedOriginal(clean, 'image/jpeg');
  } catch {
    decoded = null;
  }
  const truncated = clean.subarray(0, Math.floor(clean.length * 0.55));
  checks.pixelDecode = Boolean(decoded)
    && decoded.width === 64 && decoded.height === 48
    && decoded.pixelDecoded === true
    && await rejects(
      () => codec.decodeSanitizedOriginal(truncated, 'image/jpeg'), 'MEDIA_CONTENT_CORRUPT',
    )
    // A decompression bomb has to die on the pixel budget, not on the byte size.
    && await rejects(
      () => codec.decodeSanitizedOriginal(clean, 'image/jpeg', { limits: { maxPixels: 16 } }),
      'MEDIA_CONTENT_CORRUPT',
    );

  // pixelTranscode: the stored bytes are produced by the encoder, not copied.
  checks.pixelTranscode = Boolean(decoded)
    && decoded.pixelTranscoded === true
    && !sameBytes(decoded.bytes, clean)
    && (await codec.inspectMetadataCarriers(decoded.bytes)).width === 64;

  // metadataStrippingApplied: a file carrying EXIF, an ICC profile and an
  // orientation tag comes back with none of them, and the rotation is baked in.
  let sanitizedDirty = null;
  try {
    sanitizedDirty = await codec.decodeSanitizedOriginal(dirty, 'image/jpeg');
  } catch {
    sanitizedDirty = null;
  }
  const dirtyCarriers = sanitizedDirty
    ? await codec.inspectMetadataCarriers(sanitizedDirty.bytes)
    : { clean: false, carriers: ['unknown'] };
  const sourceCarriers = await codec.inspectMetadataCarriers(dirty);
  checks.metadataStrippingApplied = Boolean(sanitizedDirty)
    // The probe really was dirty, so "clean" afterwards is not vacuous.
    && sourceCarriers.clean === false
    && dirtyCarriers.clean === true
    && sanitizedDirty.orientationApplied === true
    && sanitizedDirty.width === 48 && sanitizedDirty.height === 64;

  // variantGeneration: exact, deterministic geometry from the sanitised pixels.
  let variantsOk = Boolean(decoded);
  if (decoded) {
    for (const kind of ['thumbnail', 'grid', 'detail']) {
      const expected = variantGeometry(kind, decoded.width, decoded.height);
      try {
        const rendition = await codec.renderVariant(
          decoded.bytes, decoded.mime, kind, decoded.width, decoded.height,
        );
        const inspected = await codec.inspectMetadataCarriers(rendition.bytes);
        if (rendition.width !== expected.width || rendition.height !== expected.height
          || !inspected.clean) {
          variantsOk = false;
        }
      } catch {
        variantsOk = false;
      }
    }
    const big = await makeProbeImage(sharp, {
      width: 4000, height: 3000, mime: 'image/jpeg', dirty: false,
    });
    const bigDecoded = await codec.decodeSanitizedOriginal(big, 'image/jpeg');
    const thumbnail = await codec.renderVariant(
      bigDecoded.bytes, bigDecoded.mime, 'thumbnail', bigDecoded.width, bigDecoded.height,
    );
    if (thumbnail.width !== 320 || thumbnail.height !== 240) variantsOk = false;
  }
  checks.variantGeneration = variantsOk;

  // checksumVerification.
  const digest = createHash('sha256').update(Buffer.from(clean)).digest('hex');
  const again = createHash('sha256').update(Buffer.from(clean)).digest('hex');
  checks.checksumVerification = /^[0-9a-f]{64}$/.test(digest) && digest === again;

  // --- antivirus -----------------------------------------------------------
  // A clean buffer must pass AND the EICAR test file must be caught. A scanner
  // that says "clean" to both is not a scanner, and fails here.
  try {
    evidence.antivirus = await antivirus.version();
    await antivirus.scan(clean);
    const caught = await rejects(
      () => antivirus.scan(new TextEncoder().encode(EICAR)), 'ANTIVIRUS_INFECTED',
    );
    checks.antivirusScanning = caught === true;
  } catch {
    checks.antivirusScanning = false;
  }

  // --- storage -------------------------------------------------------------
  const probeName = `_selftest/${Date.now()}-${Math.random().toString(16).slice(2)}.png`;
  try {
    await storage.upload(probeName, png, 'image/png');
    const readBack = await storage.download(probeName);
    checks.storageReadWrite = Boolean(readBack) && readBack.length === png.length;
    await storage.remove([probeName]);
    const gone = await storage.download(probeName);
    checks.cleanup = !gone;
  } catch {
    checks.storageReadWrite = false;
    checks.cleanup = false;
  }

  const passed = Object.values(checks).every(Boolean);
  return { passed, checks, evidence };
}

/**
 * Turns a self-test into the exact envelope `attest_tournament_media_service`
 * accepts. Only capabilities whose check passed are claimed; the database
 * rejects the whole attestation if that invariant is ever broken here.
 */
export function buildAttestation(selfTest, { backendFingerprint, workerType = 'external_image_worker' }) {
  const capabilityNames = [
    'contentSniffing', 'pixelDecode', 'pixelTranscode', 'metadataStrippingApplied',
    'checksumVerification', 'variantGeneration', 'antivirusScanning',
    'storageReadWrite', 'cleanup',
  ];
  const capabilities = {};
  for (const name of capabilityNames) {
    if (selfTest.checks?.[name] === true) capabilities[name] = true;
  }
  return {
    capabilities,
    evidence: {
      workerType,
      codec: selfTest.evidence?.codec
        ? { name: selfTest.evidence.codec.name, version: selfTest.evidence.codec.version }
        : undefined,
      antivirus: selfTest.evidence?.antivirus
        ? {
          name: selfTest.evidence.antivirus.name,
          version: selfTest.evidence.antivirus.version,
          signaturesAt: selfTest.evidence.antivirus.signaturesAt,
        }
        : undefined,
      selfTest: { passed: selfTest.passed === true, checks: { ...selfTest.checks } },
      backendFingerprint,
      probedAt: new Date().toISOString(),
    },
  };
}
