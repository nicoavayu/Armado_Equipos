#!/usr/bin/env node
// MEDIA-STORE-V1 0017 — the operator driver's real transitions on the hosted-like lab (LOCAL ONLY). The same run() and
// the same read-only catalog as Production; only the transport differs (psql inside the lab's torneos-db, never a
// remote target). The writes run as `postgres` (the hosted installer), never as the lab superuser:
//   PHASE3A_LAB_PROJECT=<lab> TORNEOS_BRANDING_MODE=on node backend/torneos/media-store-v1/lab/db-0017-lab.mjs
// Sequence: observe → (the lab installed 0017 as supabase_admin: remove it with the rollback file as that owner) →
// apply as postgres → refused re-apply → rollback as postgres → apply again as postgres. Prints one JSON evidence line
// per step; exits 1 on the first unexpected verdict.
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { sqlTry } from '../../../../integration/torneos-core-contracts/lab.mjs';
import { FILES, REF, phraseFor, run } from '../remote/db-0017.mjs';
import { run as run0012 } from '../../media-v1/remote/db-0012.mjs';

const CATALOG = fs.readFileSync(fileURLToPath(new URL('../remote/sql-catalog-0017.sql', import.meta.url)), 'utf8').trim();
const CATALOG_0012 = fs.readFileSync(fileURLToPath(new URL('../../media-v1/remote/sql-catalog.sql', import.meta.url)), 'utf8').trim();
const readOnly = (sql) => `BEGIN TRANSACTION READ ONLY;\nselect (\n${sql}\n)::text;\nROLLBACK;\n`;
const deps = (user, catalogSql = CATALOG) => ({
  catalog: async () => {
    const r = sqlTry('torneos-db', readOnly(catalogSql), 'postgres');
    if (!r.ok) throw new Error(`CATALOG_READ_FAILED ${r.error}`);
    return JSON.parse(r.out.trim().split('\n').filter(Boolean).pop());
  },
  applySql: async (text) => { const r = sqlTry('torneos-db', text, user); return { code: r.ok ? 0 : 1, stderr_tail: r.ok ? '' : r.error }; },
});
const show = (step, out) => console.log(JSON.stringify({ step, verdict: out.verdict, before: out.before, after: out.after,
  changedOutside: out.changedOutside, failures: out.failures, psql: out.psql?.code, error: out.psql?.stderr_tail || undefined }));
const expect = (out, verdict) => { if ((typeof out.verdict === 'string' ? out.verdict : out.verdict?.state) !== verdict) process.exit(1); };

// Hosted: the baseline was installed by `postgres`, which owns public/private and everything in them. This lab installs
// as supabase_admin, so `postgres` lacks CREATE on private (0009 and 0012 already create functions there in Production).
// The one lab-only emulation: that CREATE right. Everything else postgres has here is a subset of what it has hosted,
// so a pass here is not optimistic about privileges.
const emulated = sqlTry('torneos-db', 'GRANT CREATE ON SCHEMA private TO postgres;');
if (!emulated.ok) throw new Error(`lab emulation failed: ${emulated.error}`);
const first = await run('observe', [], deps('postgres'));
console.log(JSON.stringify({ step: 'observe', state: first.verdict.state, failures: first.verdict.failures, buckets: first.catalog.buckets,
  bodies: first.catalog.bodies, acl: first.catalog.acl, counts: first.catalog.counts }));
if (first.verdict.state === 'POST_0017') {
  const owner = sqlTry('torneos-db', "select pg_get_userbyid(proowner) from pg_proc where proname = 'authorize_tournament_storage_objects'").out.trim();
  const removed = await run('rollback-0017', phraseFor('rollback-0017').split(' '), deps(owner === 'postgres' ? 'postgres' : 'supabase_admin'));
  show(`rollback (as the lab installer ${owner})`, removed); expect(removed, 'ROLLBACK_0017_DONE');
}
const applied = await run('apply-0017', phraseFor('apply-0017').split(' '), deps('postgres'));
show('apply as postgres', applied); expect(applied, 'APPLY_0017_DONE');
console.log(JSON.stringify({ step: 'owner after apply', owner: sqlTry('torneos-db', "select string_agg(distinct pg_get_userbyid(proowner), ',') from pg_proc where proname in ('authorize_tournament_storage_objects', 'tournament_branding_object_in_use')").out.trim() }));
const again = await run('apply-0017', phraseFor('apply-0017').split(' '), deps('postgres')).catch((error) => ({ verdict: String(error.message).slice(0, 80) }));
console.log(JSON.stringify({ step: 'apply again (must be refused before any write)', verdict: again.verdict }));
if (!/^PRE_STATE_POST_0017/.test(again.verdict)) process.exit(1);
const back = await run('rollback-0017', phraseFor('rollback-0017').split(' '), deps('postgres'));
show('rollback as postgres', back); expect(back, 'ROLLBACK_0017_DONE');
const reapplied = await run('apply-0017', phraseFor('apply-0017').split(' '), deps('postgres'));
show('re-apply as postgres', reapplied); expect(reapplied, 'APPLY_0017_DONE');
console.log(JSON.stringify({ step: 'files', apply: FILES['apply-0017'].sha256, rollback: FILES['rollback-0017'].sha256 }));

// The Galería switch (d4-run.sh media-on = db-0012 `mode MVP_SIMPLE`) with 0017 installed: it must still recognise the
// state (POST_0014 + exactly the 0017 delta), switch, and move nothing else.
const media = await run0012('observe', [], deps('postgres', CATALOG_0012));
console.log(JSON.stringify({ step: 'db-0012 observe with 0017', state: media.verdict.state, failures: media.verdict.failures, mode: media.catalog.mode,
  media_store: media.catalog.media_store, commerce: media.catalog.commerce, counts: media.catalog.counts }));
if (media.verdict.state !== 'POST_0014') process.exit(1);
const on = await run0012('mode', ['MVP_SIMPLE', ...`SET TORNEOS MEDIA PIPELINE MODE MVP_SIMPLE ${REF}`.split(' ')], deps('postgres', CATALOG_0012));
console.log(JSON.stringify({ step: 'db-0012 mode MVP_SIMPLE (media-on)', verdict: on.verdict, before: on.before, after: on.after, modeBefore: on.modeBefore,
  modeAfter: on.modeAfter, changedOutside: on.changedOutside }));
if (on.verdict !== 'MODE_MVP_SIMPLE_DONE') process.exit(1);
const refused = await run0012('rollback-0012', [], deps('postgres', CATALOG_0012)).catch((error) => ({ verdict: String(error.message).slice(0, 60) }));
console.log(JSON.stringify({ step: 'db-0012 rollback without its phrase (refused before any read)', verdict: refused.verdict }));
const after0017 = await run('observe', [], deps('postgres'));
console.log(JSON.stringify({ step: 'db-0017 observe after media-on', state: after0017.verdict.state, failures: after0017.verdict.failures }));
if (after0017.verdict.state !== 'POST_0017') process.exit(1);
