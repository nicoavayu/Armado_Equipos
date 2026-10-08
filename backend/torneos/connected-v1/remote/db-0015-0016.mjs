#!/usr/bin/env node
// PILOT 0015 + 0016 operator driver for the Torneos Production DB (after #182's POST_0011 and Galería's 0012/0014). Never run
// by CI or by the operator without GO.
//   node backend/torneos/connected-v1/remote/db-0015-0016.mjs observe                                   (read only)
//   … apply-0015       APPLY TORNEOS 0015 <ref> <sha12 of 0015>       (participants see the previous kickoff)
//   … apply-0016       APPLY TORNEOS 0016 <ref> <sha12 of 0016>       (reschedule / postponement notices)
//   … rollback-0016    ROLLBACK TORNEOS 0016 <ref> <sha12 of its rollback>   (deletes the match notices; history stays)
//   … rollback-0015    ROLLBACK TORNEOS 0015 <ref> <sha12 of its rollback>
// Transport = the certified OEC/CV1/CONNECTED one (installer postgres.<ref>, Session Pooler sa-east-1:5432, verify-full + the
// Supabase CA, the installer password read from the macOS Keychain into memory only and redacted from every output). Every
// write is gated by the exact phrase, the file sha256, the exact observed state before (BASE → POST_0015 → POST_0016 and
// back) and after, and "nothing outside 0015/0016 moved": every other function (body, ACL, owner, config), relation, policy,
// and the other constraints and triggers of the two tables 0016 touches, by digest; EXECUTE counts identical before and
// after (neither file grants anything). The five bodies are pinned by md5 in every state. The files also check themselves
// (md5 pre/post conditions inside one transaction): the driver adds the state gate and the evidence around them.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '../../../..');
export const REF = 'onzpwnqxnvlgsevivngf';
const file = (rel, sha256, from, to, phase) => Object.freeze({ path: path.join(REPO, rel), rel, sha256, from, to, phase });
export const FILES = Object.freeze({
  'apply-0015': file('backend/torneos/supabase/migrations/00000000000015_participant_match_reschedule_visibility.sql',
    '7aa5d7fa4bdf0d12df0f45ea578bc6b588384f83033aa716b6e2241692c08740', 'BASE', 'POST_0015', '0015'),
  'rollback-0015': file('backend/torneos/connected-v1/rollback/00000000000015_participant_match_reschedule_visibility.rollback.sql',
    '2e94e2dcd07a085d7be359fb53e276ebd97a90ddbb578b6579f2af20889df513', 'POST_0015', 'BASE', '0015'),
  'apply-0016': file('backend/torneos/supabase/migrations/00000000000016_match_reschedule_notice.sql',
    'de06a84a728654c1fd78a46a10fad4ab9b56b50f89ed2376f480b73983729746', 'POST_0015', 'POST_0016', '0016'),
  'rollback-0016': file('backend/torneos/connected-v1/rollback/00000000000016_match_reschedule_notice.rollback.sql',
    'cca08e77195f347a6d0164f4c752e251dbd27dbb8593bcd46d83e9eb3fbbec56', 'POST_0016', 'POST_0015', '0016'),
});
// md5(prosrc), measured on the rehearsal lab: the certified bodies before 0015/0016 and the ones each file installs.
const BASE_BODIES = Object.freeze({
  player: '998cd63e1fb57ca63147ee556ae81783', managed: 'ab7320d546b04e171868875d01beac2a',
  reschedule: 'be29c4ddabcfbcdbbf750e966f211f28', notifications: 'cddfab2dec08d3571e6b6421e04c99f7', notify: null,
});
export const BODIES = Object.freeze({
  BASE: BASE_BODIES,
  POST_0015: Object.freeze({ ...BASE_BODIES, player: 'c997fcf5516a8bf8f518db0c3c99d335', managed: '54d543bd2fc8c697ed67654b2cbd0c46' }),
  POST_0016: Object.freeze({
    player: 'c997fcf5516a8bf8f518db0c3c99d335', managed: '54d543bd2fc8c697ed67654b2cbd0c46',
    reschedule: '9de3463325be197e4181673784c65d90', notifications: '856cad59ae5f93019dc0c7ab2aa7bf34', notify: 'f71af1690aa88bdd994e0672adae27e3',
  }),
});
const KINDS_0009 = "CHECK ((kind = ANY (ARRAY['registration.submitted'::text, 'registration.received'::text, 'registration.approved'::text, 'registration.changes_requested'::text, 'registration.rejected'::text])))";
const KINDS_0016 = "CHECK ((kind = ANY (ARRAY['registration.submitted'::text, 'registration.received'::text, 'registration.approved'::text, 'registration.changes_requested'::text, 'registration.rejected'::text, 'match.rescheduled'::text, 'match.postponed'::text])))";
export const NOTICE = Object.freeze({
  off: Object.freeze({ columns: [], kind_check: KINDS_0009, shape_check: false, unique_index: false, trigger: false }),
  on: Object.freeze({ columns: ['match_id', 'previous_scheduled_at', 'scheduled_at', 'source_reschedule_id'], kind_check: KINDS_0016, shape_check: true, unique_index: true, trigger: true }),
});
// Every tracked RPC stays SECURITY DEFINER with an empty search_path; the two participant reads, the reschedule and the inbox
// keep authenticated EXECUTE; nothing is ever executable by anon; the trigger function by no API role.
const RPC_ACL = Object.freeze({ secdef: true, config: ['search_path=""'], authenticated: true, anon: false });
const TRIGGER_ACL = Object.freeze({ secdef: true, config: ['search_path=""'], authenticated: false, anon: false });
const sha256 = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/** BASE | POST_0015 | POST_0016 | DRIFT, with every reason. Pure. */
export function classify(catalog) {
  if (!catalog || catalog.torneos_tables !== true) return { state: 'DRIFT', failures: ['not_the_torneos_db'] };
  const failures = [];
  const state = Object.entries(BODIES).find(([, pin]) => same(pin, catalog.bodies))?.[0];
  if (!state) return { state: 'DRIFT', failures: [`bodies ${JSON.stringify(catalog.bodies)}`] };
  const notice = catalog.notice || {};
  const want = state === 'POST_0016' ? NOTICE.on : NOTICE.off;
  for (const key of Object.keys(want)) {
    if (!same(notice[key], want[key])) failures.push(`notice.${key} ${JSON.stringify(notice[key])}`);
  }
  if (state !== 'POST_0016' && notice.rows !== 0) failures.push(`match_notices_without_0016 ${notice.rows}`);
  for (const name of ['player', 'managed', 'reschedule', 'notifications']) {
    if (!same(catalog.acl?.[name], RPC_ACL)) failures.push(`acl.${name} ${JSON.stringify(catalog.acl?.[name])}`);
  }
  if (state === 'POST_0016' ? !same(catalog.acl?.notify, TRIGGER_ACL) : catalog.acl?.notify != null) {
    failures.push(`acl.notify ${JSON.stringify(catalog.acl?.notify)}`);
  }
  if (failures.length) return { state: 'DRIFT', failures };
  return { state, failures: [] };
}

/** What 0015 / 0016 must not touch: returns the names of the sections that changed. */
export const changedOutside = (before, after) => ['counts', 'kept_fn', 'kept_relations', 'kept_policies', 'kept_constraints', 'kept_triggers']
  .filter((key) => !same(before[key], after[key]));

export function phraseFor(mode) {
  const f = FILES[mode];
  if (!f) throw new Error('usage: observe | apply-0015 | apply-0016 | rollback-0016 | rollback-0015 <phrase>');
  return `${mode.split('-')[0].toUpperCase()} TORNEOS ${f.phase} ${REF} ${f.sha256.slice(0, 12)}`;
}

/** The whole operator decision, with injected I/O (tested offline with fakes and on a disposable copy of Production). */
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
  // rollback-0016 deletes the match notices (the reschedule history stays): the count goes into the evidence.
  if (mode === 'rollback-0016') out.noticesDeleted = before.notice?.rows ?? null;
  out.psql = await applySql(bytes.toString('utf8'));
  const after = await catalog();
  const post = classify(after);
  const moved = changedOutside(before, after);
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
  const sql = fs.readFileSync(path.join(HERE, 'sql-catalog-0015-0016.sql'), 'utf8').trim();
  return {
    redact,
    wipe: () => { password = null; },
    catalog: async () => {
      const r = await runPsqlProbe({ script: C.readOnlyScript(sql), env: CV1.readOnlyEnv({ password: secret() }), redact });
      if (r.code !== 0) throw new Error(`CATALOG_READ_FAILED ${r.code} ${r.stderr_tail}`);
      return JSON.parse(r.stdout.trim().split('\n').filter(Boolean).pop());
    },
    applySql: (text) => applySql({ sql: text, env: CV1.installerEnv({ password: secret(), app: 'arma2-torneos-pilot-0015-0016' }), redact }),
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
