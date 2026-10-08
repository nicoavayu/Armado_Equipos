// COMMERCE-PRODUCTION — 0013 and the gallery's 0014 commute. Production may receive the gallery first (C2: 0012 + 0014)
// and Premium later (C3: 0013), the reverse of the file order every lab uses, so both orders run here on a disposable
// database of its own (arma2-commerce-production-lab-ord, port 58653) with the REAL driver (remote/db-0013.mjs) and the
// REAL catalog SQL: 0013 applies and rolls back over 0014 without touching it, and 0014 applies over 0013 without
// touching any commerce object.
//   node --test backend/torneos/commerce-production/migration-order.test.mjs
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

process.env.COMMERCE_PRODUCTION_LAB_CONTAINER = 'arma2-commerce-production-lab-ord';
process.env.COMMERCE_PRODUCTION_LAB_PORT = '58653';
const lab = await import('./lab/pg-lab.mjs');
const D = await import('./remote/db-0013.mjs');
const HERE = path.dirname(fileURLToPath(import.meta.url));
const CATALOG_SQL = fs.readFileSync(path.join(HERE, 'remote/sql-catalog.sql'), 'utf8').trim();
const MIGRATION_0013 = '00000000000013_mercadopago_checkout_pro_production.sql';
const MIGRATION_0014 = '00000000000014_media_gallery_draft_on_retire.sql';
const sha256 = (b) => crypto.createHash('sha256').update(b).digest('hex');

const deps = {
  catalog: async () => JSON.parse(lab.sql(CATALOG_SQL).trim().split('\n').filter(Boolean).pop()),
  applySql: async (text) => { const r = lab.sqlTry(text); return { code: r.ok ? 0 : 1, stderr_tail: r.error ?? '' }; },
  keychain: null,
  scram: () => { throw new Error('not used'); },
};
const run = (mode, ...args) => D.run(mode, args.flatMap((a) => String(a).split(' ')), deps);
const apply = () => run('apply-0013', `APPLY TORNEOS 0013 ${D.REF} ${D.FILES['apply-0013'].sha256.slice(0, 12)}`);
const rollback = () => run('rollback-0013', `ROLLBACK TORNEOS 0013 ${D.REF} ${D.FILES['rollback-0013'].sha256.slice(0, 12)}`);

/** Applies one migration file as the installer and records it in the lab ledger (out of file order on purpose). */
function applyFile(name) {
  const text = fs.readFileSync(path.join(lab.MIGRATIONS_DIR, name), 'utf8');
  lab.sql(text);
  lab.sql(`INSERT INTO lab_meta.torneos_migrations (name, sha256) VALUES ('${name}', '${sha256(text)}') ON CONFLICT (name) DO NOTHING`);
}
// The two gallery bodies 0014 replaces (its own pins: before bbf72451… / 9eb5ac61…, after ec3357d4… / b16c376a…).
const mediaBodies = () => JSON.parse(lab.sql(`select json_build_object(
  'transition', (select md5(prosrc) from pg_proc where oid = 'public.transition_tournament_media_asset(uuid,text,text)'::regprocedure),
  'publish', (select md5(prosrc) from pg_proc where oid = 'public.publish_tournament_media_gallery(uuid)'::regprocedure))`).trim());

after(() => lab.down());

test('0012 → 0014 → 0013 (gallery first, as C2 then C3): the driver applies and rolls back 0013 over 0014, which stays intact', async () => {
  await lab.up({ fresh: true, upTo: lab.BEFORE_0013 });
  applyFile(MIGRATION_0014);
  const gallery = mediaBodies();
  assert.ok(gallery.transition.startsWith('ec3357d4') && gallery.publish.startsWith('b16c376a'), JSON.stringify(gallery));
  assert.equal(D.classify(await deps.catalog()).state, 'PRE_0013');

  const applied = await apply();
  assert.deepEqual([applied.verdict, applied.before, applied.after, applied.outsideUnchanged, applied.scope], ['APPLY_0013_DONE', 'PRE_0013', 'POST_0013', true, 'off']);
  assert.deepEqual(mediaBodies(), gallery, '0013 leaves the gallery bodies untouched');

  const rolled = await rollback();
  assert.deepEqual([rolled.verdict, rolled.after, rolled.outsideUnchanged], ['ROLLBACK_0013_DONE', 'PRE_0013', true]);
  assert.deepEqual(mediaBodies(), gallery, 'the 0013 rollback leaves the gallery bodies untouched');
});

test('0012 → 0013 → 0014 (file order): 0014 applies over 0013 and no commerce object moves', async () => {
  await lab.up({ fresh: true, upTo: lab.BEFORE_0013 });
  applyFile(MIGRATION_0013);
  const before = await deps.catalog();
  assert.equal(D.classify(before).state, 'POST_0013');

  applyFile(MIGRATION_0014);
  const after = await deps.catalog();
  assert.equal(D.classify(after).state, 'POST_0013');
  assert.deepEqual(after.test_chain, before.test_chain, 'the TEST commerce chain is byte-identical');
  for (const key of ['production_functions', 'production_role', 'production_tables', 'isolation_trigger', 'environment_check', 'scope', 'production_logins', 'test_logins']) {
    assert.deepEqual(after[key], before[key], key);
  }
  const gallery = mediaBodies();
  assert.ok(gallery.transition.startsWith('ec3357d4') && gallery.publish.startsWith('b16c376a'), JSON.stringify(gallery));
});
