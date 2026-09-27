// COMPETITION-V1 — the reconciliation 43 → 117 (+1) stays true: every RPC of the gateway delta is either one of the 15
// of 0004 (closed by 0001) or already granted to authenticated since the baseline, has a real UI caller, was exercised
// on both gateways and has negative evidence; the committed RECONCILIATION.json is the generator's output.
//   node --test backend/torneos/competition-v1/reconcile.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';

const script = new URL('./reconcile.mjs', import.meta.url).pathname;

test('reconcile --check: A 15 + B 59 = 74 authenticated, C 1 public, every invariant holds', () => {
  const r = spawnSync(process.execPath, [script, '--check'], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /RECONCILIATION_OK \{"A":15,"B":59,"C":1\}/);
});

test('committed RECONCILIATION.json: 75 rows, nothing removed, A rows closed before 0004, B rows open before 0004', () => {
  const doc = JSON.parse(fs.readFileSync(new URL('./RECONCILIATION.json', import.meta.url), 'utf8'));
  assert.equal(doc.rows.length, 75);
  assert.deepEqual(doc.summary.failures, []);
  assert.equal(doc.summary.removed_from_allowlist, 0);
  for (const r of doc.rows) {
    if (r.class === 'A') assert.deepEqual([r.execute_before_0004.authenticated, r.execute_before_0004.gated_by_0001, r.execute_after_0004.authenticated], [false, true, true], r.rpc);
    if (r.class === 'B') assert.deepEqual([r.execute_before_0004.authenticated, r.execute_before_0004.gated_by_0001], [true, false], r.rpc);
    assert.ok(r.ui.length > 0, r.rpc);
  }
});
