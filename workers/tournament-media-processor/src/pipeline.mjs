/**
 * One job, end to end.
 *
 * The order is the contract. Nothing is registered in the database until every
 * final object exists in the bucket, has been checksummed and has been scanned,
 * so a partially ready asset cannot exist. Any failure after the first write
 * rolls the objects back and fails the job, which returns the quarantined
 * object to the sweeper.
 *
 * All I/O is injected. `processMediaJob` therefore has no import of libvips, no
 * import of net and no import of supabase-js: the decision logic is testable on
 * any host, while the real capabilities live in `codec.mjs` / `antivirus.mjs`
 * and simply cannot be faked into an attestation (see `selfTest.mjs`).
 */

import { createHash } from 'node:crypto';

import { MEDIA_DERIVED_KINDS, variantObjectName } from './contract.mjs';

export class JobFailure extends Error {
  constructor(code, detail, { retryable = true } = {}) {
    super(detail ? `${code}: ${detail}` : code);
    this.name = 'JobFailure';
    this.code = code;
    this.retryable = retryable;
  }
}

export function sha256Hex(bytes) {
  return createHash('sha256').update(Buffer.from(bytes)).digest('hex');
}

/** Codes that describe the FILE, so retrying the same bytes is pointless. */
const TERMINAL_CODES = new Set([
  'MEDIA_EMPTY', 'MEDIA_TOO_LARGE', 'MEDIA_MIME_UNSUPPORTED', 'MEDIA_MIME_MISMATCH',
  'MEDIA_CONTENT_CORRUPT', 'MEDIA_ANIMATION_UNSUPPORTED', 'MEDIA_DIMENSIONS_INVALID',
  'MEDIA_VARIANT_GEOMETRY', 'MEDIA_METADATA_NOT_STRIPPED', 'SOURCE_SIZE_MISMATCH',
  'SOURCE_OBJECT_MISSING', 'ANTIVIRUS_INFECTED',
]);

export function isTerminal(code) {
  return TERMINAL_CODES.has(String(code || ''));
}

function normaliseFailureCode(error) {
  const raw = String(error?.code || 'PROCESSING_FAILED');
  return /^[A-Z][A-Z0-9_]{2,80}$/.test(raw) ? raw : 'PROCESSING_FAILED';
}

/**
 * @param job    one entry from `lease_tournament_media_processing_jobs`
 * @param deps   { storage, codec, antivirus, db, logger }
 */
export async function processMediaJob(job, deps) {
  const { storage, codec, antivirus, db, logger = () => {} } = deps;
  const written = [];

  const rollback = async () => {
    if (written.length === 0) return;
    try {
      await storage.remove(written.slice());
    } catch (error) {
      // Best effort. `cleanup_tournament_media_processing_jobs` hands the same
      // names to the sweeper, and the object is unreachable meanwhile: no
      // variant row points at it and no signed URL was ever minted for it.
      logger('rollback_failed', { jobId: job.jobId, error: String(error?.message || error) });
    }
    written.length = 0;
  };

  try {
    // 1. The quarantined upload. It is never published and never read by a
    //    participant: no variant row may point at this name.
    const source = await storage.download(job.objectName);
    if (!source) throw new JobFailure('SOURCE_OBJECT_MISSING', job.objectName, { retryable: false });
    if (source.length !== Number(job.expectedBytes)) {
      throw new JobFailure('SOURCE_SIZE_MISMATCH', `${source.length}`, { retryable: false });
    }

    // 2-6. Real decode, real orientation normalisation, real metadata strip,
    //      real re-encode. The result replaces the uploaded bytes entirely.
    const sanitized = await codec.decodeSanitizedOriginal(source, job.declaredMime);

    // 7. Every rendition comes from the sanitised pixels.
    const renditions = [];
    for (const kind of MEDIA_DERIVED_KINDS) {
      renditions.push(await codec.renderVariant(
        sanitized.bytes, sanitized.mime, kind, sanitized.width, sanitized.height,
      ));
    }

    const finals = [
      {
        kind: 'original',
        bytes: sanitized.bytes,
        width: sanitized.width,
        height: sanitized.height,
      },
      ...renditions.map((rendition) => ({
        kind: rendition.kind,
        bytes: rendition.bytes,
        width: rendition.width,
        height: rendition.height,
      })),
    ];

    // 8-9. Checksum and scan the exact bytes that will be stored, and prove
    //      once more — by reading the encoder's own output back — that no
    //      metadata carrier survived.
    for (const final of finals) {
      const inspection = await codec.inspectMetadataCarriers(final.bytes);
      if (!inspection.clean) {
        throw new JobFailure(
          'MEDIA_METADATA_NOT_STRIPPED', `${final.kind}:${inspection.carriers.join(',')}`,
          { retryable: false },
        );
      }
      await antivirus.scan(final.bytes);
      final.checksum = sha256Hex(final.bytes);
      final.objectName = variantObjectName(job.objectName, final.kind);
    }

    // 10. Write every final object before touching the database.
    for (const final of finals) {
      await storage.upload(final.objectName, final.bytes, sanitized.mime);
      written.push(final.objectName);
    }

    // 11. Register the asset with values the WORKER measured, then flip the
    //     derived variants. Both calls re-check pipeline readiness server-side,
    //     so an attestation that lapsed mid-job stops the publication here.
    const asset = await db.completeUploadForJob({
      jobId: job.jobId,
      leaseToken: job.leaseToken,
      detectedMime: sanitized.mime,
      byteSize: sanitized.bytes.length,
      width: sanitized.width,
      height: sanitized.height,
      checksumSha256: finals.find((final) => final.kind === 'original').checksum,
    });

    const payload = {};
    for (const final of finals) {
      if (final.kind === 'original') continue;
      payload[final.kind] = {
        detectedMime: sanitized.mime,
        byteSize: final.bytes.length,
        width: final.width,
        height: final.height,
        checksumSha256: final.checksum,
        metadataStripped: true,
        pixelTranscoded: true,
        antivirusClean: true,
      };
    }
    await db.finalizeVariants({ assetId: asset.assetId, variants: payload });
    await db.completeJob({
      jobId: job.jobId, leaseToken: job.leaseToken, assetId: asset.assetId,
    });

    // The quarantined upload has no further purpose. Removing it is also what
    // stops the session from being signed again.
    try {
      await storage.remove([job.objectName]);
    } catch (error) {
      logger('quarantine_purge_failed', { jobId: job.jobId, error: String(error?.message || error) });
    }

    return {
      jobId: job.jobId,
      assetId: asset.assetId,
      status: 'succeeded',
      width: sanitized.width,
      height: sanitized.height,
      byteSize: sanitized.bytes.length,
      objects: finals.map((final) => final.objectName),
    };
  } catch (error) {
    await rollback();
    const code = normaliseFailureCode(error);
    logger('job_failed', { jobId: job.jobId, code });
    await db.failJob({ jobId: job.jobId, leaseToken: job.leaseToken, failureCode: code });
    return {
      jobId: job.jobId,
      status: 'failed',
      code,
      terminal: isTerminal(code) || error?.retryable === false,
    };
  }
}
