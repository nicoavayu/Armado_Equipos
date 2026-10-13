#!/usr/bin/env node
// SEASON operator driver for the Torneos Production DB: 0018 (season media lifecycle), 0019 (season commerce, after
// 0013) and the runner (pg_cron + pg_net jobs). Never run by CI, and never by the operator without GO.
//   node backend/torneos/season-lifecycle/remote/db-season.mjs observe                                  (read only)
//   … apply-0018 | rollback-0018 | apply-0019 | rollback-0019 | apply-runner | rollback-runner   <exact phrase>
//   … budget <project_bytes> <gallery_bytes>                                                       <exact phrase>
// Transport = the certified one (installer postgres.<ref>, Session Pooler sa-east-1:5432, verify-full + the Supabase CA,
// the installer password read from the macOS Keychain into memory only and redacted from every output). Every write is
// gated by the exact phrase, the file sha256, the exact observed state before and after on its own axis (media: PRE_0018 /
// POST_0018; commerce: NONE / POST_0013 / POST_0019; runner: OFF / ON), and "nothing outside moved": every other
// function (body, ACL, owner, config), relation and policy by digest, and EXECUTE counts identical. The files check
// themselves too (md5 pre/postconditions in one transaction): the driver adds the state gate and the evidence.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '../../../..');
export const REF = 'onzpwnqxnvlgsevivngf';
const file = (rel, sha256, axis, from, to, phase) => Object.freeze({ path: path.join(REPO, rel), rel, sha256, axis, from, to, phase });
// sha256 of each file of this branch (re-pinned with `node db-season.mjs pins` after any change; the test checks them).
export const FILES = Object.freeze({
  'apply-0018': file('backend/torneos/supabase/migrations/00000000000018_season_media_lifecycle.sql', '549d980c750da34836c782e7cd0852ff93f8b3477d63abb61e3d29a3b82fcdc8', 'media', 'PRE_0018', 'POST_0018', '0018'),
  'rollback-0018': file('backend/torneos/season-lifecycle/rollback/00000000000018_season_media_lifecycle.rollback.sql', '43d9ee8042b97c1a36cfd4ff24ec4124a48fce113fc3ea2acf2415ff6c44c162', 'media', 'POST_0018', 'PRE_0018', '0018'),
  'apply-0019': file('backend/torneos/supabase/migrations/00000000000019_season_commerce.sql', '2cd55a0dac816cba13e3516ffaeacb338faa1980902ecede397c9960dc586258', 'commerce', 'POST_0013', 'POST_0019', '0019'),
  'rollback-0019': file('backend/torneos/season-lifecycle/rollback/00000000000019_season_commerce.rollback.sql', '6b85089d01e4a383689f3d1d7cc24c2bb2b66d24675cb1fdc60b65a028635612', 'commerce', 'POST_0019', 'POST_0013', '0019'),
  'apply-runner': file('backend/torneos/season-lifecycle/scheduler/season-lifecycle-cron.sql', '4117dbfecdead0c0c73d89b973e4b142e7cb2c5ee28dea4e51a5c20f77f3887b', 'runner', 'OFF', 'ON', 'RUNNER'),
  'rollback-runner': file('backend/torneos/season-lifecycle/scheduler/season-lifecycle-cron.rollback.sql', '40cc12fbbd97cd8de3a6adfd5db6bdcbb0e0e47d3821f0de5a1c6fe556e16e3c', 'runner', 'ON', 'OFF', 'RUNNER'),
});
// md5(prosrc), measured on the lab (they are also the pins inside the files).
const MEDIA = Object.freeze({
  PRE_0018: { enforce: '4c985973a92c677919703bbfc0bfbca2', season9: '3e6a6f6a5fa220ec1b83471b128eed62', season10: null,
    can_read: '5316ae2ddb16f714071d43dc76b5c704', usage: '27bd920bcb72052296f31016dcd4cc97', entitlements: 'bf263acafb185ee0993117d5805bc701',
    lifecycle: null, purge_claim: null, purge_complete: null },
  POST_0018: { enforce: '5623a9fae3d4313c732951d3a6dafc0f', season9: null, season10: 'e3d3be4f2e6aed2cb85c34d1548dd64b',
    can_read: '91a0b405d7e19f6099f6ba643ef88642', usage: '6151acbd48b8a57d762be9c44e0fe5e7', entitlements: '391497eb0c9a028211e6f62e37b034ef',
    lifecycle: '908afa133708d2340dad572ffbbf0b7b', purge_claim: 'bfad5e498d4e85c9da06978489136985', purge_complete: 'f87a4f0a57ee68e248f9383c9b8cc3b2' },
});
const COMMERCE = Object.freeze({
  NONE: { checkout: null, activation: null, status_policy: null, reversal_policy: null, purchases: null },
  POST_0013: { checkout: 'fc9559b0c1fb1b070c13ab1be0bda395', activation: 'abe70db7fc988f0e06a505f63aeca330',
    status_policy: '071388d5357883a14066f95cc633f1e7', reversal_policy: '80a0fe7a8fec2f34a8219d9b6514d82e', purchases: '484f63507d2e789bf0d15381c0a5d9ac' },
  POST_0019: { checkout: '9bba694e95d0a55ade612431de57dd6d', activation: '5789b8dedcdb0df08f65f685b93e0ecb',
    status_policy: '6dfd55905a5968736fe6806bb335ea56', reversal_policy: '7efeadcefddb54f907effc35374cbc1d', purchases: '2c96bc3721e910d997ff32567b46121d' },
});
export const RUNNER_JOBS = 'torneos-season-media-lifecycle 3-59/15 * * * * true|torneos-season-media-purge 8-59/15 * * * * true';
const SERVICE_ONLY = Object.freeze({ authenticated: false, anon: false, service_role: true });
const sha256 = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const pick = (obj, keys) => Object.fromEntries(keys.map((k) => [k, obj?.[k] ?? null]));
const stateOf = (table, bodies) => Object.entries(table).find(([, pin]) => same(pin, pick(bodies, Object.keys(pin))))?.[0] ?? null;

/** { media, commerce, runner } or { state: 'DRIFT', failures }. Pure. */
export function classify(catalog) {
  if (!catalog || catalog.torneos_tables !== true) return { state: 'DRIFT', failures: ['not_the_torneos_db'] };
  const failures = [];
  const media = stateOf(MEDIA, catalog.bodies);
  const commerce = stateOf(COMMERCE, catalog.bodies);
  if (!media) failures.push(`media bodies ${JSON.stringify(pick(catalog.bodies, Object.keys(MEDIA.PRE_0018)))}`);
  if (!commerce) failures.push(`commerce bodies ${JSON.stringify(pick(catalog.bodies, Object.keys(COMMERCE.NONE)))}`);
  const runnerOn = catalog.bodies?.purge_request != null;
  const runner = runnerOn ? 'ON' : 'OFF';
  if (runnerOn && catalog.cron?.jobs !== RUNNER_JOBS) failures.push(`runner jobs ${catalog.cron?.jobs}`);
  if (!runnerOn && catalog.cron?.jobs != null) failures.push(`jobs without runner ${catalog.cron?.jobs}`);
  if (media === 'POST_0018') {
    if (!same(catalog.season?.columns, ['activated_at', 'activation_basis', 'media_deadline_at'])) failures.push(`season columns ${JSON.stringify(catalog.season?.columns)}`);
    if (catalog.season?.not_activated !== 0) failures.push(`non-draft seasons without activation ${catalog.season?.not_activated}`);
    if (catalog.season?.premium_limit !== 100 || catalog.season?.free_limit !== 25) failures.push('plan catalog not 25/100');
    for (const name of ['lifecycle', 'purge_claim', 'purge_complete']) {
      if (!same(catalog.acl?.[name], SERVICE_ONLY)) failures.push(`acl.${name} ${JSON.stringify(catalog.acl?.[name])}`);
    }
  }
  if (media === 'PRE_0018' && (catalog.season?.columns?.length || catalog.season?.premium_limit !== 1000)) failures.push('0018 leftovers');
  if (media === 'PRE_0018' && (commerce === 'POST_0019' || runnerOn)) failures.push('0019 or the runner without 0018');
  if (commerce === 'POST_0019' && !(catalog.offer?.amount === 20000 && catalog.offer?.list === 20000 && catalog.offer?.label === 'Precio de lanzamiento')) {
    failures.push(`offer ${JSON.stringify(catalog.offer)}`);
  }
  if (commerce === 'POST_0013' && !(catalog.offer?.amount === 39900 && catalog.offer?.list === 49900)) failures.push(`offer ${JSON.stringify(catalog.offer)}`);
  for (const name of ['season9', 'season10']) {
    const acl = catalog.acl?.[name];
    if (acl && (acl.anon || !acl.authenticated)) failures.push(`acl.${name} ${JSON.stringify(acl)}`);
  }
  if (failures.length) return { state: 'DRIFT', failures };
  return { media, commerce, runner, state: `${media}+${commerce}+RUNNER_${runner}` };
}

/** What a step must not touch: the names of the sections that changed. */
export const changedOutside = (before, after) => ['counts', 'kept_fn', 'kept_relations', 'kept_policies']
  .filter((key) => !same(before[key], after[key]));

const BUDGET_MAX = 1024 * 1024 * 1024;
export function phraseFor(mode, args = []) {
  if (mode === 'budget') return `SET TORNEOS MEDIA STORAGE BUDGET ${args[0]} ${args[1]} ${REF}`;
  const f = FILES[mode];
  if (!f) throw new Error('usage: observe | apply-0018 | rollback-0018 | apply-0019 | rollback-0019 | apply-runner | rollback-runner | budget <project> <gallery>');
  return `${mode.split('-')[0].toUpperCase()} TORNEOS ${f.phase} ${REF} ${f.sha256.slice(0, 12)}`;
}

/** The A3 decision: 0012's ceiling, at most 1 GB for the project and gallery ≤ project. Literal values, validated. */
export function budgetSql(project, gallery) {
  const p = Number(project); const g = Number(gallery);
  if (!Number.isInteger(p) || !Number.isInteger(g) || p < 1048576 || p > BUDGET_MAX || g < 1048576 || g > p) throw new Error('BUDGET_INVALID');
  return `BEGIN; UPDATE public.tournament_media_storage_budget SET project_max_bytes = ${p}, gallery_max_bytes = ${g}, updated_at = now() WHERE singleton; COMMIT;`;
}

/** The whole operator decision, with injected I/O (tested offline with fakes and on the lab through the same run()). */
export async function run(mode, args, { readFile = fs.readFileSync, catalog, applySql }) {
  const out = { mode, target: REF };
  if (mode === 'observe') {
    out.catalog = await catalog();
    out.verdict = classify(out.catalog);
    return out;
  }
  if (mode === 'budget') {
    const [project, gallery, ...phrase] = args;
    const sqlText = budgetSql(project, gallery);
    if (phrase.join(' ') !== phraseFor('budget', [project, gallery])) throw new Error(`PHRASE_REQUIRED: ${phraseFor('budget', [project, gallery])}`);
    const before = await catalog();
    if (classify(before).state === 'DRIFT') throw new Error('PRE_STATE_DRIFT');
    out.psql = await applySql(sqlText);
    const after = await catalog();
    out.budgetBefore = before.budget; out.budgetAfter = after.budget; out.changedOutside = changedOutside(before, after);
    const ok = out.psql.code === 0 && after.budget?.project === Number(project) && after.budget?.gallery === Number(gallery) && !out.changedOutside.length;
    out.verdict = `BUDGET_${ok ? 'DONE' : 'FAILED'}`;
    return out;
  }
  const phrase = phraseFor(mode);
  if (args.join(' ') !== phrase) throw new Error(`PHRASE_REQUIRED: ${phrase}`);
  const f = FILES[mode];
  const bytes = readFile(f.path);
  if (sha256(bytes) !== f.sha256) throw new Error('FILE_HASH_MISMATCH');
  const before = await catalog();
  const pre = classify(before);
  if (pre.state === 'DRIFT' || pre[f.axis] !== f.from) throw new Error(`PRE_STATE_${pre.state} ${(pre.failures || []).join('; ')}`);
  // The order between axes: 0019 and the runner need 0018; 0018 never goes away under 0019 or the runner; 0019 needs 0013.
  const blocked = (mode === 'rollback-0018' && (pre.commerce === 'POST_0019' || pre.runner === 'ON'))
    || ((mode === 'apply-0019' || mode === 'apply-runner') && pre.media !== 'POST_0018');
  if (blocked) throw new Error(`PRE_STATE_${pre.state} order`);
  out.psql = await applySql(bytes.toString('utf8'));
  const after = await catalog();
  const post = classify(after);
  const moved = changedOutside(before, after);
  out.before = pre.state; out.after = post.state; out.changedOutside = moved;
  if (post.failures?.length) out.failures = post.failures;
  // Only this step's axis moves; the other two stay as they were.
  const others = ['media', 'commerce', 'runner'].filter((axis) => axis !== f.axis).every((axis) => post[axis] === pre[axis]);
  const ok = out.psql.code === 0 && post.state !== 'DRIFT' && post[f.axis] === f.to && others && !moved.length;
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
  const sql = fs.readFileSync(path.join(HERE, 'sql-catalog-season.sql'), 'utf8').trim();
  return {
    redact,
    wipe: () => { password = null; },
    catalog: async () => {
      const r = await runPsqlProbe({ script: C.readOnlyScript(sql), env: CV1.readOnlyEnv({ password: secret() }), redact });
      if (r.code !== 0) throw new Error(`CATALOG_READ_FAILED ${r.code} ${r.stderr_tail}`);
      return JSON.parse(r.stdout.trim().split('\n').filter(Boolean).pop());
    },
    applySql: (text) => applySql({ sql: text, env: CV1.installerEnv({ password: secret(), app: 'arma2-torneos-season-0018-0019' }), redact }),
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [mode, ...args] = process.argv.slice(2);
  if (mode === 'pins') {
    for (const [name, f] of Object.entries(FILES)) process.stdout.write(`${name} ${sha256(fs.readFileSync(f.path))}\n`);
    process.exit(0);
  }
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
