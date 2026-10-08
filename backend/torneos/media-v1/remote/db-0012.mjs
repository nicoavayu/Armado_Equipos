#!/usr/bin/env node
// MEDIA-V1 0012 operator driver for the Torneos Production DB (after #182's POST_0011). Never run by CI or by the operator without GO.
//   node backend/torneos/media-v1/remote/db-0012.mjs observe                                        (read only)
//   … apply-0012          APPLY TORNEOS 0012 <ref> <sha12 of 0012>
//   … rollback-0012       ROLLBACK TORNEOS 0012 <ref> <sha12 of its rollback>     (only with the pipeline mode off MVP_SIMPLE)
//   … mode <MODE>         SET TORNEOS MEDIA PIPELINE MODE <MODE> <ref>             (MVP_SIMPLE only on POST_0012)
// Transport = the certified OEC/CV1/CONNECTED one (installer postgres.<ref>, Session Pooler sa-east-1:5432, verify-full + the
// Supabase CA, the installer password read from the macOS Keychain into memory only and redacted from every output). Every
// write is gated by the exact phrase, the file sha256 where there is a file, the exact observed state before
// (POST_0011 → POST_0012 and back) and after, and "nothing outside MEDIA-V1 moved": every other function (body, ACL, owner,
// config), relation, policy and bucket, by digest. The three baseline bodies 0012 replaces are pinned by md5 in every state.
// 0013 (COMMERCE-PRODUCTION) is independent of 0012 and either may land first: its 14 functions add exactly 2 authenticated
// EXECUTE grants on public functions, accepted only together with the whole 0013 surface being present.
// rollback-0012 keeps the private bucket row and its objects (user content; unreachable without policies): classify() accepts
// exactly that residue below 0012, so a later apply-0012 (bucket upsert) still passes its gate.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { ROSTER_SEARCH } from '../../connected-v1/remote/db-0009-0011.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '../../../..');
export const REF = 'onzpwnqxnvlgsevivngf';
const file = (rel, sha256, from, to) => Object.freeze({ path: path.join(REPO, rel), rel, sha256, from, to });
export const FILES = Object.freeze({
  'apply-0012': file('backend/torneos/supabase/migrations/00000000000012_media_gallery_v1.sql',
    '859fa24d259f4f0b0d3074d68c126c9a03f402bdf31f4d11485e01737fd6f7cb', 'POST_0011', 'POST_0012'),
  'rollback-0012': file('backend/torneos/media-v1/rollback/00000000000012_media_gallery_v1.rollback.sql',
    '7c99e5d0d35ca918419724a4d73c3b723c64580b0baea4f40566ae8a085a1e5a', 'POST_0012', 'POST_0011'),
});
export const MEDIA_FUNCTIONS = Object.freeze([
  'private.tournament_media_gateway_session', 'public.begin_tournament_media_gallery_upload', 'public.can_delete_tournament_media_gateway_object',
  'public.can_read_tournament_media_object', 'public.can_write_tournament_media_gateway_object', 'public.complete_tournament_media_gallery_upload',
  'public.fail_tournament_media_gallery_upload', 'public.get_tournament_media_read_targets', 'public.tournament_media_storage_budget_status',
  'public.tournament_media_thumbnail_path']);
export const MEDIA_POLICIES = Object.freeze([
  'tournament_media_client_update_denied', 'tournament_media_gateway_delete', 'tournament_media_gateway_insert', 'tournament_media_reader_select',
  'tournament_media_service_delete', 'tournament_media_service_insert', 'tournament_media_service_read', 'tournament_media_service_update']);
export const MEDIA_BUCKET = Object.freeze({ public: false, file_size_limit: 4194304, allowed_mime_types: ['image/jpeg', 'image/png', 'image/webp'] });
// md5(prosrc) of the three bodies 0012 redefines: the baseline ones (certified) and 0012's (both measured on the rehearsal lab).
export const MEDIA_BODIES = Object.freeze({
  certified: Object.freeze({ storage: 'c9948ce05e76d02abf6cd3813f6a8120', readiness: '8d350e729e0315400f940524af2a5938', published: 'd74780902cab93ea6d8136a103b5eda7' }),
  media: Object.freeze({ storage: 'ec168be2e4f86c9916b58556e1a3ac58', readiness: 'd17c84cf1a4c830a4a1fd30b12537d23', published: 'c7500f1dfc29c458464529b2f65cfbf8' }),
});
// EXECUTE counts on public functions (authenticated / anon). POST_0011 = what #182's driver leaves; 0012 adds 8 functions and
// grants 3 baseline RPCs to authenticated (+11 / +0). 0013 adds +2 / +0 when its whole surface is present (commerce = true).
export const STATES = Object.freeze({
  POST_0011: Object.freeze({ counts: [193, 16], media: false, bodies: 'certified' }),
  POST_0012: Object.freeze({ counts: [204, 16], media: true, bodies: 'media' }),
});
export const COMMERCE_DELTA = Object.freeze([2, 0]);
export const MODES = Object.freeze(['DISABLED', 'MVP_SIMPLE', 'PROCESSOR_EXTERNAL']);
const sha256 = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/** POST_0011 | POST_0012 | DRIFT, with every reason (and the accepted residue, if any). Pure. */
export function classify(catalog) {
  if (!catalog || catalog.torneos_tables !== true) return { state: 'DRIFT', failures: ['not_the_torneos_db'] };
  const failures = [];
  const m = catalog.media || {};
  const functions = [...(m.functions || [])].sort(); const policies = [...(m.policies || [])].sort();
  const grants = Object.values(m.grants || {});
  const media = functions.length > 0 || policies.length > 0 || m.budget_table === true || grants.some(Boolean);
  if (media) {
    if (!same(functions, MEDIA_FUNCTIONS)) failures.push(`media_functions ${functions.join(',')}`);
    if (!same(policies, MEDIA_POLICIES)) failures.push(`policies ${policies.join(',')}`);
    if (m.budget_table !== true) failures.push('budget_table_missing');
    if (grants.length !== 3 || !grants.every(Boolean)) failures.push(`grants ${JSON.stringify(m.grants)}`);
    if (!same(m.bucket, MEDIA_BUCKET)) failures.push(`bucket ${JSON.stringify(m.bucket)}`);
  }
  // Storage refuses to drop a bucket that still holds objects, and photos are user content: rollback-0012 keeps the row. A
  // private bucket with the exact 0012 configuration, without policies, is the expected residue of POST_0011.
  const residue = !media && m.bucket != null;
  if (residue && !same(m.bucket, MEDIA_BUCKET)) failures.push(`bucket_residue ${JSON.stringify(m.bucket)}`);
  if (!MODES.includes(catalog.mode)) failures.push(`mode ${catalog.mode}`);
  if (!media && catalog.mode === 'MVP_SIMPLE') failures.push('mode_MVP_SIMPLE_without_0012');
  const bodies = Object.entries(MEDIA_BODIES).find(([, pin]) => same(pin, m.bodies))?.[0];
  if (!bodies) failures.push(`media_bodies ${JSON.stringify(m.bodies)}`);
  if (!same(catalog.roster_search, ROSTER_SEARCH.fixed)) failures.push(`roster_search ${JSON.stringify(catalog.roster_search)}`);
  if (typeof catalog.commerce !== 'boolean') failures.push(`commerce ${catalog.commerce}`);
  const state = Object.entries(STATES).find(([, s]) => s.media === media && s.bodies === bodies)?.[0];
  if (!state) return { state: 'DRIFT', failures: [...failures, 'no_state'] };
  const want = STATES[state].counts.map((n, i) => n + (catalog.commerce === true ? COMMERCE_DELTA[i] : 0));
  if (catalog.counts?.authenticated !== want[0] || catalog.counts?.anon !== want[1]) failures.push(`counts ${catalog.counts?.authenticated}/${catalog.counts?.anon} want ${want.join('/')}`);
  if (failures.length) return { state: 'DRIFT', failures };
  const out = { state, failures: [] };
  if (residue) out.residue = [`tournament-media bucket (private, no policies, ${catalog.media_objects ?? '?'} objects; kept by rollback-0012)`];
  return out;
}

/** What 0012 must not touch: returns the names of the sections that changed. */
export const changedOutside = (before, after) => ['kept_fn', 'kept_relations', 'kept_policies', 'other_buckets', 'commerce']
  .filter((key) => !same(before[key], after[key]));

function phraseFor(mode, arg) {
  const f = FILES[mode];
  if (f) return `${mode.split('-')[0].toUpperCase()} TORNEOS 0012 ${REF} ${f.sha256.slice(0, 12)}`;
  if (mode === 'mode') return `SET TORNEOS MEDIA PIPELINE MODE ${arg} ${REF}`;
  throw new Error('usage: observe | apply-0012 | rollback-0012 | mode <DISABLED|MVP_SIMPLE|PROCESSOR_EXTERNAL> <phrase>');
}

/** The pipeline mode write (no file): the literal is validated against MODES before it is interpolated. */
export function modeSql(mode) {
  if (!MODES.includes(mode)) throw new Error('MODE_INVALID');
  return `BEGIN; UPDATE public.tournament_media_pipeline_configuration SET mode = '${mode}', updated_at = now() WHERE singleton; COMMIT;`;
}

/** The whole operator decision, with injected I/O (tested offline with fakes and on the rehearsal lab). */
export async function run(mode, args, { readFile = fs.readFileSync, catalog, applySql }) {
  const out = { mode, target: REF };
  if (mode === 'observe') {
    out.catalog = await catalog();
    out.verdict = classify(out.catalog);
    return out;
  }
  const arg = mode === 'mode' ? args[0] : null;
  const words = mode === 'mode' ? args.slice(1) : args;
  const phrase = phraseFor(mode, arg);
  if (words.join(' ') !== phrase) throw new Error(`PHRASE_REQUIRED: ${phrase}`);
  const f = FILES[mode];
  let sql;
  if (f) {
    const bytes = readFile(f.path);
    if (sha256(bytes) !== f.sha256) throw new Error('FILE_HASH_MISMATCH');
    sql = bytes.toString('utf8');
  } else sql = modeSql(arg);
  const before = await catalog();
  const pre = classify(before);
  const from = f ? f.from : (arg === 'MVP_SIMPLE' ? 'POST_0012' : pre.state);
  if (pre.state === 'DRIFT' || pre.state !== from) throw new Error(`PRE_STATE_${pre.state} ${pre.failures.join('; ')}`);
  // Order of switching off is frontend → gateway → mode → base: the contract is never withdrawn under live sessions.
  if (mode === 'rollback-0012' && before.mode === 'MVP_SIMPLE') throw new Error('ROLLBACK_REFUSED mode is MVP_SIMPLE: set PROCESSOR_EXTERNAL first (ACTIVATION.md)');
  if (mode === 'apply-0012' && before.storage_ready !== true) throw new Error('STORAGE_SCHEMA_MISSING');
  out.psql = await applySql(sql);
  const after = await catalog();
  const post = classify(after);
  const moved = changedOutside(before, after);
  const to = f ? f.to : from;
  out.before = pre.state; out.after = post.state; out.changedOutside = moved;
  if (mode === 'mode') { out.modeBefore = before.mode; out.modeAfter = after.mode; }
  const label = mode === 'mode' ? `MODE_${arg}` : mode.toUpperCase().replace('-', '_');
  const ok = out.psql.code === 0 && post.state === to && !moved.length && (mode !== 'mode' || after.mode === arg);
  out.verdict = `${label}_${ok ? 'DONE' : 'FAILED'}`;
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
    applySql: (text) => applySql({ sql: text, env: CV1.installerEnv({ password: secret(), app: 'arma2-torneos-media-0012' }), redact }),
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
