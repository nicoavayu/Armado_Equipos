#!/usr/bin/env node
// CONNECTED-V1 0009 + BRANDING-V1 0010 + roster search 0011 operator driver for the Torneos Production DB (gate D).
// Never run by CI or by the operator without GO. Same transport and discipline as social-v1/remote/db8.mjs:
//   node backend/torneos/connected-v1/remote/db-0009-0011.mjs observe                                     (read only)
//   node backend/torneos/connected-v1/remote/db-0009-0011.mjs apply-0009    APPLY TORNEOS 0009 <ref> <sha12 of 0009>
//   node backend/torneos/connected-v1/remote/db-0009-0011.mjs apply-0010    APPLY TORNEOS 0010 <ref> <sha12 of 0010>
//   node backend/torneos/connected-v1/remote/db-0009-0011.mjs apply-0011    APPLY TORNEOS 0011 <ref> <sha12 of 0011>
//   node backend/torneos/connected-v1/remote/db-0009-0011.mjs rollback-0011 ROLLBACK TORNEOS 0011 <ref> <sha12 of its rollback>
//   node backend/torneos/connected-v1/remote/db-0009-0011.mjs rollback-0010 ROLLBACK TORNEOS 0010 <ref> <sha12 of its rollback>
//   node backend/torneos/connected-v1/remote/db-0009-0011.mjs rollback-0009 ROLLBACK TORNEOS 0009 <ref> <sha12 of its rollback>
// Transport = the certified OEC/CV1 one (installer postgres.<ref>, Session Pooler sa-east-1:5432, verify-full + Supabase CA,
// password read from the macOS Keychain into memory only, redacted from every output). Each write is gated by the exact
// phrase, the file sha256 and the exact observed state before (POST_0008 → POST_0009 → POST_0010 → POST_0011) and after;
// everything that existed before 0009 (function bodies/ACL/owner/config, relations, policies, other buckets) must be
// identical before and after, except the two certified bodies 0011 replaces, which are pinned by md5 in every state. The
// rollbacks of 0009/0010 are destructive for what they created (see docs/torneos/connected-product/DEPLOY.md): containment of
// last resort, after the flags are off, with an export of the new tables. 0011's rollback only restores two bodies.
// rollback-0010 leaves the private bucket row and its objects (unreachable without policies); classify() accepts exactly
// that residue, so rollback-0009 and a later apply-0010 (bucket upsert) still pass their gates (found on the rehearsal lab).
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '../../../..');
export const REF = 'onzpwnqxnvlgsevivngf';
const file = (rel, sha256, from, to, phase) => Object.freeze({ path: path.join(REPO, rel), rel, sha256, from, to, phase });
export const FILES = Object.freeze({
  'apply-0009': file('backend/torneos/supabase/migrations/00000000000009_connected_product_v1.sql',
    '8bb8e6c84bbe0acb6d5976a49fde88d2fbd55626a6001e595c5c2cc8db994cac', 'POST_0008', 'POST_0009', '0009'),
  'apply-0010': file('backend/torneos/supabase/migrations/00000000000010_branding_v1.sql',
    '55afd5e81bcc62a81b89c4299c452eec8d357291c96c34810d37f719f8d86ee8', 'POST_0009', 'POST_0010', '0010'),
  'apply-0011': file('backend/torneos/supabase/migrations/00000000000011_connected_roster_search.sql',
    '3cac4d885955242d4b544c2a2081d1cbb187cbc1b05b22ee6596571addd6703a', 'POST_0010', 'POST_0011', '0011'),
  'rollback-0011': file('backend/torneos/connected-v1/rollback/00000000000011_connected_roster_search.rollback.sql',
    '7fb0a3aeefbe98b630e1441df1f8fdeaf053af8a58a93e8579ecd2b64955ec66', 'POST_0011', 'POST_0010', '0011'),
  'rollback-0010': file('backend/torneos/branding-v1/rollback/00000000000010_branding_v1.rollback.sql',
    '9c4fbec327715495609cbb56661b677d2f70ec9c3cff8830c9a1547a8134de27', 'POST_0010', 'POST_0009', '0010'),
  'rollback-0009': file('backend/torneos/connected-v1/rollback/00000000000009_connected_product_v1.rollback.sql',
    '291fb2d0fb5e2f1e655889e52e98e83a89916815095c72018507f67669f71157', 'POST_0009', 'POST_0008', '0009'),
});
export const CONNECTED_TABLES = Object.freeze(['tournament_catalog_listings', 'tournament_category_capacities', 'tournament_team_applications',
  'tournament_user_notifications', 'tournament_user_profiles']);
export const CONNECTED_TRIGGERS = Object.freeze(['tournament_team_entries_connected_guard', 'tournament_team_entries_notify_submitted', 'tournament_team_reviews_notify']);
export const CONNECTED_FUNCTIONS = 33;
export const BRANDING_POLICIES = Object.freeze(['tournament_branding_delete_authorized', 'tournament_branding_insert_authorized',
  'tournament_branding_select_authorized', 'tournament_branding_select_public', 'tournament_branding_update_denied']);
export const BRANDING_BUCKET = Object.freeze({ public: false, file_size_limit: 2097152, allowed_mime_types: ['image/jpeg', 'image/png', 'image/webp'] });
// EXECUTE counts on public functions (authenticated / anon). POST_0008 = Production's certified state (runbook §4);
// 0009 adds 19 authenticated (16 RPCs + 3 public) and 3 anon (the public catalog); 0010 adds 2 / 1.
// md5(prosrc) of public.search_tournament_players and private.authorize_core_contract: the certified bodies (baseline /
// 0005, also pinned by 0005) and the ones 0011 installs (only the season guard moved to the organization path).
export const ROSTER_SEARCH = Object.freeze({
  certified: Object.freeze({ search_md5: '194194571ffb20bd1946ab638ecac8e2', authorize_md5: '1ac5d5131cd7c3914ad6bda7df30019b' }),
  fixed: Object.freeze({ search_md5: '2c2616850c960260c57b7a6a2e475caf', authorize_md5: 'd04babede13de0b09f9a462e2279566b' }),
});
export const STATES = Object.freeze({
  POST_0008: Object.freeze({ counts: [172, 12], connected: false, branding: false, search: 'certified' }),
  POST_0009: Object.freeze({ counts: [191, 15], connected: true, branding: false, search: 'certified' }),
  POST_0010: Object.freeze({ counts: [193, 16], connected: true, branding: true, search: 'certified' }),
  POST_0011: Object.freeze({ counts: [193, 16], connected: true, branding: true, search: 'fixed' }),
});
const sha256 = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/** POST_0008 | POST_0009 | POST_0010 | POST_0011 | DRIFT, with every reason (and the accepted residue, if any). Pure. */
export function classify(catalog) {
  if (!catalog || catalog.torneos_tables !== true) return { state: 'DRIFT', failures: ['not_the_torneos_db'] };
  const failures = [];
  const c = catalog.connected || {}; const b = catalog.branding || {};
  const tables = [...(c.tables || [])].sort(); const triggers = [...(c.triggers || [])].sort(); const policies = [...(b.policies || [])].sort();
  const connected = tables.length > 0 || triggers.length > 0 || c.attestation_my_teams === true || (c.functions ?? 0) > 0;
  if (connected && !(same(tables, CONNECTED_TABLES) && same(triggers, CONNECTED_TRIGGERS) && c.attestation_my_teams === true && c.functions === CONNECTED_FUNCTIONS)) {
    failures.push(`connected_partial tables=${tables.length} triggers=${triggers.length} attestation=${c.attestation_my_teams} functions=${c.functions}`);
  }
  // rollback-0010 keeps the bucket row (Storage refuses to drop a bucket that still holds objects): a private bucket with
  // the exact 0010 configuration, without policies or read rules, is the expected residue of POST_0009 / POST_0008.
  const branding = policies.length > 0 || (b.functions ?? 0) > 0;
  const residue = !branding && b.bucket != null;
  if (branding) {
    if (!same(b.bucket, BRANDING_BUCKET)) failures.push(`bucket ${JSON.stringify(b.bucket)}`);
    if (!same(policies, BRANDING_POLICIES)) failures.push(`policies ${policies.join(',')}`);
    if (b.functions !== 2) failures.push(`branding_functions ${b.functions}`);
    if (!connected) failures.push('branding_without_connected');
  } else if (residue && !same(b.bucket, BRANDING_BUCKET)) failures.push(`bucket_residue ${JSON.stringify(b.bucket)}`);
  const search = Object.entries(ROSTER_SEARCH).find(([, pin]) => same(pin, catalog.roster_search))?.[0];
  if (!search) failures.push(`roster_search ${JSON.stringify(catalog.roster_search)}`);
  const state = Object.entries(STATES).find(([, s]) => s.connected === connected && s.branding === branding && s.search === search)?.[0];
  if (!state) return { state: 'DRIFT', failures: [...failures, 'no_state'] };
  const want = STATES[state].counts;
  if (catalog.counts?.authenticated !== want[0] || catalog.counts?.anon !== want[1]) failures.push(`counts ${catalog.counts?.authenticated}/${catalog.counts?.anon}`);
  if (failures.length) return { state: 'DRIFT', failures };
  return residue ? { state, failures: [], residue: ['tournament-branding bucket (private, no policies; kept by rollback-0010)'] } : { state, failures: [] };
}

/** What existed before 0009 must not move: returns the names of the sections that changed. */
export const changedOutside = (before, after) => ['kept_fn', 'kept_relations', 'kept_policies', 'other_buckets']
  .filter((key) => !same(before[key], after[key]));

/** The whole operator decision, with injected I/O (tested offline with fakes and on the rehearsal lab). */
export async function run(mode, words, { readFile = fs.readFileSync, catalog, applySql }) {
  const out = { mode, target: REF };
  if (mode === 'observe') {
    out.catalog = await catalog();
    out.verdict = classify(out.catalog);
    return out;
  }
  const f = FILES[mode];
  if (!f) throw new Error('usage: observe | apply-0009 | apply-0010 | apply-0011 | rollback-0011 | rollback-0010 | rollback-0009 <phrase>');
  const phrase = `${mode.split('-')[0].toUpperCase()} TORNEOS ${f.phase} ${REF} ${f.sha256.slice(0, 12)}`;
  if (words.join(' ') !== phrase) throw new Error(`PHRASE_REQUIRED: ${phrase}`);
  const bytes = readFile(f.path);
  if (sha256(bytes) !== f.sha256) throw new Error('FILE_HASH_MISMATCH');
  const before = await catalog();
  const pre = classify(before);
  if (pre.state !== f.from) throw new Error(`PRE_STATE_${pre.state} ${pre.failures.join('; ')}`);
  if (mode === 'apply-0010' && before.storage_ready !== true) throw new Error('STORAGE_SCHEMA_MISSING');
  out.psql = await applySql(bytes.toString('utf8'));
  const after = await catalog();
  const post = classify(after);
  const moved = changedOutside(before, after);
  out.before = pre.state; out.after = post.state; out.changedOutside = moved;
  const label = `${mode.toUpperCase().replace('-', '_')}`;
  out.verdict = out.psql.code === 0 && post.state === f.to && !moved.length ? `${label}_DONE` : `${label}_FAILED`;
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
  const sql = fs.readFileSync(path.join(HERE, 'sql-catalog.sql'), 'utf8').trim();
  return {
    redact,
    wipe: () => { password = null; },
    catalog: async () => {
      const r = await runPsqlProbe({ script: C.readOnlyScript(sql), env: CV1.readOnlyEnv({ password: secret() }), redact });
      if (r.code !== 0) throw new Error(`CATALOG_READ_FAILED ${r.code} ${r.stderr_tail}`);
      return JSON.parse(r.stdout.trim().split('\n').filter(Boolean).pop());
    },
    applySql: (text) => applySql({ sql: text, env: CV1.installerEnv({ password: secret(), app: 'arma2-torneos-connected-0009-0011' }), redact }),
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [mode, ...words] = process.argv.slice(2);
  const output = { at: new Date().toISOString(), transport: 'psql aws-0-sa-east-1.pooler.supabase.com:5432 verify-full' };
  let deps = null;
  try {
    deps = await realDeps();
    Object.assign(output, await run(mode, words, deps));
  } catch (error) {
    output.error = (deps?.redact ?? String)(error?.message ?? error).slice(0, 600);
  }
  deps?.wipe();
  process.stdout.write(`${JSON.stringify(output, null, 1)}\n`);
  process.exit(output.error || /FAILED/.test(output.verdict || '') ? 1 : 0);
}
