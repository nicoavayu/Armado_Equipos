// F-2: the quarantined objects the sweep declares purgeable are actually
// deleted — and nothing else ever is.
//
// `index.mjs` used to call `db.sweep(200)` and throw the answer away, so raw,
// unscanned, attacker-supplied uploads accumulated in the private bucket for as
// long as the project existed. The fix is small; the risk is not, because this
// is the one place in the worker that turns a JSON response into unlink calls
// against a bucket the service role can see in full. Most of what follows tests
// what must NOT be deleted.
//
// The retry story is the other half. `cleanup_tournament_media_processing_jobs`
// computes `purgeable` with a pure SELECT over jobs that are `abandoned` — a
// terminal status, on rows nothing ever deletes — so the same names are offered
// again by every later sweep. That is what makes a failed delete recoverable
// without a migration, and the tests below pin that we rely on it correctly:
// failures are never remembered, successes are.

import assert from 'node:assert/strict';
import test from 'node:test';

import { createQuarantinePurger, selectPurgeableObjects } from '../src/cleanup.mjs';

const BUCKET = 'tournament-media';
const uuid = (n) => `${String(n).padStart(8, '0')}-0000-4000-8000-000000000000`;
const path = (n) => `${uuid(n)}/${uuid(n + 1)}/${uuid(n + 2)}/${uuid(n + 3)}.jpg`;

const A = path(1);
const B = path(11);
const C = path(21);

const sweep = (...objectNames) => ({
  requeued: [],
  purgeable: objectNames.map((objectName) => ({ bucket: BUCKET, objectName })),
  checkedAt: new Date().toISOString(),
});

/**
 * A storage double that records deletes and can be told to fail.
 *
 * `calls` is every attempt, including the ones that threw; `deleted` is only
 * what actually went away. The two differ whenever a batch fails and is retried
 * per object, which is precisely the case worth asserting about.
 */
function fakeStorage({ failOn = new Set(), failAll = false } = {}) {
  const calls = [];
  const deleted = [];
  return {
    calls,
    deleted,
    async remove(names) {
      calls.push([...names]);
      if (failAll) throw new Error('STORAGE_REMOVE_FAILED:500');
      if (names.some((name) => failOn.has(name))) {
        throw new Error('STORAGE_REMOVE_FAILED:500');
      }
      deleted.push(...names);
      return true;
    },
  };
}

// --- selection --------------------------------------------------------------

test('an empty purgeable list deletes nothing', () => {
  const { objectNames, rejected } = selectPurgeableObjects(sweep());
  assert.deepEqual(objectNames, []);
  assert.deepEqual(rejected, {});
});

test('a single purgeable object is selected', () => {
  assert.deepEqual(selectPurgeableObjects(sweep(A)).objectNames, [A]);
});

test('multiple purgeable objects keep their order', () => {
  assert.deepEqual(selectPurgeableObjects(sweep(A, B, C)).objectNames, [A, B, C]);
});

test('duplicates are collapsed into one delete', () => {
  const { objectNames, rejected } = selectPurgeableObjects(sweep(A, B, A, A));
  assert.deepEqual(objectNames, [A, B]);
  assert.equal(rejected.duplicate, 2);
});

test('a name outside the quarantine namespace is refused', () => {
  // Only the four-segment upload path is a quarantine object. Everything else
  // — a bare prefix, a wildcard, another namespace, a suffix-carrying name —
  // is something this sweeper has no mandate over.
  const rejects = [
    '', 'x.jpg', 'foo/bar.jpg', `${uuid(1)}/${uuid(2)}/${uuid(3)}/`,
    `${uuid(1)}/${uuid(2)}/${uuid(3)}/${uuid(4)}.svg`,
    `${uuid(1)}/${uuid(2)}/${uuid(3)}/${uuid(4)}.jpg.exe`,
    '_selftest/probe.png', '*', '/', 'a/b/c/d.jpg',
  ];
  for (const objectName of rejects) {
    const { objectNames } = selectPurgeableObjects(sweep(objectName));
    assert.deepEqual(objectNames, [], `${JSON.stringify(objectName)} must be refused`);
  }
});

test('a variant object can never be selected', () => {
  // The variants table's CHECK constraint requires a `-kind` suffix and the
  // quarantine constraint forbids one, so the two namespaces are disjoint. A
  // published rendition is therefore structurally unreachable from here.
  for (const kind of ['thumbnail', 'grid', 'detail', 'original']) {
    const variant = `${uuid(1)}/${uuid(2)}/${uuid(3)}/${uuid(4)}-${kind}.jpg`;
    const { objectNames, rejected } = selectPurgeableObjects(sweep(variant));
    assert.deepEqual(objectNames, [], `${kind} variant must be refused`);
    assert.equal(rejected.path_not_quarantine, 1);
  }
});

test('path traversal is refused', () => {
  for (const objectName of [
    `../${uuid(2)}/${uuid(3)}/${uuid(4)}.jpg`,
    `${uuid(1)}/../../${uuid(3)}/${uuid(4)}.jpg`,
    `${uuid(1)}/${uuid(2)}/${uuid(3)}/../${uuid(4)}.jpg`,
    '../../../etc/passwd',
  ]) {
    assert.deepEqual(selectPurgeableObjects(sweep(objectName)).objectNames, []);
  }
});

test('another bucket is never touched', () => {
  const { objectNames, rejected } = selectPurgeableObjects({
    purgeable: [
      { bucket: 'avatars', objectName: A },
      { bucket: 'TOURNAMENT-MEDIA', objectName: B },
      { bucket: null, objectName: C },
      { bucket: BUCKET, objectName: A },
    ],
  });
  assert.deepEqual(objectNames, [A]);
  assert.equal(rejected.bucket_mismatch, 3);
});

test('a malformed response deletes nothing', () => {
  for (const result of [null, undefined, {}, { purgeable: null }, { purgeable: 'all' }]) {
    assert.deepEqual(selectPurgeableObjects(result).objectNames, []);
  }
  const { objectNames, rejected } = selectPurgeableObjects({
    purgeable: [null, 'a-string', 42, [], { bucket: BUCKET }],
  });
  assert.deepEqual(objectNames, []);
  assert.equal(rejected.malformed_entry, 4);
  assert.equal(rejected.missing_object_name, 1);
});

// --- deletion ---------------------------------------------------------------

test('a successful sweep deletes exactly the purgeable names', async () => {
  const storage = fakeStorage();
  const purger = createQuarantinePurger({ storage });
  const summary = await purger.purge(sweep(A, B, C));
  assert.deepEqual(summary, {
    considered: 3, deleted: 3, failed: 0, skipped: 0, rejected: {},
  });
  assert.deepEqual(storage.deleted, [A, B, C]);
});

test('nothing is deleted when there is nothing to delete', async () => {
  const storage = fakeStorage();
  const summary = await createQuarantinePurger({ storage }).purge(sweep());
  assert.equal(summary.deleted, 0);
  assert.deepEqual(storage.calls, []);
});

test('a partial failure still deletes everything it can', async () => {
  // The batch endpoint answers once for the whole request, so a single bad name
  // would otherwise strand the rest until the next sweep.
  const storage = fakeStorage({ failOn: new Set([B]) });
  const summary = await createQuarantinePurger({ storage }).purge(sweep(A, B, C));
  assert.equal(summary.deleted, 2);
  assert.equal(summary.failed, 1);
  // The batch attempt threw, so the survivors came back through the per-object
  // retry rather than being stranded until the next sweep.
  assert.deepEqual([...storage.deleted].sort(), [A, C].sort());
  assert.equal(storage.deleted.includes(B), false);
});

test('a total Storage outage fails without throwing', async () => {
  // The loop must keep running: the names are not lost, they are re-offered.
  const storage = fakeStorage({ failAll: true });
  const summary = await createQuarantinePurger({ storage }).purge(sweep(A, B));
  assert.equal(summary.deleted, 0);
  assert.equal(summary.failed, 2);
});

// --- retry ------------------------------------------------------------------

test('a failed delete is retried on the very next sweep', async () => {
  // The property the whole design rests on. Failures are never remembered, so
  // the next sweep — which offers the same names, because `purgeable` is a pure
  // read over rows that stay `abandoned` — tries again.
  const failing = new Set([A]);
  const storage = fakeStorage({ failOn: failing });
  const purger = createQuarantinePurger({ storage });

  const first = await purger.purge(sweep(A));
  assert.equal(first.failed, 1);
  assert.equal(first.skipped, 0);

  failing.delete(A);
  const second = await purger.purge(sweep(A));
  assert.equal(second.deleted, 1, 'the failed name must be retried, not skipped');
  assert.equal(second.failed, 0);
});

test('a successful delete is not re-issued on every poll', async () => {
  // Job rows are never deleted, so an abandoned job is offered forever and the
  // loop sweeps every pollMs. Without this the worker would hammer Storage with
  // the same deletes several times a second.
  const storage = fakeStorage();
  const purger = createQuarantinePurger({ storage });
  await purger.purge(sweep(A));
  const second = await purger.purge(sweep(A));
  assert.equal(second.deleted, 0);
  assert.equal(second.skipped, 1);
  assert.equal(storage.calls.length, 1);
});

test('a remembered success is re-verified once it ages out', async () => {
  // The cache may only ever cost an extra delete, never a skipped one: an
  // object Storage claimed to remove but did not is deleted again later.
  let clock = 1_000_000;
  const storage = fakeStorage();
  const purger = createQuarantinePurger({
    storage, now: () => clock, successTtlMs: 60_000,
  });
  await purger.purge(sweep(A));
  clock += 30_000;
  assert.equal((await purger.purge(sweep(A))).skipped, 1);
  clock += 60_000;
  assert.equal((await purger.purge(sweep(A))).deleted, 1, 'the entry must age out');
});

test('the retry loop does not resurrect a refused name', async () => {
  // A name that failed validation is never deleted, however many sweeps offer
  // it — retrying is only ever about Storage, never about the filter.
  const storage = fakeStorage();
  const purger = createQuarantinePurger({ storage });
  const bad = { purgeable: [{ bucket: 'other', objectName: A }] };
  for (let i = 0; i < 3; i += 1) {
    const summary = await purger.purge(bad);
    assert.equal(summary.deleted, 0);
    assert.equal(summary.rejected.bucket_mismatch, 1);
  }
  assert.deepEqual(storage.calls, []);
});

test('deletes are batched', async () => {
  const storage = fakeStorage();
  const many = Array.from({ length: 7 }, (_, i) => path(i * 10 + 1));
  const purger = createQuarantinePurger({ storage, batchSize: 3 });
  const summary = await purger.purge(sweep(...many));
  assert.equal(summary.deleted, 7);
  assert.deepEqual(storage.calls.map((c) => c.length), [3, 3, 1]);
});

// --- logging ----------------------------------------------------------------

test('no object name ever reaches the log', async () => {
  // These paths are the org / tournament / gallery / session UUIDs of a real
  // upload, and this is the same stream the rest of the worker keeps free of
  // identities.
  const lines = [];
  const storage = fakeStorage({ failOn: new Set([B]) });
  const purger = createQuarantinePurger({
    storage, logger: (event, detail) => lines.push(JSON.stringify({ event, detail })),
  });
  await purger.purge({
    purgeable: [
      { bucket: BUCKET, objectName: A },
      { bucket: BUCKET, objectName: B },
      { bucket: 'other', objectName: C },
    ],
  });
  assert.ok(lines.length > 0, 'a failure must be observable');
  const blob = lines.join('\n');
  for (const name of [A, B, C]) {
    assert.equal(blob.includes(name), false, 'an object name leaked into the log');
  }
  assert.ok(blob.includes('quarantine_sweep_failed'));
  assert.ok(blob.includes('quarantine_sweep_rejected'));
  // The Storage status is what an operator can act on, so it is kept.
  assert.ok(blob.includes('STORAGE_REMOVE_FAILED:500'));
});

test('a quiet sweep stays quiet', async () => {
  const lines = [];
  const purger = createQuarantinePurger({
    storage: fakeStorage(), logger: (event) => lines.push(event),
  });
  await purger.purge(sweep());
  assert.deepEqual(lines, []);
});
