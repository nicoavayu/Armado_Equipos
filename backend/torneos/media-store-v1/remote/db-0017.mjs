#!/usr/bin/env node
// MEDIA-STORE-V1 0017 operator driver for the Torneos Production DB (gate D). Same transport and discipline as
// connected-v1/remote/db-0015-0016.mjs:
//   node backend/torneos/media-store-v1/remote/db-0017.mjs observe                                   (read only)
//   node backend/torneos/media-store-v1/remote/db-0017.mjs apply-0017    APPLY TORNEOS 0017 <ref> <sha12 of 0017>
//   node backend/torneos/media-store-v1/remote/db-0017.mjs rollback-0017 ROLLBACK TORNEOS 0017 <ref> <sha12 of its rollback>
// Transport = the certified OEC/CV1 one (installer postgres.<ref>, Session Pooler sa-east-1:5432, verify-full + Supabase
// CA, the installer password read from the macOS Keychain into memory only and redacted from every output). Every write
// is gated by the exact phrase, the file sha256, the exact observed state before (PRE_0017 → POST_0017 and back) and
// after, and "nothing else moved": every other function (body, ACL, owner, secdef flag, config), every relation and
// every policy of public / private / storage, and both buckets (private, limits, types). The EXECUTE counts move by
// exactly the one RPC 0017 adds (authenticated +1, anon +0). The two bodies are pinned by md5 in POST_0017.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '../../../..');
export const REF = 'onzpwnqxnvlgsevivngf';
const file = (rel, sha256, from, to) => Object.freeze({ path: path.join(REPO, rel), rel, sha256, from, to, phase: '0017' });
export const FILES = Object.freeze({
  'apply-0017': file('backend/torneos/supabase/migrations/00000000000017_media_store_v1.sql',
    '57d4fe759c2bc9ae4d5e272d98d20cdc73465ddd2020e0c5c44418440778cc19', 'PRE_0017', 'POST_0017'),
  'rollback-0017': file('backend/torneos/media-store-v1/rollback/00000000000017_media_store_v1.rollback.sql',
    'fdaf00cf7dfd9d1fbfb08890deaa10e93e0f367dc5bf085cda0811bcfd20c7c9', 'POST_0017', 'PRE_0017'),
});
/** md5(prosrc) of what 0017 installs (the exact text between the dollar quotes of the migration file). */
export const BODIES = Object.freeze({
  PRE_0017: Object.freeze({ authorize: null, in_use: null }),
  POST_0017: Object.freeze({ authorize: '27c94843c2e3a7d9f05df448f464f069', in_use: 'fd7eb865713c713c96e595f9a35ce230' }),
});
export const ACL = Object.freeze({
  authorize: Object.freeze({ secdef: true, config: ['search_path=""'], authenticated: true, anon: false, service_role: false }),
  in_use: Object.freeze({ secdef: true, config: ['search_path=""'], authenticated: false, anon: false, service_role: false }),
});
export const PRIVATE_BUCKETS = Object.freeze({
  'tournament-branding': Object.freeze({ public: false, limit: 2097152, mime: ['image/jpeg', 'image/png', 'image/webp'] }),
  'tournament-media': Object.freeze({ public: false, limit: 4194304, mime: ['image/jpeg', 'image/png', 'image/webp'] }),
});
const sha256 = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/** PRE_0017 | POST_0017 | DRIFT, with every reason. Pure. */
export function classify(catalog) {
  if (!catalog || catalog.torneos_tables !== true) return { state: 'DRIFT', failures: ['not_the_torneos_db'] };
  const failures = [];
  if (catalog.prerequisites?.branding !== true) failures.push('branding_v1_missing');
  if (catalog.prerequisites?.media !== true) failures.push('media_v1_missing');
  for (const [id, want] of Object.entries(PRIVATE_BUCKETS)) {
    if (!same(catalog.buckets?.[id], want)) failures.push(`bucket ${id} ${JSON.stringify(catalog.buckets?.[id])}`);
  }
  const state = Object.entries(BODIES).find(([, pin]) => same(pin, catalog.bodies))?.[0];
  if (!state) return { state: 'DRIFT', failures: [...failures, `bodies ${JSON.stringify(catalog.bodies)}`] };
  for (const name of Object.keys(ACL)) {
    const want = state === 'POST_0017' ? ACL[name] : null;
    if (!same(catalog.acl?.[name] ?? null, want)) failures.push(`acl.${name} ${JSON.stringify(catalog.acl?.[name])}`);
  }
  if (failures.length) return { state: 'DRIFT', failures };
  return { state, failures: [] };
}

/** What 0017 must not touch: the names of the sections that changed (counts: exactly +1 authenticated on apply, −1 on rollback). */
export function changedOutside(before, after, direction) {
  const moved = ['kept_fn', 'kept_relations', 'kept_policies', 'buckets'].filter((key) => !same(before[key], after[key]));
  const delta = direction === 'apply' ? 1 : -1;
  if (after.counts?.authenticated !== (before.counts?.authenticated ?? NaN) + delta || after.counts?.anon !== before.counts?.anon) moved.push('counts');
  return moved;
}

export function phraseFor(mode) {
  const f = FILES[mode];
  if (!f) throw new Error('usage: observe | apply-0017 | rollback-0017 <phrase>');
  return `${mode.split('-')[0].toUpperCase()} TORNEOS ${f.phase} ${REF} ${f.sha256.slice(0, 12)}`;
}

/** The whole operator decision, with injected I/O (tested offline with fakes and on the hosted-like lab). */
export async function run(mode, args, { readFile = fs.readFileSync, catalog, applySql }) {
  const out = { mode, target: REF };
  if (mode === 'observe') {
    out.catalog = await catalog();
    out.verdict = classify(out.catalog);
    return out;
  }
  const phrase = phraseFor(mode);
  if (args.join(' ') !== phrase) throw new Error(`PHRASE_REQUIRED: ${phrase}`);
  const f = FILES[mode];
  const bytes = readFile(f.path);
  if (sha256(bytes) !== f.sha256) throw new Error('FILE_HASH_MISMATCH');
  const before = await catalog();
  const pre = classify(before);
  if (pre.state === 'DRIFT' || pre.state !== f.from) throw new Error(`PRE_STATE_${pre.state} ${pre.failures.join('; ')}`);
  out.psql = await applySql(bytes.toString('utf8'));
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
  const sql = fs.readFileSync(path.join(HERE, 'sql-catalog-0017.sql'), 'utf8').trim();
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
    applySql: (text) => applySql({ sql: text, env: CV1.installerEnv({ password: secret(), app: 'arma2-torneos-media-store-0017' }), redact }),
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
