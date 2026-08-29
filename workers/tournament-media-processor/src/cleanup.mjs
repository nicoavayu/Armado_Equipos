/**
 * The quarantine sweeper: the half of `cleanup_tournament_media_processing_jobs`
 * the worker was throwing away.
 *
 * ---------------------------------------------------------------------------
 * What was wrong
 * ---------------------------------------------------------------------------
 * The RPC returns `{ requeued, purgeable, checkedAt }`. `purgeable` is the list
 * of quarantined objects belonging to jobs that ran out of attempts — raw,
 * unscanned, attacker-supplied bytes that no longer have any job, session or
 * asset behind them. `index.mjs` called `db.sweep(200)` and discarded the
 * result, so nothing ever deleted them: every abandoned upload stayed in the
 * private bucket indefinitely, and the database's `cleanup` capability claimed
 * a behaviour the worker did not implement.
 *
 * ---------------------------------------------------------------------------
 * Why deleting is safe, and why it is retry-safe
 * ---------------------------------------------------------------------------
 * Both answers come from the SQL, in
 * `supabase/migrations/20260802120000_tournament_media_trusted_processing.sql`,
 * and neither is assumed here:
 *
 *   * `purgeable` is a pure SELECT. It sets no flag, deletes no row and marks
 *     nothing as handed out; it simply reads the jobs that are `abandoned` and
 *     whose path no asset has adopted. `abandoned` is terminal — nothing in the
 *     schema transitions a job out of it, and no statement anywhere deletes a
 *     job row. So the SAME names are returned by the NEXT sweep, and the one
 *     after that. A failed delete is therefore retried by construction, and no
 *     name can be lost by dropping it on the floor. This is what makes F-2
 *     implementable in the worker alone, with no migration and no change to the
 *     database contract.
 *
 *   * a name is only offered once no `tournament_media_assets` row has that
 *     `internal_path`, so an object a real asset depends on is never in the
 *     list. The check is re-evaluated on every sweep, so a race that briefly
 *     looked purgeable resolves itself rather than accumulating.
 *
 *   * a variant object can never appear here even by accident. The variants
 *     table's own CHECK constraint requires a
 *     `-(thumbnail|grid|detail|original)` suffix, and `MEDIA_SOURCE_PATH_RE`
 *     below refuses any name carrying one. The two namespaces are disjoint by
 *     construction, so this sweeper structurally cannot delete a published
 *     rendition.
 *
 * ---------------------------------------------------------------------------
 * Why the worker re-validates what the database already constrained
 * ---------------------------------------------------------------------------
 * `bucket` has a CHECK pinning it to `tournament-media` and `quarantine_path`
 * has a CHECK pinning it to the four-segment quarantine shape, so in a healthy
 * system every entry passes the filter below untouched. The filter exists for
 * the unhealthy one: this code turns a JSON response into unlink calls against
 * a private bucket, and the blast radius of trusting that response is every
 * object the service role can see. A response that does not match the contract
 * is a reason to delete nothing, not a reason to improvise.
 *
 * ---------------------------------------------------------------------------
 * Why successful deletes are remembered for a while
 * ---------------------------------------------------------------------------
 * Because `purgeable` is a pure read and job rows are never removed, an
 * abandoned job's name comes back on every sweep forever — and the loop sweeps
 * every `pollMs`. Re-issuing the same deletes a few times a second would be a
 * self-inflicted load on Storage for no benefit. Successful deletions are
 * therefore remembered for `successTtlMs` and skipped while remembered.
 *
 * Only successes are remembered, which is the property that keeps this
 * retry-safe: a failure is never cached, so it is retried on the very next
 * sweep, and even a success is retried once its entry ages out — so an object
 * that Storage claimed to delete but did not is eventually deleted again. The
 * cache can only ever cost an extra delete, never a skipped one.
 */

import { MEDIA_SOURCE_PATH_RE, TOURNAMENT_MEDIA_BUCKET } from './contract.mjs';

/** Names are deleted in batches; one oversized request is not more efficient. */
const DEFAULT_BATCH_SIZE = 50;

/** Long enough to stop the per-poll churn, short enough to re-verify often. */
const DEFAULT_SUCCESS_TTL_MS = 60 * 60 * 1000;

/**
 * Turns a sweep response into the exact set of object names that may be
 * deleted, plus a tally of why anything was refused.
 *
 * Order is preserved and duplicates are dropped, so a database that returned
 * the same name twice produces one delete rather than two.
 *
 * @returns {{ objectNames: string[], rejected: Record<string, number> }}
 */
export function selectPurgeableObjects(sweepResult, {
  bucket = TOURNAMENT_MEDIA_BUCKET,
} = {}) {
  const rejected = {};
  const refuse = (reason) => { rejected[reason] = (rejected[reason] || 0) + 1; };

  const entries = sweepResult && Array.isArray(sweepResult.purgeable)
    ? sweepResult.purgeable
    : null;
  if (!entries) {
    // A missing or non-array `purgeable` is a contract violation, not an empty
    // sweep, and is reported as such — but it still deletes nothing.
    if (sweepResult && sweepResult.purgeable !== undefined) refuse('malformed_purgeable');
    return { objectNames: [], rejected };
  }

  const seen = new Set();
  const objectNames = [];
  for (const entry of entries) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      refuse('malformed_entry');
      continue;
    }
    // Cross-bucket deletion is refused on the entry's own declaration rather
    // than on the assumption that the RPC only ever names one bucket.
    if (entry.bucket !== bucket) {
      refuse('bucket_mismatch');
      continue;
    }
    const objectName = entry.objectName;
    if (typeof objectName !== 'string' || objectName.length === 0) {
      refuse('missing_object_name');
      continue;
    }
    // The quarantine shape: four hex-and-dash segments and an image extension.
    // A traversal sequence, an absolute path, a wildcard, a bare prefix, a
    // variant suffix and a name in any other namespace all fail this.
    if (!MEDIA_SOURCE_PATH_RE.test(objectName)) {
      refuse('path_not_quarantine');
      continue;
    }
    // Redundant against the regex, which admits no '.' inside a segment, and
    // kept because the database states the same rule twice for the same reason.
    if (objectName.includes('..')) {
      refuse('path_traversal');
      continue;
    }
    if (seen.has(objectName)) {
      refuse('duplicate');
      continue;
    }
    seen.add(objectName);
    objectNames.push(objectName);
  }
  return { objectNames, rejected };
}

const chunk = (items, size) => {
  const batches = [];
  for (let index = 0; index < items.length; index += size) {
    batches.push(items.slice(index, index + size));
  }
  return batches;
};

/**
 * Builds the sweeper. Storage is injected, so the decision logic is testable
 * without a bucket — the same arrangement the job pipeline uses.
 *
 * @param deps { storage, logger, now, successTtlMs, batchSize }
 */
export function createQuarantinePurger({
  storage,
  logger = () => {},
  now = Date.now,
  successTtlMs = DEFAULT_SUCCESS_TTL_MS,
  batchSize = DEFAULT_BATCH_SIZE,
} = {}) {
  /** objectName -> timestamp at which the successful delete stops counting. */
  const purgedUntil = new Map();

  const forget = (at) => {
    for (const [name, expiresAt] of purgedUntil) {
      if (expiresAt <= at) purgedUntil.delete(name);
    }
  };

  const removeBatch = async (names) => {
    await storage.remove(names);
  };

  return {
    /**
     * Deletes everything the sweep declared purgeable and that passes the
     * filter. Never throws: a Storage outage is reported through the summary
     * and the log, and the names come back on the next sweep.
     *
     * @returns {{ deleted, failed, skipped, considered, rejected }}
     */
    async purge(sweepResult) {
      const at = now();
      forget(at);

      const { objectNames, rejected } = selectPurgeableObjects(sweepResult);
      const pending = objectNames.filter((name) => !purgedUntil.has(name));
      const skipped = objectNames.length - pending.length;

      let deleted = 0;
      let failed = 0;
      const failures = new Map();

      const succeed = (names) => {
        for (const name of names) purgedUntil.set(name, now() + successTtlMs);
        deleted += names.length;
      };
      const record = (error) => {
        const code = String(error?.message || error).slice(0, 80);
        failures.set(code, (failures.get(code) || 0) + 1);
        failed += 1;
      };

      for (const batch of chunk(pending, batchSize)) {
        try {
          await removeBatch(batch);
          succeed(batch);
        } catch {
          // The batch endpoint reports one status for the whole request, so a
          // single unlucky name would otherwise strand every other name in the
          // batch until the next sweep. Retrying one at a time turns that into
          // precise accounting: what can be deleted, is.
          for (const name of batch) {
            try {
              await removeBatch([name]);
              succeed([name]);
            } catch (error) {
              record(error);
            }
          }
        }
      }

      const summary = {
        considered: objectNames.length, deleted, failed, skipped,
      };
      // Object names are never logged: they are the org / tournament / gallery /
      // session UUIDs of a real upload, and this log line is the same stream the
      // rest of the worker keeps deliberately free of identities. Counts and the
      // Storage failure codes are what an operator can act on.
      if (deleted > 0 || failed > 0) logger('quarantine_swept', summary);
      if (failed > 0) {
        logger('quarantine_sweep_failed', {
          failed, codes: Object.fromEntries(failures),
        });
      }
      if (Object.keys(rejected).length > 0) {
        // A rejection means the RPC said something the contract does not allow.
        // It is louder than a failed delete because it should never happen at
        // all, and because nothing will retry it into correctness.
        logger('quarantine_sweep_rejected', { rejected });
      }
      return { ...summary, rejected };
    },
  };
}

export { DEFAULT_BATCH_SIZE, DEFAULT_SUCCESS_TTL_MS };
