#!/usr/bin/env node
// OFFICIALIZATION + ERROR-CONTRACT REMOTE — OFFLINE REHEARSAL. Nothing leaves this machine.
//
//   • DB: throwaway public.ecr.aws/supabase/postgres:17.6.1.147 containers on an --internal Docker network, 0000–0004
//     applied as `postgres` (non-superuser — the hosted installer, exactly as in Production). The tooling's psql legs are
//     replaced by `docker exec … psql -f -` with the SAME script bytes; every call first checks that the tooling built
//     the pinned Production env (pooler host, installer.<ref>, verify-full, read-only default for reads).
//   • Gateway: the REAL handle() of both sources (live ee34b2a7 from git, candidate tree), Core emulated in-process.
//   • Deno Deploy API v2 and Keychain: in-memory fakes. Phrases are taken from the plan the tooling printed.
//
// Part A (raw files on a real database) derives pins/oec-db-delta.json: the catalog paths each state moves, the 9 new
// bodies and the per-function attributes; and proves 0005 / 0006 / both rollbacks / re-applies / the hazards (a RAW 0005
// on POST_0006 reverts one 0006 body; the 0005 rollback on POST_0006 drops a 0006 function; 0005 cannot be re-applied
// after its rollback). Part B drives the REAL tooling on a fresh database through every step and every refusal.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import * as C from './oec-remote-contract.mjs';
import * as G from '../torneos-gateway-auth/gateway-auth-contract.mjs';
import * as P from '../torneos-payments-test/payments-test-contract.mjs';
import * as F from '../torneos-foundation/foundation-contract.mjs';
import { makeRemote, REFUSALS } from './oec-remote.mjs';
import { buildCandidate, buildLive } from './oec-bundle.mjs';
import { fixtureEnv, gatewayPair, fakeDeno } from './test-support.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DOCKER = ['/Applications/Docker.app/Contents/Resources/bin/docker', '/usr/local/bin/docker', '/opt/homebrew/bin/docker'].find((p) => { try { fs.accessSync(p, fs.constants.X_OK); return true; } catch { return false; } });
if (!DOCKER) { console.error('docker not found'); process.exit(2); }
const DB_IMAGE = 'public.ecr.aws/supabase/postgres:17.6.1.147';
const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
const NET = `oec-rehearsal-net-${process.pid}`;
let DB = null;
// Throwaway values of throwaway containers (they die with the run): not credentials of anything real.
const LOCAL_PW = crypto.randomBytes(18).toString('base64url');
const FAKE_INSTALLER_PW = crypto.randomBytes(30).toString('base64url');
const FAKE_DENO = `ddo_${crypto.randomBytes(24).toString('base64url')}`;
const docker = (args) => execFileSync(DOCKER, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
const log = (s) => process.stdout.write(`${s}\n`);
const canon = (v) => JSON.stringify(v, (k, x) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.keys(x).sort().map((key) => [key, x[key]])) : x));
const read = (rel) => fs.readFileSync(path.join(C.REPO_ROOT, rel), 'utf8');

function psql(input, { readOnly = false } = {}) {
  const env = ['-e', `PGPASSWORD=${LOCAL_PW}`]; if (readOnly) env.push('-e', 'PGOPTIONS=-c default_transaction_read_only=on');
  const r = spawnSync(DOCKER, ['exec', '-i', ...env, DB, 'psql', '-U', 'postgres', '-h', 'localhost', '-d', 'postgres', '-X', '--no-psqlrc', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1', '-f', '-'], { input, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  return { code: r.status ?? -1, stdout: (r.stdout ?? ''), err: (r.stderr ?? '').trim() };
}
const one = (select) => { const r = psql(C.readOnlyScript(select), { readOnly: true }); if (r.code) throw new Error(`query failed: ${r.err.slice(0, 300)}`); return JSON.parse(r.stdout.trim().split('\n').pop()); };
const pick = (catalog) => Object.fromEntries(C.OEC_CATALOG_PATHS.map((p) => [p, G.getPath(catalog, p)]));
const strictDiff = (a, b) => F.STRICT_CATALOG_PATHS.filter((p) => canon(F.getPath(a, p)) !== canon(F.getPath(b, p)));
async function freshDb() {
  if (DB) { try { docker(['rm', '-f', DB]); } catch { /* gone */ } }
  DB = `oec-rehearsal-db-${process.pid}-${crypto.randomBytes(3).toString('hex')}`;
  docker(['run', '-d', '--rm', '--network', NET, '--name', DB, '-e', `POSTGRES_PASSWORD=${LOCAL_PW}`, '--pull', 'never', DB_IMAGE]);
  for (let i = 0; i < 90 && psql('select 1').code !== 0; i++) await new Promise((r) => setTimeout(r, 1000));
  for (const m of C.APPLIED) {
    const bytes = fs.readFileSync(path.join(C.REPO_ROOT, m.file));
    if (C.sha256(bytes) !== m.sha256) throw new Error(`migration hash ${m.seq}`);
    const r = psql(bytes.toString('utf8'));
    if (r.code) throw new Error(`apply ${m.seq}: ${r.err.slice(-400)}`);
  }
}
/** The single CREATE OR REPLACE FUNCTION block of `sig`'s name in a file (for partial-state injection only). */
const blockOf = (text, sig) => { const name = sig.replace(/\(.*$/, '').replace('.', '\\.'); const m = new RegExp(`CREATE OR REPLACE FUNCTION ${name}\\([\\s\\S]*?\\n\\$function\\$;?\\n`).exec(text); if (!m) throw new Error(`block ${sig}`); return m[0]; };
/** The statements a file runs at top level: function bodies and DO blocks removed, comments stripped. */
const topLevel = (t) => t.replace(/\$function\$[\s\S]*?\$function\$/g, '$function$').replace(/\$(pre|post)\$[\s\S]*?\$\1\$/g, '$$$1$$').replace(/^\s*--.*$/gm, '');
const prosrcOf = (sigs) => one(`select json_object_agg(s, (select p.prosrc from pg_proc p where p.oid = to_regprocedure(s))) from unnest(array[${sigs.map((s) => `'${s}'`).join(',')}]) s`);

async function main() {
  const results = [];
  const check = (name, pass, extra = {}) => { results.push({ name, pass: !!pass, ...extra }); log(`${pass ? 'PASS' : 'FAIL'} ${name}${extra.detail ? ` — ${extra.detail}` : ''}`); };
  let gw = null; const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'arma2-oec-rehearsal-'));
  const M5 = read(C.M0005.file); const M6 = read(C.M0006.file); const RB5 = read(C.R0005.file); const RB6 = read(C.R0006.file);
  try {
    check('migration + rollback files = pins (0000–0006, both rollbacks), migrations dir = exactly 0000–0006', C.migrationDrift().length === 0, { detail: C.migrationDrift().join(';') });
    docker(['network', 'create', '--internal', NET]);
    // ───────────── Part A — raw files on a real database ─────────────
    await freshDb();
    log(`db up: ${DB_IMAGE} ${one("select json_build_object('v', current_setting('server_version'))").v}; installer postgres (rolsuper=${one("select json_build_object('s', rolsuper) from pg_roles where rolname = 'postgres'").s}); 0000–0004 applied`);
    const foundationPin = JSON.parse(fs.readFileSync(G.FOUNDATION_PIN_FILE, 'utf8'));
    const cv1Pin = JSON.parse(fs.readFileSync(path.join(C.REPO_ROOT, 'backend/torneos/infra/torneos-competition-v1/pins/competition-v1-db-delta.json'), 'utf8'));
    const c4 = one(G.CATALOG_SQL); const s4 = one(C.STATE_SQL);
    const fd4 = F.catalogDiff(c4, foundationPin.catalog).map((d) => d.path);
    check('POST_0004 catalog = foundation pin on every strict path except the two COMPETITION-V1 moves', canon(fd4.sort()) === canon(['execute', 'functions.bodies_md5']), { detail: fd4.join(',') });
    check('POST_0004 COMPETITION-V1 paths = the certified COMPETITION-V1 post pin (the one Production matched at W1)', ['execute', 'functions.bodies_md5', 'acl_md5'].every((p) => canon(G.getPath(c4, p)) === canon(cv1Pin.states.post[p])));
    const r5 = psql(M5); if (r5.code) throw new Error(`0005: ${r5.err.slice(-600)}`);
    const c5 = one(G.CATALOG_SQL); const s5 = one(C.STATE_SQL);
    const newBodies = Object.fromEntries(C.NEW_0005.map((sig) => [sig, s5.functions.find((x) => x.sig === sig).body_md5]));
    const attrs = Object.fromEntries(s5.functions.map((x) => [x.sig, { grantees: x.grantees, definer: x.definer, search_path_pinned: x.search_path_pinned, owner: x.owner }]));
    const pinDraft = { new_function_bodies: newBodies, function_attrs: attrs };
    check('state after 0000–0004 = POST_0004 (162 / 12, 0005 objects absent, 17 of the 18 at POST_0005 md5, 3 × 40001 raisers)', C.classifyState(s4, pinDraft).state === 'POST_0004', { detail: C.classifyState(s4, pinDraft).failures.join(';') });
    check('POST_0004 pins required by 0005: validate 4f43a729… / context 2f43290e… / authorizer 488ca6bb…', C.REPLACED_0005.every((r) => s4.functions.find((x) => x.sig === r.fn).body_md5 === r.before));
    check('0005 as postgres in ONE transaction → POST_0005 (171 / 12)', C.classifyState(s5, pinDraft).state === 'POST_0005', { detail: C.classifyState(s5, pinDraft).failures.join(';') });
    check('0005 moves exactly the pinned catalog paths (+ acl_md5)', canon(strictDiff(c4, c5).sort()) === canon(C.OEC_CATALOG_PATHS.filter((p) => p !== 'acl_md5').sort()), { detail: strictDiff(c4, c5).join(',') });
    check('new_function_bodies: set_tournament_match_dual_control = the POST_0005 md5 0006 pins', newBodies[C.DUAL_CONTROL_FN] === C.EC_PINS.find((p) => p.fn === C.DUAL_CONTROL_FN).before);
    check('function attributes identical at POST_0004 for every function that exists there', s4.functions.filter((x) => x.exists).every((x) => canon({ grantees: x.grantees, definer: x.definer, search_path_pinned: x.search_path_pinned, owner: x.owner }) === canon(attrs[x.sig])));
    const r5b = psql(M5);
    check('0005 re-applied on POST_0005 → no-op (catalog unchanged)', r5b.code === 0 && canon(one(G.CATALOG_SQL)) === canon(c5));
    const src5 = prosrcOf(C.EC_PINS.map((p) => p.fn));
    const r6 = psql(M6); if (r6.code) throw new Error(`0006: ${r6.err.slice(-600)}`);
    const c6 = one(G.CATALOG_SQL); const s6 = one(C.STATE_SQL);
    check('0006 as postgres in ONE transaction → POST_0006 (171 / 12, 0 × 40001 raisers, 18 PTxyz raisers)', C.classifyState(s6, pinDraft).state === 'POST_0006' && s6.error_sweep.raises_40001 === 0 && s6.error_sweep.raises_ptxyz === 18, { detail: C.classifyState(s6, pinDraft).failures.join(';') });
    check('0006 moves ONLY functions.bodies_md5 (no grant / RLS / owner / table / policy / anon change)', canon(strictDiff(c5, c6)) === canon(['functions.bodies_md5']) && canon(c5.acl_md5) === canon(c6.acl_md5) && canon(c5.tables) === canon(c6.tables), { detail: strictDiff(c5, c6).join(',') });
    const src6 = prosrcOf(C.EC_PINS.map((p) => p.fn));
    const norm = (t) => t.replace(/errcode\s*=\s*'[0-9A-Z]{5}'/g, "errcode = '?'");
    const changedLiterals = C.EC_PINS.reduce((n, p) => { const a = [...src5[p.fn].matchAll(/errcode\s*=\s*'([0-9A-Z]{5})'/g)].map((m) => m[1]); const b = [...src6[p.fn].matchAll(/errcode\s*=\s*'([0-9A-Z]{5})'/g)].map((m) => m[1]); return n + a.filter((x, i) => x !== b[i]).length; }, 0);
    check('the 18 bodies differ from POST_0005 ONLY in errcode literals, exactly 23 of them, all → PT409/PT422/PT429', C.EC_PINS.every((p) => norm(src5[p.fn]) === norm(src6[p.fn])) && changedLiterals === 23
      && C.EC_PINS.every((p) => [...src6[p.fn].matchAll(/errcode\s*=\s*'([0-9A-Z]{5})'/g)].every((m) => !['40001', '55000', '54000'].includes(m[1]) || !C.EC_RAISES.some((r) => r.fn === p.fn))), { detail: `changed ${changedLiterals}` });
    check('former storm cases (STALE_FIXTURE_VERSION, STANDINGS_SOURCES_CHANGED, CORRECTION_ALREADY_SUPERSEDED) raise PT409, not 40001', ['TORNEOS_STALE_FIXTURE_VERSION', 'TORNEOS_STANDINGS_SOURCES_CHANGED', 'TORNEOS_CORRECTION_ALREADY_SUPERSEDED'].every((msg) => {
      const fn = C.EC_RAISES.find((r) => r.message === msg).fn; return new RegExp(`errcode\\s*=\\s*'PT409',\\s*message\\s*=\\s*'${msg}'`).test(src6[fn]) && !new RegExp(`'40001'[^;]*'${msg}'`).test(src6[fn]);
    }));
    const top6 = topLevel(M6); const topRb = [topLevel(RB5), topLevel(RB6)];
    check('static (top-level statements): 0006 = BEGIN, temp tables, DO pre/post, 18 CREATE OR REPLACE FUNCTION, COMMIT — no GRANT / REVOKE / ALTER / POLICY / TABLE / DROP / data write', !/^\s*(GRANT|REVOKE|ALTER|CREATE (TABLE|POLICY|INDEX|UNIQUE)|DROP|INSERT|UPDATE|DELETE|TRUNCATE)\b/im.test(top6) && (top6.match(/^CREATE OR REPLACE FUNCTION /gm) ?? []).length === 18);
    check('static (top-level statements): neither rollback deletes data (no DELETE / TRUNCATE / UPDATE / DROP TABLE / DROP COLUMN); R0005 drops exactly the 9 RPCs', topRb.every((t) => !/^\s*(DELETE|TRUNCATE|UPDATE|INSERT|DROP TABLE|ALTER TABLE)\b/im.test(t))
      && (topRb[0].match(/^DROP FUNCTION /gm) ?? []).length === 9 && !/^DROP /m.test(topRb[1]));
    const r6b = psql(M6);
    check('0006 re-applied on POST_0006 → no-op', r6b.code === 0 && canon(one(G.CATALOG_SQL)) === canon(c6));
    // Hazard 1: a RAW 0005 on POST_0006 is ACCEPTED by 0005's own precondition and reverts one 0006 body.
    const raw = psql(M5); const sRaw = one(C.STATE_SQL);
    check('HAZARD proven: raw 0005 on POST_0006 exits 0 and reverts set_tournament_match_dual_control → DRIFT (partial 0006) — the tooling never sends it', raw.code === 0 && sRaw.functions.find((x) => x.sig === C.DUAL_CONTROL_FN).body_md5 === newBodies[C.DUAL_CONTROL_FN] && C.classifyState(sRaw, pinDraft).state === 'DRIFT', { detail: C.classifyState(sRaw, pinDraft).failures.join(';').slice(0, 200) });
    const heal = psql(M6);
    check('0006 re-applied after that heals to POST_0006 with the same catalog', heal.code === 0 && C.classifyState(one(C.STATE_SQL), pinDraft).state === 'POST_0006' && canon(one(G.CATALOG_SQL)) === canon(c6));
    // Hazard 2: the 0005 rollback on POST_0006 would DROP a function 0006 replaced (proven inside a transaction that rolls back).
    const probe = psql(`${RB5.replace(/\nCOMMIT;\s*$/, '\n')}\nSELECT json_build_object('dual', to_regprocedure('${C.DUAL_CONTROL_FN}') is not null, 'ec_after', (select count(*) from unnest(array[${C.EC_PINS.map((p) => `'${p.fn}'`).join(',')}]) s join pg_proc p on p.oid = to_regprocedure(s)));\nROLLBACK;\n`);
    const hz = probe.code === 0 ? JSON.parse(probe.stdout.trim().split('\n').pop()) : null;
    check('HAZARD proven: the 0005 rollback on POST_0006 runs and drops a 0006 function (17/18 left) — the tooling refuses it; the probe transaction rolled back', !!hz && hz.dual === false && hz.ec_after === 17 && C.classifyState(one(C.STATE_SQL), pinDraft).state === 'POST_0006', { detail: JSON.stringify(hz) });
    const rb6 = psql(RB6); const c5r = one(G.CATALOG_SQL);
    check('0006 rollback → POST_0005 with EXACTLY the POST_0005 catalog (every strict path + acl_md5)', rb6.code === 0 && C.classifyState(one(C.STATE_SQL), pinDraft).state === 'POST_0005' && strictDiff(c5r, c5).length === 0 && canon(c5r.acl_md5) === canon(c5.acl_md5), { detail: rb6.code ? rb6.err.slice(-200) : strictDiff(c5r, c5).join(',') });
    const rb6b = psql(RB6);
    check('0006 rollback on POST_0005 → refused or no-op, state unchanged', C.classifyState(one(C.STATE_SQL), pinDraft).state === 'POST_0005', { detail: `exit ${rb6b.code}` });
    const r6c = psql(M6);
    check('0006 re-applied after its rollback → POST_0006, same catalog as the first apply', r6c.code === 0 && canon(one(G.CATALOG_SQL)) === canon(c6));
    psql(RB6);
    const rb5 = psql(RB5); const cRb = one(G.CATALOG_SQL); const sRb = one(C.STATE_SQL);
    check('0005 rollback on POST_0005 → ROLLED_BACK_0005: 162 / 12, 9 RPCs dropped, 3 bodies POST_0004; column + table + capability kept', rb5.code === 0 && C.classifyState(sRb, pinDraft).state === 'ROLLED_BACK_0005', { detail: rb5.code ? rb5.err.slice(-300) : C.classifyState(sRb, pinDraft).failures.join(';') });
    check('ROLLED_BACK_0005 execute / signatures / bodies = POST_0004; tables keep the invitations table', canon(cRb.execute) === canon(c4.execute) && canon(cRb.functions.signatures_md5) === canon(c4.functions.signatures_md5) && canon(cRb.functions.bodies_md5) === canon(c4.functions.bodies_md5) && cRb.tables.public_tables === c4.tables.public_tables + 1);
    const re5 = psql(M5);
    check('0005 re-apply on ROLLED_BACK_0005 → REFUSED by its own precondition, nothing changed (terminal state)', re5.code !== 0 && /TORNEOS_OFFICIALIZATION_V1_PRECONDITION_FAILED/.test(re5.err) && canon(one(G.CATALOG_SQL)) === canon(cRb), { detail: re5.err.split('\n').find((l) => /PRECONDITION/.test(l))?.slice(0, 160) });

    const deltaPin = { purpose: 'OFFICIALIZATION-V1 + ERROR-CONTRACT-V1 — catalog paths per state, the 9 new bodies and per-function attributes, derived by offline-rehearsal.mjs', derived_at: new Date().toISOString(),
      image: DB_IMAGE, installer: 'postgres (non-superuser)', catalog_sql_sha256: C.sha256(G.CATALOG_SQL), state_sql_sha256: C.sha256(C.STATE_SQL),
      files: { m0005: C.M0005.sha256, m0006: C.M0006.sha256, r0005: C.R0005.sha256, r0006: C.R0006.sha256 }, paths: C.OEC_CATALOG_PATHS,
      states: { post_0004: pick(c4), post_0005: pick(c5), post_0006: pick(c6), rolled_back_0005: pick(cRb) }, new_function_bodies: newBodies, function_attrs: attrs };
    const deltaFile = C.DELTA_PIN_FILE;
    fs.mkdirSync(path.dirname(deltaFile), { recursive: true });
    const deltaText = `${JSON.stringify(deltaPin, null, 1)}\n`;
    const prev = C.readJson(deltaFile);
    const stable = prev && canon({ ...prev, derived_at: null }) === canon({ ...deltaPin, derived_at: null });
    if (!stable) fs.writeFileSync(deltaFile, deltaText);
    log(`pin ${stable ? 'unchanged' : 'written'}: pins/oec-db-delta.json sha256 ${C.sha256(fs.readFileSync(deltaFile))}`);

    // ───────────── Part B — the REAL tooling against a fresh real database ─────────────
    await freshDb();
    const fx = fixtureEnv();
    gw = await gatewayPair(fx.env);
    const cand = buildCandidate({ requireClean: false });
    const deno = fakeDeno({ env: fx.env, livePin: fx.livePin, gateway: gw, candidateDigest: cand.digest });
    const payments = { ...P.readDeltaPin(), catalog: one(G.CATALOG_SQL), gateway_roles: (({ logins, memberships, payment_logins }) => ({ logins, memberships, payment_logins }))(one(G.GATEWAY_ROLES_SQL)), payment_roles: one(P.PAYMENT_ROLES_SQL) };
    const files = { payments: path.join(tmp, 'payments.json'), cand: path.join(tmp, 'cand.json'), jwks: path.join(tmp, 'jwks.json'), deployed: path.join(tmp, 'deployed.json') };
    fs.writeFileSync(files.payments, JSON.stringify(payments)); fs.writeFileSync(files.cand, JSON.stringify({ digest: cand.digest, files: cand.manifest.length })); fs.writeFileSync(files.jwks, JSON.stringify(fx.jwksPin));
    const envOk = (env, { read: ro }) => env.PGHOST === C.POOLER_HOST && env.PGPORT === '5432' && env.PGUSER === `postgres.${C.TORNEOS_REF}` && env.PGSSLMODE === 'verify-full' && env.PGPASSWORD === FAKE_INSTALLER_PW
      && (ro ? env.PGOPTIONS === '-c default_transaction_read_only=on' : !('PGOPTIONS' in env));
    const said = []; const queue = []; const sent = [];
    const evDir = path.join(C.REPO_ROOT, 'backend/torneos/officialization-v1/evidence/rehearsal', `oec-rehearsal-${stamp}`);
    const remote = makeRemote({
      say: (s) => { said.push(s); log(`  | ${s.split('\n')[0]}`); },
      readLine: () => { const l = queue.shift(); if (l !== 'PLAN') return l ?? ''; const m = /To proceed the operator must send exactly:\n {2}(.+)$/.exec(said.at(-1) ?? ''); return m ? m[1] : ''; },
      denoToken: FAKE_DENO, now: () => Date.now(), sleep: async () => {}, pollMs: 1,
      psql: async ({ script, env }) => { if (!envOk(env, { read: true })) return { code: 97, stdout: '', stderr_tail: 'env contract violated' }; const r = psql(script, { readOnly: true }); return { code: r.code, stdout: r.stdout, stderr_tail: r.err.slice(-300) }; },
      applySql: async ({ sql, env }) => { if (!envOk(env, { read: false })) return { code: 97, stderr_tail: 'env contract violated' }; sent.push(C.sha256(sql)); const t0 = Date.now(); const r = psql(sql); return { code: r.code, elapsed_ms: Date.now() - t0, stderr_tail: r.err.split('\n').filter((l) => !/NOTICE/.test(l)).slice(-4).join('\n') }; },
      keychain: { installerPassword: () => FAKE_INSTALLER_PW, ring: () => fx.k1.pkcs8 },
      denoTransport: deno.transport, gatewayTransport: gw.transport,
      buildCandidate: () => cand, buildLive: () => buildLive(),
      evidenceDir: evDir, deltaPinFile: deltaFile, paymentsDeltaPinFile: files.payments, candidatePinFile: files.cand, jwksPinFile: files.jwks, deployedPinFile: files.deployed, livePin: fx.livePin,
      phraseChannel: 'offline rehearsal (phrase taken from the printed plan)',
    });
    const code = async (p) => { try { const r = await p; return r.verdict; } catch (e) { return e.code ?? e.message; } };
    const st = () => C.classifyState(one(C.STATE_SQL), deltaPin).state;
    const grantSig = (sig, role, verb = 'GRANT') => psql(`${verb} EXECUTE ON FUNCTION ${sig} ${verb === 'GRANT' ? 'TO' : 'FROM'} ${role};`);
    check('G1 on the real database (+ fake Deno, real gateway live source) → G1_PASS', (await code(remote.g1())) === 'G1_PASS');
    // Drift refusals on the REAL catalog.
    grantSig(C.CLOSED[0], 'authenticated');
    check('unexpected grant (authenticated on a closed function) → G1_FAILED, W1 refused before any phrase', (await code(remote.g1())) === 'G1_FAILED' && (await code(remote.w1())) === REFUSALS.w1.DRIFT && queue.length === 0);
    grantSig(C.CLOSED[0], 'authenticated', 'REVOKE');
    grantSig(C.GRANTED_0004[0], 'anon');
    check('anon drift (anon EXECUTE on a granted function) → W1 refused', (await code(remote.w1())) === REFUSALS.w1.DRIFT);
    grantSig(C.GRANTED_0004[0], 'anon', 'REVOKE');
    psql('ALTER TABLE public.tournaments ADD COLUMN match_result_dual_control_enabled boolean NOT NULL DEFAULT false;');
    check('partial 0005 (column without the rest) → DRIFT, W1 refused', st() === 'DRIFT' && (await code(remote.w1())) === REFUSALS.w1.DRIFT);
    psql('ALTER TABLE public.tournaments DROP COLUMN match_result_dual_control_enabled;');
    check('drift removed → POST_0004 again', st() === 'POST_0004');
    queue.push(`APPLY TORNEOS MIGRATION 0005 OFFICIALIZATION-V1 ${C.TORNEOS_REF} wrongplanid0`);
    check('W1 with a wrong phrase → NOT_AUTHORIZED, nothing sent', (await code(remote.w1())) === 'NOT_AUTHORIZED' && sent.length === 0 && st() === 'POST_0004');
    check('W2 before W1 → W2_REFUSED_0005_NOT_APPLIED', (await code(remote.w2())) === REFUSALS.w2.POST_0004 && sent.length === 0);
    check('W3 before W2 → W3_DB_NOT_POST_0006, no Deno write', (await code(remote.w3())) === 'W3_DB_NOT_POST_0006' && deno.state.writes.length === 0);
    check('W1 rollback on POST_0004 → refused (nothing to roll back)', (await code(remote.w1Rollback())) === REFUSALS.w1Rollback.POST_0004);
    queue.push('PLAN'); check('W1 → W1_DONE (0005 as postgres, one transaction; POST_0005; gateway still live source, probes pass)', (await code(remote.w1())) === 'W1_DONE' && st() === 'POST_0005');
    check('W1 again on POST_0005 → W1_REFUSED_ALREADY_POST_0005', (await code(remote.w1())) === REFUSALS.w1.POST_0005);
    // Partial 0006 on the real catalog: one of the 18 bodies at its 0006 text.
    const partialSig = 'public.publish_tournament_fixture(uuid,uuid)';
    psql(`BEGIN;\n${blockOf(M6, partialSig)}COMMIT;\n`);
    check('partial 0006 (1 of 18 bodies) → DRIFT, W2 refused (the migration itself would accept it; the tooling does not)', st() === 'DRIFT' && (await code(remote.w2())) === REFUSALS.w2.DRIFT);
    psql(`BEGIN;\n${blockOf(RB6, partialSig)}COMMIT;\n`);
    check('partial 0006 undone → POST_0005 again', st() === 'POST_0005');
    queue.push('PLAN'); check('W2 → W2_DONE (0006; POST_0006; 0 × 40001)', (await code(remote.w2())) === 'W2_DONE' && st() === 'POST_0006');
    const before = sent.length;
    check('W1 on POST_0006 → W1_REFUSED_POST_0006_0005_WOULD_REVERT_0006 (0005 NEVER re-sent)', (await code(remote.w1())) === REFUSALS.w1.POST_0006 && sent.length === before);
    check('W1 rollback on POST_0006 → refused (roll back 0006 first)', (await code(remote.w1Rollback())) === REFUSALS.w1Rollback.POST_0006 && sent.length === before);
    check('W2 again on POST_0006 → refused', (await code(remote.w2())) === REFUSALS.w2.POST_0006);
    queue.push('PLAN'); check('W3 → W3_DONE (assets + labels only; env unchanged; candidate probes pass)', (await code(remote.w3())) === 'W3_DONE' && gw.state.live === 'candidate');
    check('W2 rollback while the candidate serves → refused (gateway first)', (await code(remote.w2Rollback())) === 'W2_ROLLBACK_GATEWAY_NOT_ON_THE_LIVE_SOURCE');
    queue.push('PLAN'); check('W3 rollback → W3_ROLLBACK_DONE (live source rebuilt from git = 75e3535a…; live probes pass)', (await code(remote.w3Rollback())) === 'W3_ROLLBACK_DONE' && gw.state.live === 'current');
    queue.push('PLAN'); check('W2 rollback → W2_ROLLBACK_DONE (POST_0005)', (await code(remote.w2Rollback())) === 'W2_ROLLBACK_DONE' && st() === 'POST_0005');
    queue.push('PLAN'); check('W2 re-apply after its rollback → W2_DONE (POST_0006)', (await code(remote.w2())) === 'W2_DONE' && st() === 'POST_0006');
    queue.push('PLAN'); check('W2 rollback again → POST_0005', (await code(remote.w2Rollback())) === 'W2_ROLLBACK_DONE' && st() === 'POST_0005');
    queue.push('PLAN'); check('W1 rollback → W1_ROLLBACK_DONE (ROLLED_BACK_0005, 162 / 12, members kept)', (await code(remote.w1Rollback())) === 'W1_ROLLBACK_DONE' && st() === 'ROLLED_BACK_0005');
    const fin = one(C.STATE_SQL);
    check('final catalog 162 / 12', fin.counts.authenticated_public === 162 && fin.counts.anon_public === 12);
    check('W1 on ROLLED_BACK_0005 → refused (terminal; needs a new certified phase)', (await code(remote.w1())) === REFUSALS.w1.ROLLED_BACK_0005);
    check('files sent = exactly 0005, 0006, R0006, 0006, R0006, R0005 (never 0005 after 0006)', canon(sent) === canon([C.M0005.sha256, C.M0006.sha256, C.R0006.sha256, C.M0006.sha256, C.R0006.sha256, C.R0005.sha256]));
    check('Deno writes = exactly the 2 deploys; no other write kind', deno.state.writes.length === 2 && remote.denoRequests.every((r) => r.kind === 'read' || r.kind === 'write:deploy'));
    const ev = fs.readdirSync(evDir).map((f) => fs.readFileSync(path.join(evDir, f), 'utf8')).join('\n');
    check('evidence carries no secret of the run', G.secretFindings(ev, [...fx.secrets, FAKE_DENO, FAKE_INSTALLER_PW, LOCAL_PW]).length === 0 && ![FAKE_DENO, FAKE_INSTALLER_PW, LOCAL_PW].some((s) => ev.includes(s)));
    const passed = results.filter((r) => r.pass).length;
    const summary = { verdict: passed === results.length ? 'REHEARSAL_PASS' : 'REHEARSAL_FAIL', passed, total: results.length, image: DB_IMAGE,
      annotation: `OFFLINE REHEARSAL ${stamp} — local ${DB_IMAGE} on an internal network, installer postgres; real gateway handle() of both sources; fake Deno API and Keychain; NOT a remote run`,
      delta_pin_sha256: C.sha256(fs.readFileSync(deltaFile)), results };
    fs.mkdirSync(evDir, { recursive: true });
    fs.writeFileSync(path.join(evDir, 'REHEARSAL-result.json'), `${JSON.stringify(summary, null, 1)}\n`);
    log(`\n${summary.verdict} ${passed}/${results.length} — evidence ${path.relative(C.REPO_ROOT, evDir)}`);
    if (summary.verdict !== 'REHEARSAL_PASS') process.exitCode = 1;
  } finally {
    if (gw) await gw.cleanup();
    fs.rmSync(tmp, { recursive: true, force: true });
    try { if (DB) docker(['rm', '-f', DB]); } catch { /* gone */ }
    try { docker(['network', 'rm', NET]); } catch { /* gone */ }
  }
}
main().catch((e) => { console.error(`REHEARSAL_ERROR ${String(e.stack ?? e.message).slice(0, 1200)}`); try { if (DB) docker(['rm', '-f', DB]); docker(['network', 'rm', NET]); } catch { /* */ } process.exit(1); });
