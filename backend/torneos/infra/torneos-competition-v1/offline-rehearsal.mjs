#!/usr/bin/env node
// COMPETITION-V1 REMOTE — OFFLINE REHEARSAL of the Phase G tooling. Nothing leaves this machine.
//
//   • DB: a throwaway public.ecr.aws/supabase/postgres:17.6.1.147 container on an --internal Docker network, with
//     0000–0003 applied as `postgres` (non-superuser — the hosted installer, exactly as INFRA-1 did in Production).
//     The tooling's psql legs are replaced by `docker exec … psql -f -` with the SAME script bytes; every call first
//     checks that the tooling built the pinned Production env (pooler host, installer.<ref>, verify-full, read-only
//     default for reads).
//   • Gateway: the REAL handle() of both sources (bea307a3 from git, candidate tree), Core emulated in-process.
//   • Deno Deploy API v2 and Keychain: in-memory fakes. Phrases are taken from the plan the tooling printed.
//
// It derives pins/competition-v1-db-delta.json (the three catalog paths W1 moves, per state) and proves on the real
// database: G1 PASS → W1 (0004 as postgres) → W2 → W2 rollback → W1 rollback → W1 re-apply, plus the fail-closed
// refusals (drift injected in the real catalog, tampered rollback order).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import * as C from './competition-remote-contract.mjs';
import * as G from '../torneos-gateway-auth/gateway-auth-contract.mjs';
import * as P from '../torneos-payments-test/payments-test-contract.mjs';
import * as F from '../torneos-foundation/foundation-contract.mjs';
import { makeRemote } from './competition-remote.mjs';
import { buildCandidate, buildPrevious } from './competition-bundle.mjs';
import { fixtureEnv, gatewayPair, fakeDeno } from './test-support.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DOCKER = ['/Applications/Docker.app/Contents/Resources/bin/docker', '/usr/local/bin/docker', '/opt/homebrew/bin/docker'].find((p) => { try { fs.accessSync(p, fs.constants.X_OK); return true; } catch { return false; } });
if (!DOCKER) { console.error('docker not found'); process.exit(2); }
const DB_IMAGE = 'public.ecr.aws/supabase/postgres:17.6.1.147';
const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
const NET = `cv1-rehearsal-net-${process.pid}`; const DB = `cv1-rehearsal-db-${process.pid}`;
// Throwaway values of a throwaway container (it dies with the run): not credentials of anything real.
const LOCAL_PW = crypto.randomBytes(18).toString('base64url');
const FAKE_INSTALLER_PW = crypto.randomBytes(30).toString('base64url');
const FAKE_DENO = `ddo_${crypto.randomBytes(24).toString('base64url')}`;
const docker = (args) => execFileSync(DOCKER, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
const lines = [];
const log = (s) => { lines.push(s); process.stdout.write(`${s}\n`); };
const canon = (v) => JSON.stringify(v, (k, x) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.keys(x).sort().map((key) => [key, x[key]])) : x));

function psql(input, { readOnly = false } = {}) {
  const env = ['-e', `PGPASSWORD=${LOCAL_PW}`]; if (readOnly) env.push('-e', 'PGOPTIONS=-c default_transaction_read_only=on');
  const r = spawnSync(DOCKER, ['exec', '-i', ...env, DB, 'psql', '-U', 'postgres', '-h', 'localhost', '-d', 'postgres', '-X', '--no-psqlrc', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1', '-f', '-'], { input, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  return { code: r.status ?? -1, stdout: (r.stdout ?? ''), err: (r.stderr ?? '').trim() };
}
const one = (select) => { const r = psql(C.readOnlyScript(select), { readOnly: true }); if (r.code) throw new Error(`query failed: ${r.err.slice(0, 300)}`); return JSON.parse(r.stdout.trim().split('\n').pop()); };
const pick = (catalog) => Object.fromEntries(C.CV1_CATALOG_PATHS.map((p) => [p, G.getPath(catalog, p)]));

async function main() {
  const results = [];
  const check = (name, pass, extra = {}) => { results.push({ name, pass: !!pass, ...extra }); log(`${pass ? 'PASS' : 'FAIL'} ${name}${extra.detail ? ` — ${extra.detail}` : ''}`); };
  let gw = null; const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'arma2-cv1-rehearsal-'));
  try {
    docker(['network', 'create', '--internal', NET]);
    docker(['run', '-d', '--rm', '--network', NET, '--name', DB, '-e', `POSTGRES_PASSWORD=${LOCAL_PW}`, '--pull', 'never', DB_IMAGE]);
    for (let i = 0; i < 90 && psql('select 1').code !== 0; i++) await new Promise((r) => setTimeout(r, 1000));
    log(`db up: ${DB_IMAGE} ${one("select json_build_object('v', current_setting('server_version'))").v}; installer postgres (rolsuper=${one("select json_build_object('s', rolsuper) from pg_roles where rolname = 'postgres'").s})`);
    for (const m of F.MIGRATIONS) {
      const bytes = fs.readFileSync(path.join(C.REPO_ROOT, F.MIGRATIONS_DIR, m.file));
      if (C.sha256(bytes) !== m.sha256) throw new Error(`migration hash ${m.seq}`);
      const r = psql(bytes.toString('utf8'));
      if (r.code) throw new Error(`apply ${m.seq}: ${r.err.slice(-400)}`);
    }
    log('0000–0003 applied as postgres (certified bytes)');

    // ── derive the delta pin on the real database ──
    const foundationPin = JSON.parse(fs.readFileSync(G.FOUNDATION_PIN_FILE, 'utf8'));
    const cat0 = one(G.CATALOG_SQL);
    check('after 0000–0003 the catalog equals the INFRA-1 foundation pin on every strict path (same image family, installer postgres)', F.catalogDiff(cat0, foundationPin.catalog).length === 0, { detail: F.catalogDiff(cat0, foundationPin.catalog).map((d) => d.path).join(',') });
    check('the moved paths before 0004 equal the foundation pin (incl. acl_md5)', canon(pick(cat0)) === canon(pick(foundationPin.catalog)));
    const s0 = one(C.STATE_SQL);
    check('state before 0004 = PRE_0004 (15 closed, fixes absent, 147 / 12, owner postgres)', C.classifyState(s0).state === 'PRE_0004', { detail: C.classifyState(s0).failures.join(';') });
    const mig = fs.readFileSync(path.join(C.REPO_ROOT, C.MIGRATION.file), 'utf8');
    const rb = fs.readFileSync(path.join(C.REPO_ROOT, C.ROLLBACK.file), 'utf8');
    const probeApply = (sql) => psql(sql);
    const r1 = probeApply(mig); if (r1.code) throw new Error(`0004 as postgres failed: ${r1.err.slice(-600)}`);
    const post = pick(one(G.CATALOG_SQL)); const s1 = one(C.STATE_SQL);
    check('0004 applies as postgres (non-superuser installer) in ONE transaction → POST_0004', C.classifyState(s1).state === 'POST_0004', { detail: C.classifyState(s1).failures.join(';') });
    const r2 = probeApply(mig);
    check('0004 re-applied → no-op (still POST_0004, catalog unchanged)', r2.code === 0 && canon(pick(one(G.CATALOG_SQL))) === canon(post));
    const r3 = probeApply(rb); if (r3.code) throw new Error(`rollback failed: ${r3.err.slice(-600)}`);
    const rolled = pick(one(G.CATALOG_SQL)); const s3 = one(C.STATE_SQL);
    check('rollback as postgres → ROLLED_BACK (15 revoked, fixes kept, 147 / 12)', C.classifyState(s3).state === 'ROLLED_BACK');
    check('after rollback: execute = before 0004; bodies = after 0004', canon(rolled.execute) === canon(pick(cat0).execute) && canon(rolled['functions.bodies_md5'] ?? rolled.functions?.bodies_md5) === canon(post['functions.bodies_md5'] ?? post.functions?.bodies_md5));
    const r4 = probeApply(rb);
    check('rollback twice → idempotent no-op (still ROLLED_BACK, catalog unchanged)', r4.code === 0 && C.classifyState(one(C.STATE_SQL)).state === 'ROLLED_BACK' && canon(pick(one(G.CATALOG_SQL))) === canon(rolled), { detail: r4.code === 0 ? '' : r4.err.slice(-200) });
    const r5 = probeApply(mig);
    check('0004 re-applied after rollback → POST_0004 with the same catalog as the first apply', r5.code === 0 && canon(pick(one(G.CATALOG_SQL))) === canon(post));
    // Return to PRE for the tooling run: undo exactly what 0004 did (rollback + restore the two original bodies from 0000).
    const restore = psql(`${rb}`);
    if (restore.code) throw new Error('restore rollback');
    const baseline = fs.readFileSync(path.join(C.REPO_ROOT, F.MIGRATIONS_DIR, F.MIGRATIONS[0].file), 'utf8');
    const bodyOf = (name) => { const m = new RegExp(`CREATE FUNCTION public\\.${name}\\([\\s\\S]*?\\n\\$\\$;\\n`, 'm').exec(baseline); if (!m) throw new Error(`baseline body ${name}`); return m[0].replace('CREATE FUNCTION', 'CREATE OR REPLACE FUNCTION'); };
    const rr = psql(`BEGIN;\n${bodyOf('update_draft_fixture')}\n${bodyOf('publish_tournament_document_version')}\nCOMMIT;\n`);
    if (rr.code) throw new Error(`restore bodies: ${rr.err.slice(-300)}`);
    check('database restored to PRE_0004 with the catalog of 0000–0003 exactly', C.classifyState(one(C.STATE_SQL)).state === 'PRE_0004' && F.catalogDiff(one(G.CATALOG_SQL), foundationPin.catalog).length === 0 && canon(pick(one(G.CATALOG_SQL))) === canon(pick(cat0)));
    const deltaPin = { purpose: 'COMPETITION-V1 — the catalog paths W1 moves, per state (foundation CATALOG_SQL), derived by offline-rehearsal.mjs', derived_at: new Date().toISOString(),
      image: DB_IMAGE, installer: 'postgres (non-superuser)', catalog_sql_sha256: C.sha256(G.CATALOG_SQL), migration_sha256: C.MIGRATION.sha256, rollback_sha256: C.ROLLBACK.sha256,
      paths: C.CV1_CATALOG_PATHS, states: { pre: pick(cat0), post, rolled_back: rolled } };
    const deltaFile = path.join(HERE, 'pins/competition-v1-db-delta.json');
    fs.mkdirSync(path.dirname(deltaFile), { recursive: true });
    fs.writeFileSync(deltaFile, `${JSON.stringify(deltaPin, null, 1)}\n`);
    log(`pin written: pins/competition-v1-db-delta.json sha256 ${C.sha256(fs.readFileSync(deltaFile))}`);

    // ── the REAL tooling against the real database ──
    const fx = fixtureEnv();
    gw = await gatewayPair(fx.env);
    const cand = buildCandidate({ requireClean: false });
    const deno = fakeDeno({ env: fx.env, deployPin: fx.deployPin, gateway: gw, candidateHead: cand.head });
    // Environment-specific login pins (gateway-auth + payments bootstrap logins exist only in Production): the rehearsal
    // uses its own observation for those three paths; every other check is the real one.
    const payments = { ...P.readDeltaPin(), catalog: one(G.CATALOG_SQL), gateway_roles: (({ logins, memberships, payment_logins }) => ({ logins, memberships, payment_logins }))(one(G.GATEWAY_ROLES_SQL)), payment_roles: one(P.PAYMENT_ROLES_SQL) };
    const files = { payments: path.join(tmp, 'payments.json'), cand: path.join(tmp, 'cand.json'), jwks: path.join(tmp, 'jwks.json'), deployed: path.join(tmp, 'deployed.json') };
    fs.writeFileSync(files.payments, JSON.stringify(payments)); fs.writeFileSync(files.cand, JSON.stringify({ head: cand.head, digest: cand.digest, files: cand.manifest.length })); fs.writeFileSync(files.jwks, JSON.stringify(fx.jwksPin));
    const envOk = (env, { read }) => env.PGHOST === C.POOLER_HOST && env.PGPORT === '5432' && env.PGUSER === `postgres.${C.TORNEOS_REF}` && env.PGSSLMODE === 'verify-full' && env.PGPASSWORD === FAKE_INSTALLER_PW
      && (read ? env.PGOPTIONS === '-c default_transaction_read_only=on' : !('PGOPTIONS' in env));
    const said = []; const queue = [];
    const evDir = path.join(C.REPO_ROOT, 'backend/torneos/competition-v1/evidence/rehearsal', `rehearsal-${stamp}`);
    const remote = makeRemote({
      say: (s) => { said.push(s); log(`  | ${s.split('\n')[0]}`); },
      readLine: () => { const l = queue.shift(); if (l !== 'PLAN') return l ?? ''; const m = /To proceed the operator must send exactly:\n {2}(.+)$/.exec(said.at(-1) ?? ''); return m ? m[1] : ''; },
      denoToken: FAKE_DENO, now: () => Date.now(), sleep: async () => {}, pollMs: 1,
      psql: async ({ script, env }) => { if (!envOk(env, { read: true })) return { code: 97, stdout: '', stderr_tail: 'env contract violated' }; const r = psql(script, { readOnly: true }); return { code: r.code, stdout: r.stdout, stderr_tail: r.err.slice(-300) }; },
      applySql: async ({ sql, env }) => { if (!envOk(env, { read: false })) return { code: 97, stderr_tail: 'env contract violated' }; const t0 = Date.now(); const r = psql(sql); return { code: r.code, elapsed_ms: Date.now() - t0, stderr_tail: r.err.split('\n').filter((l) => !/NOTICE/.test(l)).slice(-4).join('\n') }; },
      keychain: { installerPassword: () => FAKE_INSTALLER_PW, ring: () => fx.k1.pkcs8 },
      denoTransport: deno.transport, gatewayTransport: gw.transport,
      buildCandidate: () => cand, buildPrevious: () => buildPrevious(),
      evidenceDir: evDir, deltaPinFile: deltaFile, paymentsDeltaPinFile: files.payments, candidatePinFile: files.cand, jwksPinFile: files.jwks, deployedPinFile: files.deployed, deployPin: fx.deployPin,
      phraseChannel: 'offline rehearsal (phrase taken from the printed plan)',
    });
    const code = async (p) => { try { const r = await p; return r.verdict; } catch (e) { return e.code ?? e.message; } };
    check('G1 on the real database (+ fake Deno, real gateway previous source) → G1_PASS', (await code(remote.g1())) === 'G1_PASS');
    // Drift injected in the REAL catalog: anon gains EXECUTE on one of the 15 → G1 fails and W1 refuses before any phrase.
    psql(`GRANT EXECUTE ON FUNCTION public.${C.GRANTED[0].replace(/\(.*/, '')}(${C.GRANTED[0].replace(/^[^(]+\(|\)$/g, '')}) TO anon;`);
    check('drift (anon EXECUTE on a granted function) → G1_FAILED', (await code(remote.g1())) === 'G1_FAILED');
    check('drift → W1 refused before any phrase, nothing sent', (await code(remote.w1())) === 'W1_PRECONDITION' && queue.length === 0);
    psql(`REVOKE EXECUTE ON FUNCTION public.${C.GRANTED[0].replace(/\(.*/, '')}(${C.GRANTED[0].replace(/^[^(]+\(|\)$/g, '')}) FROM anon;`);
    check('drift removed → state PRE_0004 again', C.classifyState(one(C.STATE_SQL)).state === 'PRE_0004');
    queue.push('APPLY TORNEOS MIGRATION 0004 COMPETITION-V1 onzpwnqxnvlgsevivngf wrongplanid0');
    check('W1 with a wrong phrase → NOT_AUTHORIZED, database untouched', (await code(remote.w1())) === 'NOT_AUTHORIZED' && C.classifyState(one(C.STATE_SQL)).state === 'PRE_0004');
    check('W2 before W1 → refused (DB not POST_0004), no Deno write', (await code(remote.w2())) === 'W2_DB_NOT_POST_0004' && deno.state.writes.length === 0);
    queue.push('PLAN'); check('W1 → W1_APPLIED (real psql as postgres, one transaction; postcheck catalog = pin)', (await code(remote.w1())) === 'W1_APPLIED');
    queue.push('PLAN'); check('W2 → W2_DEPLOYED (assets only; env unchanged; candidate probes pass)', (await code(remote.w2())) === 'W2_DEPLOYED' && gw.state.live === 'candidate');
    check('W1 rollback while the candidate serves → refused', (await code(remote.w1Rollback())) === 'W1_ROLLBACK_GATEWAY_NOT_ON_PREVIOUS_SOURCE');
    queue.push('PLAN'); check('W2 rollback → W2_ROLLED_BACK (previous source rebuilt from git = 723c5d39…; previous probes pass)', (await code(remote.w2Rollback())) === 'W2_ROLLED_BACK' && gw.state.live === 'previous');
    queue.push('PLAN'); check('W1 rollback → W1_ROLLED_BACK (real rollback script; fixes kept)', (await code(remote.w1Rollback())) === 'W1_ROLLED_BACK');
    queue.push('PLAN'); check('W1 re-apply from ROLLED_BACK → W1_APPLIED', (await code(remote.w1())) === 'W1_APPLIED');
    check('Deno writes = exactly the 2 deploys; no other write kind', deno.state.writes.length === 2 && remote.denoRequests.every((r) => r.kind === 'read' || r.kind === 'write:deploy'));
    const ev = fs.readdirSync(evDir).map((f) => fs.readFileSync(path.join(evDir, f), 'utf8')).join('\n');
    check('evidence carries no secret of the run', G.secretFindings(ev, [...fx.secrets, FAKE_DENO, FAKE_INSTALLER_PW, LOCAL_PW]).length === 0 && ![FAKE_DENO, FAKE_INSTALLER_PW, LOCAL_PW].some((s) => ev.includes(s)));
    const passed = results.filter((r) => r.pass).length;
    const summary = { verdict: passed === results.length ? 'REHEARSAL_PASS' : 'REHEARSAL_FAIL', passed, total: results.length, image: DB_IMAGE, annotation: `OFFLINE REHEARSAL ${stamp} — local ${DB_IMAGE} on an internal network, installer postgres; real gateway handle() of both sources; fake Deno API and Keychain; NOT a remote run`, delta_pin_sha256: C.sha256(fs.readFileSync(deltaFile)), results };
    fs.mkdirSync(evDir, { recursive: true });
    fs.writeFileSync(path.join(evDir, 'REHEARSAL-result.json'), `${JSON.stringify(summary, null, 1)}\n`);
    log(`\n${summary.verdict} ${passed}/${results.length} — evidence ${path.relative(C.REPO_ROOT, evDir)}`);
    if (summary.verdict !== 'REHEARSAL_PASS') process.exitCode = 1;
  } finally {
    if (gw) await gw.cleanup();
    fs.rmSync(tmp, { recursive: true, force: true });
    try { docker(['rm', '-f', DB]); } catch { /* gone */ }
    try { docker(['network', 'rm', NET]); } catch { /* gone */ }
  }
}
main().catch((e) => { console.error(`REHEARSAL_ERROR ${String(e.message).slice(0, 800)}`); try { docker(['rm', '-f', DB]); docker(['network', 'rm', NET]); } catch { /* */ } process.exit(1); });
