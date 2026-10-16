// ACCOUNT ERASURE 0021 ↔ PREMIUM SPONSORS 0020 (#212, another branch): both orders. The main+0020 run of the other suites
// covers 0020 → 0021; this one covers 0021 → 0020 on the main lab: 0020 (its own strict pre/post checks: every other
// function, relation and policy unchanged) applies over 0021, and 0021 is still POST_0021 afterwards. Runs only with
// ACCOUNT_DELETION_0020_FILE=<path of 00000000000020_premium_sponsors.sql> (the file is not in this branch).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const FILE = process.env.ACCOUNT_DELETION_0020_FILE;
test('0021 → 0020: 0020 applies over 0021 as the installer and 0021 stays POST_0021 (sponsors detected)', { skip: !FILE && 'needs ACCOUNT_DELETION_0020_FILE' }, async () => {
  const { prepare, toPost, drive, asPostgres, one } = await import('./test/lab.mjs');
  const { evidence } = await import('./test/support.mjs');
  const record = evidence('order-0021-then-0020-lab');
  await prepare();
  await toPost();
  assert.equal(one("select to_regclass('public.tournament_organization_sponsors') is null"), 't', 'the main lab has no 0020 yet');
  const before = await drive('observe');
  assert.equal(before.verdict.state, 'POST_0021');
  const applied = asPostgres(fs.readFileSync(FILE, 'utf8'));
  assert.equal(applied.code, 0, applied.stderr_tail);
  const after = await drive('observe');
  assert.deepEqual(after.verdict, { state: 'POST_0021', failures: [] });
  assert.equal(after.catalog.prerequisites.sponsors_0020, true);
  record({ check: '0021 then 0020', ok: true, details: { before: before.verdict.state, apply0020: applied.code, after: after.verdict.state, sponsors0020: true } });
});
