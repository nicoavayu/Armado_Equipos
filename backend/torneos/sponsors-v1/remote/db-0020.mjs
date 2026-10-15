#!/usr/bin/env node
// PREMIUM SPONSORS 0020 operator driver for the Torneos Production DB. PREPARED ONLY: it is unit-tested offline and
// rehearsed on the local lab (sponsors-0020.test.mjs); it is never run against a remote without Nico's explicit GO.
// Same transport and discipline as media-store-v1/remote/db-0017.mjs:
//   node backend/torneos/sponsors-v1/remote/db-0020.mjs observe                                     (read only)
//   node backend/torneos/sponsors-v1/remote/db-0020.mjs apply-0020    APPLY TORNEOS 0020 <ref> <sha12 of 0020>
//   node backend/torneos/sponsors-v1/remote/db-0020.mjs rollback-0020 ROLLBACK TORNEOS 0020 <ref> <sha12 of its rollback>
//   node backend/torneos/sponsors-v1/remote/db-0020.mjs rollback-0020 ROLLBACK TORNEOS 0020 <ref> <sha12> DISCARD SPONSOR ROWS
//     (the only way to roll back while sponsor rows exist: the file itself refuses otherwise)
// Transport = the certified OEC/CV1 one (installer postgres.<ref>, Session Pooler sa-east-1:5432, verify-full + Supabase
// CA, the installer password read from the macOS Keychain into memory only and redacted from every output). Every write
// is gated by the exact phrase, the file sha256, the exact observed state before (PRE_0020 → POST_0020 and back) and
// after, and "nothing else moved": every other function (body, ACL, owner, secdef flag, config), every relation and
// every policy of public / private / storage, and the branding bucket. The EXECUTE counts move by exactly the four RPCs
// 0020 adds (authenticated +4, anon +0). Every body 0020 installs is pinned by md5 in POST_0020.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '../../../..');
export const REF = 'onzpwnqxnvlgsevivngf';
const file = (rel, sha256, from, to) => Object.freeze({ path: path.join(REPO, rel), rel, sha256, from, to, phase: '0020' });
export const FILES = Object.freeze({
  'apply-0020': file('backend/torneos/supabase/migrations/00000000000020_premium_sponsors.sql',
    'edd9a83e6b1f360659ecc2a7d5fd303a87a1361eaf3ac7ab17ad21efd14b897e', 'PRE_0020', 'POST_0020'),
  'rollback-0020': file('backend/torneos/sponsors-v1/rollback/00000000000020_premium_sponsors.rollback.sql',
    'dc8422ca7f99c63773e46cfefd3d005912bc7bda029470fdacf2429be33e41dd', 'POST_0020', 'PRE_0020'),
});
/** The session setting the rollback file honours to discard sponsor rows (see its header). */
export const FORCE_WORDS = 'DISCARD SPONSOR ROWS';
export const FORCE_SQL = `SET torneos.sponsors_rollback_force = '${FORCE_WORDS}';\n`;
/** md5(prosrc): PRE_0020 = 0017's in_use and nothing of 0020; POST_0020 = the exact text between the dollar quotes of the migration. */
export const BODIES = Object.freeze({
  PRE_0020: Object.freeze({ in_use: 'fd7eb865713c713c96e595f9a35ce230', entitled: null, get: null, upsert: null, archive: null, authorize: null }),
  POST_0020: Object.freeze({
    in_use: '8189dc2bebca6c29ca15eb6840d95c91', entitled: 'b2290185d145ca7f611d32ae4ad61c72', get: '1da369a35b85046f46b39bd58345b760',
    upsert: '3aba4c646ace22abdb7c2b5879506dcd', archive: '23ba6885cb807d91d669536166e9e655', authorize: 'd15f11f46d6ae896f5ecf6f3b470e5a5',
  }),
});
const rpc = Object.freeze({ secdef: true, config: ['search_path=""'], authenticated: true, anon: false, service_role: false });
const closed = Object.freeze({ secdef: true, config: ['search_path=""'], authenticated: false, anon: false, service_role: false });
export const ACL = Object.freeze({
  PRE_0020: Object.freeze({ in_use: closed, entitled: null, get: null, upsert: null, archive: null, authorize: null }),
  POST_0020: Object.freeze({ in_use: closed, entitled: closed, get: rpc, upsert: rpc, archive: rpc, authorize: rpc }),
});
export const TABLE = Object.freeze({ PRE_0020: null, POST_0020: Object.freeze({ rls: true, api_grants: false, policies: 0 }) });
export const BRANDING_BUCKET = Object.freeze({
  'tournament-branding': Object.freeze({ public: false, limit: 2097152, mime: ['image/jpeg', 'image/png', 'image/webp'] }),
});
/** authenticated EXECUTE delta of apply (rollback: the opposite); anon never moves. */
export const RPC_DELTA = 4;
const sha256 = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/** PRE_0020 | POST_0020 | DRIFT, with every reason. Pure. */
export function classify(catalog) {
  if (!catalog || catalog.torneos_tables !== true) return { state: 'DRIFT', failures: ['not_the_torneos_db'] };
  const failures = [];
  if (catalog.prerequisites?.media_store !== true) failures.push('media_store_v1_missing');
  if (catalog.prerequisites?.season_lifecycle !== true) failures.push('season_lifecycle_0018_missing');
  if (catalog.prerequisites?.sponsors_capability !== true) failures.push('sponsors_capability_not_premium_only');
  if (!same(catalog.buckets, BRANDING_BUCKET)) failures.push(`buckets ${JSON.stringify(catalog.buckets)}`);
  const state = Object.entries(BODIES).find(([, pin]) => same(pin, catalog.bodies))?.[0];
  if (!state) return { state: 'DRIFT', failures: [...failures, `bodies ${JSON.stringify(catalog.bodies)}`] };
  for (const name of Object.keys(ACL[state])) {
    if (!same(catalog.acl?.[name] ?? null, ACL[state][name])) failures.push(`acl.${name} ${JSON.stringify(catalog.acl?.[name])}`);
  }
  if (!same(catalog.table ?? null, TABLE[state])) failures.push(`table ${JSON.stringify(catalog.table)}`);
  if (state === 'PRE_0020' && catalog.rows != null) failures.push('rows_without_table');
  if (state === 'POST_0020' && !(Number.isInteger(catalog.rows) && catalog.rows >= 0)) failures.push(`rows ${catalog.rows}`);
  if (failures.length) return { state: 'DRIFT', failures };
  return { state, failures: [] };
}

/** What 0020 must not touch: the names of the sections that changed (counts: exactly +4 authenticated on apply, −4 on rollback). */
export function changedOutside(before, after, direction) {
  const moved = ['kept_fn', 'kept_relations', 'kept_policies', 'buckets'].filter((key) => !same(before[key], after[key]));
  const delta = direction === 'apply' ? RPC_DELTA : -RPC_DELTA;
  if (after.counts?.authenticated !== (before.counts?.authenticated ?? NaN) + delta || after.counts?.anon !== before.counts?.anon) moved.push('counts');
  return moved;
}

export function phraseFor(mode, { force = false } = {}) {
  const f = FILES[mode];
  if (!f) throw new Error('usage: observe | apply-0020 | rollback-0020 <phrase>');
  if (force && mode !== 'rollback-0020') throw new Error('FORCE_ONLY_FOR_ROLLBACK');
  return `${mode.split('-')[0].toUpperCase()} TORNEOS ${f.phase} ${REF} ${f.sha256.slice(0, 12)}${force ? ` ${FORCE_WORDS}` : ''}`;
}

/** The whole operator decision, with injected I/O (tested offline with fakes and on the local lab as the installer). */
export async function run(mode, args, { readFile = fs.readFileSync, catalog, applySql }) {
  const out = { mode, target: REF };
  if (mode === 'observe') {
    out.catalog = await catalog();
    out.verdict = classify(out.catalog);
    return out;
  }
  const force = mode === 'rollback-0020' && args.join(' ') === phraseFor(mode, { force: true });
  const phrase = phraseFor(mode);
  if (!force && args.join(' ') !== phrase) throw new Error(`PHRASE_REQUIRED: ${phrase}`);
  const f = FILES[mode];
  const bytes = readFile(f.path);
  if (sha256(bytes) !== f.sha256) throw new Error('FILE_HASH_MISMATCH');
  const before = await catalog();
  const pre = classify(before);
  if (pre.state === 'DRIFT' || pre.state !== f.from) throw new Error(`PRE_STATE_${pre.state} ${pre.failures.join('; ')}`);
  // Sponsors are user data: without the explicit force phrase a rollback with rows is refused before any write.
  if (mode === 'rollback-0020' && before.rows > 0 && !force) throw new Error(`ROLLBACK_REFUSED ${before.rows} sponsor rows (force phrase required)`);
  out.forced = force;
  out.psql = await applySql(`${force ? FORCE_SQL : ''}${bytes.toString('utf8')}`);
  const after = await catalog();
  const post = classify(after);
  const moved = changedOutside(before, after, mode.startsWith('apply') ? 'apply' : 'rollback');
  out.before = pre.state; out.after = post.state; out.changedOutside = moved;
  if (post.failures.length) out.failures = post.failures;
  const ok = out.psql.code === 0 && post.state === f.to && !moved.length;
  out.verdict = `${mode.toUpperCase().replace('-', '_')}_${ok ? 'DONE' : 'FAILED'}`;
  return out;
}

async function realDeps() {
  const infra = path.join(REPO, 'backend/torneos/infra');
  const C = await import(path.join(infra, 'torneos-officialization-error-v1/oec-remote-contract.mjs'));
  const CV1 = await import(path.join(infra, 'torneos-competition-v1/competition-remote.mjs'));
  const { runPsqlProbe } = await import(path.join(infra, 'torneos-payments-test/payments-db.mjs'));
  const { applySql } = await import(path.join(infra, 'torneos-gateway-auth/psql-gateway-auth.mjs'));
  const { systemKeychain } = await import(path.join(infra, 'torneos-gateway-auth/keychain-gateway-auth.mjs'));
  if (C.TORNEOS_REF !== REF) throw new Error('REF_MISMATCH');
  let password = null;
  const secret = () => password ?? (password = systemKeychain().dataplane.read());
  const redact = (s) => { let t = String(s ?? ''); if (password) t = t.split(password).join('[REDACTED]'); return t; };
  const sql = fs.readFileSync(path.join(HERE, 'sql-catalog-0020.sql'), 'utf8').trim();
  return {
    redact,
    wipe: () => { password = null; },
    catalog: async () => {
      const r = await runPsqlProbe({ script: C.readOnlyScript(sql), env: CV1.readOnlyEnv({ password: secret() }), redact });
      if (r.code !== 0) throw new Error(`CATALOG_READ_FAILED ${r.code} ${r.stderr_tail}`);
      const line = r.stdout.trim().split('\n').filter(Boolean).pop();
      if (!line) throw new Error(`CATALOG_READ_EMPTY ${r.stderr_tail ?? ''}`);
      return JSON.parse(line);
    },
    applySql: (text) => applySql({ sql: text, env: CV1.installerEnv({ password: secret(), app: 'arma2-torneos-sponsors-0020' }), redact }),
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [mode, ...args] = process.argv.slice(2);
  const output = { at: new Date().toISOString(), transport: 'psql aws-0-sa-east-1.pooler.supabase.com:5432 verify-full' };
  let deps = null;
  try {
    deps = await realDeps();
    Object.assign(output, await run(mode, args, deps));
  } catch (error) {
    output.error = (deps?.redact ?? String)(error?.message ?? error).slice(0, 600);
  }
  deps?.wipe();
  process.stdout.write(`${JSON.stringify(output, null, 1)}\n`);
  process.exit(output.error || /FAILED/.test(output.verdict || '') ? 1 : 0);
}
