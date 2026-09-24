#!/usr/bin/env node
// INFRA-1 R3 — Staging retirement + Arma2 Torneos Supabase foundation. Operator-run through
// run-foundation.sh (a real terminal; the PAT is typed there, the phrase is read here from /dev/tty).
//
//   --staging-prepause   READ-ONLY: Core Prod healthy + contract certified, old project INACTIVE, plan free,
//                        Core Staging dependencies (branches, QA activity, client logins, cron targets) → STOP
//   --pause-staging      the same gates, fresh → phrase → POST /v1/projects/hhyvmhgpapyuzjgxfnqv/pause (the
//                        ONLY write) → poll until INACTIVE → Core Prod still healthy → Free slot count
//   --create-preflight   READ-ONLY: slot, plan, name not taken, no stray project, sa-east-1 available, Keychain → STOP
//   --create-project     the same, fresh → phrase → Keychain generate (inside Python) → POST /v1/projects (the
//                        ONLY write) → poll ACTIVE_HEALTHY → services health → Edge Functions = 0
//   --migrate            project healthy, 0 functions, database empty, hashes → phrase → psql 0000, 0001, 0002,
//                        0003 (one file each, ON_ERROR_STOP, STOP on the first failure) → marker probes
//   --certify            READ-ONLY: catalog vs the rehearsal pin + invariants, grants/RLS, PostgREST, custom_jwks
//                        (B03), Edge Functions 0, secrets, auth, Core Prod unchanged, Staging INACTIVE, commerce OFF
//
// stdin: exactly {"pat":"sbp_…"}. No ref, no name, no region, no --force: all of them are pins.
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as F from './foundation-contract.mjs';
import { makeClient, httpsTransport, ApiError } from './mgmt-foundation.mjs';
import { systemKeychain } from './keychain-foundation.mjs';
import { applyFile, psqlEnv, assertPsqlPrerequisites, POOLER_HOST_PATTERN } from './psql-foundation.mjs';
import { probePostgrest, httpsProbeTransport } from './postgrest-probe.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const EVIDENCE_DIR = path.join(F.REPO_ROOT, 'backend/torneos/mp-b/evidence/infra-1-supabase-foundation/r3');
export const EXPECTED_CATALOG_FILE = path.join(HERE, 'pins/expected-catalog.json');
export const MODES = Object.freeze({
  '--staging-prepause': { writes: null, phrase: null },
  '--pause-staging': { writes: 'pause', phrase: (id) => `PAUSE CORE STAGING ${F.STAGING_REF} ${id}` },
  '--create-preflight': { writes: null, phrase: null },
  '--create-project': { writes: 'create', phrase: (id) => `CREATE ARMA2 TORNEOS ${F.ORG_SLUG} ${F.REGION} ${id}` },
  '--migrate': { writes: 'psql', phrase: (id, ref) => `APPLY TORNEOS MIGRATIONS 0000-0003 ${ref} ${id}` },
  '--certify': { writes: null, phrase: null },
});
export const INACTIVE_STATUSES = Object.freeze(['INACTIVE', 'REMOVED']);
const PLATFORM_DB_USERS = ['supabase_admin', 'supabase_auth_admin', 'supabase_storage_admin', 'authenticator', 'supabase_realtime_admin', 'supabase_replication_admin', 'pgbouncer', 'supabase_read_only_user', 'supabase_etl_admin', 'postgres'];
const STAGING_INTERNAL_HOSTS = [`${F.STAGING_REF}.supabase.co`, 'localhost', '127.0.0.1', 'kong', 'kong:8000'];

export class StopError extends Error { constructor(code, detail) { super(code); this.code = code; this.detail = detail ?? null; } }
const stop = (code, detail) => { throw new StopError(code, detail); };
const stampOf = (d) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
const planIdOf = (plan) => F.sha256(JSON.stringify(plan)).slice(0, 12);

function writeEvidence(ctx, name, body) {
  const file = `${ctx.deps.evidencePrefix ?? ''}${name}`;
  const obj = ctx.deps.annotation ? { annotation: ctx.deps.annotation, ...body } : body;
  const text = `${JSON.stringify(obj, null, 1)}\n`;
  const leaks = F.secretFindings(text, ctx.known);
  if (leaks.length) stop('EVIDENCE_REJECTED_SECRET_LEAK', { file, findings: leaks });
  fs.mkdirSync(ctx.deps.evidenceDir, { recursive: true, mode: 0o700 });
  try { fs.writeFileSync(path.join(ctx.deps.evidenceDir, file), text, { mode: 0o600, flag: 'wx' }); } catch (e) { stop(e.code === 'EEXIST' ? 'EVIDENCE_EXISTS' : 'EVIDENCE_WRITE_FAILED', { file }); }
  const digest = F.sha256(text);
  ctx.evidence.push({ file, sha256: digest });
  ctx.say(`EVIDENCE ${file} ${digest}`);
  return digest;
}

// ─────────────────────────── observations (read-only) ───────────────────────────
async function observeCore(client) {
  const [prod, prodFn, staging, old, org, projects] = [await client.prodProject(), await client.prodContractFn(), await client.project(F.STAGING_REF), await client.project(F.OLD_REF), await client.org(), await client.projects()];
  return { prod, prodFn, staging, old, org, projects };
}
export function coreFailures(o) {
  const f = [];
  if (o.prod?.ref !== F.PROD_REF || o.prod?.organization_slug !== F.ORG_SLUG || o.prod?.region !== F.REGION) f.push('CORE_PROD_IDENTITY_MISMATCH');
  if (o.prod?.status !== 'ACTIVE_HEALTHY') f.push('CORE_PROD_NOT_ACTIVE_HEALTHY');
  if (o.prodFn?.status !== 'ACTIVE' || o.prodFn?.ezbr_sha256 !== F.CORE_CONTRACT_EZBR || o.prodFn?.verify_jwt !== false) f.push('CORE_CONTRACT_NOT_CERTIFIED');
  if (o.old?.ref !== F.OLD_REF || o.old?.status !== 'INACTIVE') f.push('OLD_PROJECT_NOT_INACTIVE');
  if (o.staging?.ref !== F.STAGING_REF || o.staging?.organization_slug !== F.ORG_SLUG) f.push('STAGING_IDENTITY_MISMATCH');
  if (o.org?.plan !== 'free') f.push('ORG_PLAN_NOT_FREE');
  return f;
}
export function orgSlots(projects) {
  const inOrg = (projects ?? []).filter((p) => p?.organization_slug === F.ORG_SLUG);
  const active = inOrg.filter((p) => !INACTIVE_STATUSES.includes(p.status));
  const torneos = inOrg.filter((p) => typeof p.name === 'string' && p.name.trim().toLowerCase() === F.PROJECT_NAME.toLowerCase());
  const unknown = inOrg.filter((p) => !F.KNOWN_REFS.includes(p.ref) && !torneos.includes(p));
  return { in_org: inOrg.map((p) => ({ ref: p.ref, name: p.name, status: p.status, region: p.region })), active: active.length, free_plan_limit: 2, free_slots: Math.max(0, 2 - active.length), torneos: torneos.map((p) => ({ ref: p.ref, name: p.name, status: p.status, region: p.region })), unknown: unknown.map((p) => ({ ref: p.ref, name: p.name, status: p.status })) };
}

async function observeStaging(client) {
  const functions = await client.functions(F.STAGING_REF);
  const branches = await client.branches(F.STAGING_REF);
  const activity = (await client.sql(F.STAGING_REF, F.STAGING_PREPAUSE_SQL))[0]?.json_build_object ?? null;
  let cron = null;
  if (activity?.cron_available) cron = (await client.sql(F.STAGING_REF, F.STAGING_CRON_SQL))[0]?.jobs ?? [];
  return { functions: functions.map((f) => ({ slug: f.slug, status: f.status, version: f.version })), branches, activity, cron };
}
export function stagingFailures(s) {
  const f = [];
  if (s.branches?.branches?.some((b) => b.is_default === false)) f.push('STAGING_PREVIEW_BRANCH_PRESENT');
  const a = s.activity?.auth_activity;
  if (!a) f.push('STAGING_ACTIVITY_UNREADABLE');
  else if (Number(a.sessions_touched_60m) > 0 || Number(a.sign_ins_60m) > 0) f.push('STAGING_QA_ACTIVE_LAST_60M');
  const foreign = (s.activity?.client_connections ?? []).filter((c) => !PLATFORM_DB_USERS.includes(c.usename));
  if (foreign.length) f.push('STAGING_EXTERNAL_DB_CLIENT_CONNECTED');
  for (const j of s.cron ?? []) {
    const ext = (j.hosts ?? []).filter((h) => !STAGING_INTERNAL_HOSTS.includes(h));
    if (j.active && ext.length) f.push(`STAGING_CRON_EXTERNAL_TARGET_${j.jobid}`);
  }
  return f;
}

// ─────────────────────────── helpers ───────────────────────────
async function poll(ctx, label, fn, { until, fail = () => false, timeoutMs, intervalMs }) {
  const t0 = ctx.deps.now();
  const seen = [];
  for (;;) {
    let v; try { v = await fn(); } catch (e) { v = { error: e.code ?? e.message }; }
    const s = typeof v === 'object' && v !== null && 'status' in v ? v.status : JSON.stringify(v).slice(0, 80);
    if (!seen.length || seen[seen.length - 1].value !== s) seen.push({ at: new Date(ctx.deps.now()).toISOString(), value: s });
    if (until(v)) return { value: v, transitions: seen, elapsed_ms: ctx.deps.now() - t0 };
    if (fail(v)) stop(`${label}_FAILED_STATE`, { last: v, transitions: seen });
    if (ctx.deps.now() - t0 > timeoutMs) stop(`${label}_TIMEOUT`, { last: v, transitions: seen, timeout_ms: timeoutMs });
    ctx.say(`  … ${label}: ${s}`);
    await ctx.deps.sleep(intervalMs);
  }
}
function requirePhrase(ctx, expected) {
  ctx.say(`\nTo proceed type exactly:\n  ${expected}\n(anything else stops, nothing is written)`);
  const typed = ctx.deps.tty.readLine('> ');
  if (typed !== expected) stop('NOT_AUTHORIZED', { expected_phrase: expected });
  return { phrase: expected, typed_on: '/dev/tty' };
}
function resolveTorneos(slots) {
  if (slots.torneos.length !== 1) stop(slots.torneos.length ? 'TORNEOS_PROJECT_AMBIGUOUS' : 'TORNEOS_PROJECT_NOT_FOUND', { torneos: slots.torneos });
  const t = slots.torneos[0];
  if (t.region !== F.REGION) stop('TORNEOS_PROJECT_REGION_MISMATCH', t);
  return t.ref;
}
function readExpectedCatalog(ctx) {
  const file = ctx.deps.expectedCatalogFile ?? EXPECTED_CATALOG_FILE;
  let pin; try { pin = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { stop('CATALOG_PIN_MISSING', { file: path.basename(file) }); }
  if (!pin?.catalog || pin.migrations?.map((m) => m.sha256).join(',') !== F.MIGRATIONS.map((m) => m.sha256).join(',')) stop('CATALOG_PIN_NOT_FOR_THESE_MIGRATIONS');
  return pin;
}
const MARKERS = {
  '0000': "select to_regclass('public.torneos_identity') is not null and to_regprocedure('private.current_identity_id()') is not null as ok",
  '0001': "select count(*) = 3 and bool_and(not has_function_privilege('authenticated', p.oid, 'EXECUTE')) as ok from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname in ('update_draft_fixture', 'schedule_tournament_match', 'publish_tournament_fixture')",
  '0002': "select exists (select 1 from pg_roles where rolname = 'torneos_payment_service' and not rolcanlogin) and to_regprocedure('public.create_tournament_season_checkout_purchase(uuid,uuid,uuid)') is not null as ok",
  '0003': "select to_regclass('public.tournament_payment_provider_watermarks') is not null and to_regprocedure('public.order_verified_tournament_payment(uuid,text,text,text,text,text,text,text,timestamptz)') is not null as ok",
};
for (const q of Object.values(MARKERS)) F.assertReadOnlySql(q);

// ─────────────────────────── modes ───────────────────────────
async function modeStagingPrepause(ctx, client, { forPause = false } = {}) {
  const core = await observeCore(client);
  const slots = orgSlots(core.projects);
  const failures = coreFailures(core);
  if (core.staging?.status === 'INACTIVE' && !failures.length) return { verdict: 'STAGING_ALREADY_INACTIVE', core, slots, staging: null, failures };
  if (core.staging?.status !== 'ACTIVE_HEALTHY') failures.push('STAGING_NOT_ACTIVE_HEALTHY');
  const staging = failures.length ? null : await observeStaging(client);
  if (staging) failures.push(...stagingFailures(staging));
  if (slots.unknown.length) failures.push('UNEXPECTED_PROJECT_IN_ORG');
  const plan = { mode: forPause ? '--pause-staging' : '--staging-prepause', write: forPause ? `POST /v1/projects/${F.STAGING_REF}/pause` : null, staging: { ref: F.STAGING_REF, status: core.staging?.status }, prod: { status: core.prod?.status, fn_ezbr: core.prodFn?.ezbr_sha256 }, old: core.old?.status, plan: core.org?.plan, active: slots.active, cron_jobs: (staging?.cron ?? []).map((j) => [j.jobid, j.command_md5, j.active]), functions: (staging?.functions ?? []).map((f) => f.slug) };
  return { verdict: failures.length ? 'STAGING_PAUSE_BLOCKED' : 'STAGING_PREPAUSE_PASS', core, slots, staging, failures, plan, plan_id: planIdOf(plan) };
}

async function runPrepause(ctx, client) {
  const r = await modeStagingPrepause(ctx, client);
  writeEvidence(ctx, `r3-01-staging-prepause-${ctx.stamp}.json`, { generated_at: new Date(ctx.deps.now()).toISOString(), mode: '--staging-prepause', read_only: true, management_api_writes: client.writes, ...r, requests: client.requests });
  if (r.failures.length) stop('STAGING_PAUSE_BLOCKED', { failures: r.failures });
  return { verdict: r.verdict };
}

async function runPause(ctx, client) {
  const r = await modeStagingPrepause(ctx, client, { forPause: true });
  if (r.verdict === 'STAGING_ALREADY_INACTIVE') {
    writeEvidence(ctx, `r3-02-pause-${ctx.stamp}.json`, { generated_at: new Date(ctx.deps.now()).toISOString(), mode: '--pause-staging', verdict: 'STAGING_ALREADY_INACTIVE', management_api_writes: 0, core: r.core, slots: r.slots, requests: client.requests });
    return { verdict: 'STAGING_ALREADY_INACTIVE' };
  }
  if (r.failures.length) {
    writeEvidence(ctx, `r3-02-pause-blocked-${ctx.stamp}.json`, { generated_at: new Date(ctx.deps.now()).toISOString(), mode: '--pause-staging', verdict: 'STAGING_PAUSE_BLOCKED', management_api_writes: 0, ...r, requests: client.requests });
    stop('STAGING_PAUSE_BLOCKED', { failures: r.failures });
  }
  ctx.say(`\nPLAN ${r.plan_id}: pause EXCLUSIVELY Core Staging ${F.STAGING_REF} (${r.core.staging.name}, ${r.core.staging.region}).\n  write: POST /v1/projects/${F.STAGING_REF}/pause — no delete, no restore, no data/secret/function change\n  Core Production ${F.PROD_REF}: ${r.core.prod.status}, torneos-core-contract ${r.core.prodFn.status} ezbr ${r.core.prodFn.ezbr_sha256.slice(0, 12)}…\n  org ${F.ORG_SLUG} plan ${r.core.org.plan}: active now ${r.slots.active}/2`);
  const authorization = requirePhrase(ctx, MODES['--pause-staging'].phrase(r.plan_id));
  const again = await modeStagingPrepause(ctx, client, { forPause: true });
  if (again.plan_id !== r.plan_id || again.failures.length) stop('STATE_CHANGED_SINCE_PLAN', { before: r.plan_id, after: again.plan_id, failures: again.failures });
  ctx.armedFor('pause');
  const paused = await client.pauseStaging();
  ctx.say(`  pause accepted (HTTP ${paused.status}); waiting for INACTIVE`);
  const waited = await poll(ctx, 'STAGING_PAUSE', () => client.project(F.STAGING_REF), { until: (p) => p?.status === 'INACTIVE', fail: (p) => p?.status === 'PAUSE_FAILED', timeoutMs: ctx.deps.pauseTimeoutMs ?? 20 * 60 * 1000, intervalMs: ctx.deps.pollIntervalMs ?? 15000 });
  const after = await observeCore(client);
  const slots = orgSlots(after.projects);
  const postFailures = coreFailures(after);
  if (after.staging?.status !== 'INACTIVE') postFailures.push('STAGING_NOT_INACTIVE_AFTER_PAUSE');
  if (slots.active !== 1 || slots.free_slots < 1) postFailures.push('FREE_SLOT_NOT_RELEASED');
  const verdict = postFailures.length ? 'STAGING_PAUSE_POSTCHECK_FAILED' : 'STAGING_PAUSED_SLOT_FREE';
  writeEvidence(ctx, `r3-02-pause-${ctx.stamp}.json`, { generated_at: new Date(ctx.deps.now()).toISOString(), mode: '--pause-staging', verdict, plan: r.plan, plan_id: r.plan_id, authorization, prepause: { failures: r.failures, staging: r.staging }, pause: { http_status: paused.status, transitions: waited.transitions, elapsed_ms: waited.elapsed_ms }, after: { prod: after.prod, prod_fn: after.prodFn, staging: after.staging, old: after.old, org: after.org }, slots, failures: postFailures, management_api_writes: client.writes, requests: client.requests });
  if (postFailures.length) stop(verdict, { failures: postFailures });
  return { verdict };
}

async function observeCreate(ctx, client) {
  const core = await observeCore(client);
  const slots = orgSlots(core.projects);
  const regions = await client.regions();
  const specific = [...(regions?.all?.specific ?? []), ...(regions?.recommendations?.specific ?? [])].filter((r) => r?.code === F.REGION);
  const region = { available: specific.length > 0, entries: specific.map((r) => ({ code: r.code, provider: r.provider ?? null, status: r.status ?? null, type: r.type ?? null })) };
  const keychain = ctx.deps.keychain.check();
  const failures = coreFailures(core);
  if (core.staging?.status !== 'INACTIVE') failures.push('STAGING_NOT_PAUSED');
  if (core.prod?.region !== F.REGION) failures.push('CORE_PROD_REGION_NOT_SA_EAST_1');
  if (!region.available) failures.push('REGION_SA_EAST_1_NOT_AVAILABLE');
  if (region.entries.some((e) => e.status === 'capacity')) failures.push('REGION_SA_EAST_1_CAPACITY_CONSTRAINED');
  if (slots.unknown.length) failures.push('UNEXPECTED_PROJECT_IN_ORG');
  let state = 'create';
  if (slots.torneos.length > 1) failures.push('TORNEOS_PROJECT_AMBIGUOUS');
  else if (slots.torneos.length === 1) {
    if (keychain !== 'PRESENT') failures.push('TORNEOS_EXISTS_WITHOUT_CUSTODY');
    else state = 'resume';
  } else if (keychain === 'PRESENT') failures.push('KEYCHAIN_PRESENT_WITHOUT_PROJECT');
  if (state === 'create' && (slots.active !== 1 || slots.free_slots < 1)) failures.push('NO_FREE_SLOT');
  const plan = { mode: '--create-project', state, write: state === 'create' ? 'POST /v1/projects' : null, body: { organization_slug: F.ORG_SLUG, name: F.PROJECT_NAME, region_selection: { type: 'specific', code: F.REGION }, db_pass: '<generated in Keychain, never printed>' }, org_plan: core.org?.plan, active: slots.active, staging: core.staging?.status, prod: core.prod?.status, keychain: { ...ctx.deps.keychain.namespace, state: keychain }, region };
  return { core, slots, region, keychain, failures, state, plan, plan_id: planIdOf(plan) };
}

async function waitHealthy(ctx, client, ref) {
  const status = await poll(ctx, 'TORNEOS_PROJECT_HEALTH', () => client.project(ref), { until: (p) => p?.status === 'ACTIVE_HEALTHY', fail: (p) => ['INIT_FAILED', 'REMOVED', 'RESTORE_FAILED', 'PAUSE_FAILED', 'INACTIVE'].includes(p?.status), timeoutMs: ctx.deps.healthTimeoutMs ?? 25 * 60 * 1000, intervalMs: ctx.deps.pollIntervalMs ?? 15000 });
  const services = await poll(ctx, 'TORNEOS_SERVICES_HEALTH', () => client.health(ref).then((s) => ({ status: s.every((x) => x.status === 'ACTIVE_HEALTHY') && s.length >= 5 ? 'ALL_HEALTHY' : 'WAITING', services: s })), { until: (v) => v.status === 'ALL_HEALTHY', timeoutMs: ctx.deps.servicesTimeoutMs ?? 10 * 60 * 1000, intervalMs: ctx.deps.pollIntervalMs ?? 15000 });
  return { project: status.value, transitions: status.transitions, elapsed_ms: status.elapsed_ms, services: services.value.services };
}

async function runCreate(ctx, client, { preflightOnly }) {
  const o = await observeCreate(ctx, client);
  const base = { generated_at: new Date(ctx.deps.now()).toISOString(), mode: preflightOnly ? '--create-preflight' : '--create-project', core: { prod: o.core.prod, prod_fn: o.core.prodFn, staging: o.core.staging, old: o.core.old, org: o.core.org }, slots: o.slots, region: o.region, keychain: o.keychain, failures: o.failures, plan: o.plan, plan_id: o.plan_id };
  if (preflightOnly || o.failures.length) {
    writeEvidence(ctx, `r3-03-create-preflight-${ctx.stamp}.json`, { ...base, read_only: true, verdict: o.failures.length ? 'CREATE_BLOCKED' : 'CREATE_PREFLIGHT_PASS', management_api_writes: client.writes, requests: client.requests });
    if (o.failures.length) stop('CREATE_BLOCKED', { failures: o.failures });
    return { verdict: 'CREATE_PREFLIGHT_PASS' };
  }
  let project; let authorization = null; let custody;
  if (o.state === 'create') {
    ctx.say(`\nPLAN ${o.plan_id}: create EXACTLY ONE project\n  name ${F.PROJECT_NAME} · org ${F.ORG_SLUG} (plan ${o.core.org.plan}) · region ${F.REGION} · no instance size (smallest), no plan field, no add-on\n  db password: generated inside keychain-foundation.py → Keychain ${ctx.deps.keychain.namespace.service}/${ctx.deps.keychain.namespace.account} (never printed)\n  active projects now ${o.slots.active}/2 · Core Staging ${o.core.staging.status}`);
    authorization = requirePhrase(ctx, MODES['--create-project'].phrase(o.plan_id));
    const again = await observeCreate(ctx, client);
    if (again.plan_id !== o.plan_id || again.failures.length) stop('STATE_CHANGED_SINCE_PLAN', { before: o.plan_id, after: again.plan_id, failures: again.failures });
    ctx.deps.keychain.generate();
    const dbPass = ctx.deps.keychain.read();
    ctx.known.push(dbPass);
    custody = { ...ctx.deps.keychain.namespace, generated: 'keychain-foundation.py generate (secrets.token_urlsafe(30), pty store, read-back compare)', length: dbPass.length, value_printed: false };
    ctx.armedFor('create');
    const created = await client.createProject(dbPass);
    if (!F.REF_PATTERN.test(created?.ref ?? '') || F.KNOWN_REFS.includes(created.ref) || created.name !== F.PROJECT_NAME || created.organization_slug !== F.ORG_SLUG || created.region !== F.REGION) {
      writeEvidence(ctx, `r3-03-create-UNEXPECTED-${ctx.stamp}.json`, { ...base, created, verdict: 'CREATE_RESPONSE_UNEXPECTED', requests: client.requests });
      stop('CREATE_RESPONSE_UNEXPECTED', { created });
    }
    client.setCreatedRef(created.ref);
    project = created;
    writeEvidence(ctx, `r3-03-create-record-${ctx.stamp}.json`, { ...base, verdict: 'PROJECT_CREATE_ACCEPTED', authorization, created, custody, management_api_writes: client.writes, requests: client.requests });
  } else {
    const ref = resolveTorneos(o.slots);
    client.setCreatedRef(ref);
    project = await client.project(ref);
    custody = { ...ctx.deps.keychain.namespace, state: 'PRESENT (resume: no generation, no create)' };
  }
  const health = await waitHealthy(ctx, client, client.createdRef);
  const functions = await client.functions(client.createdRef);
  const final = await client.project(client.createdRef);
  const failures = [];
  if (functions.length !== 0) failures.push('EDGE_FUNCTIONS_NOT_ZERO');
  if (final.region !== F.REGION || final.name !== F.PROJECT_NAME || final.organization_slug !== F.ORG_SLUG) failures.push('PROJECT_IDENTITY_MISMATCH');
  const verdict = failures.length ? 'CREATE_POSTCHECK_FAILED' : 'ARMA2_TORNEOS_ACTIVE_HEALTHY';
  writeEvidence(ctx, `r3-03-create-${ctx.stamp}.json`, { ...base, verdict, state: o.state, authorization, project: final, created_response: project, custody, health, edge_functions: { count: functions.length, slugs: functions.map((f) => f.slug) }, failures, management_api_writes: client.writes, requests: client.requests });
  if (failures.length) stop(verdict, { failures });
  return { verdict, ref: client.createdRef };
}

async function observeMigrate(ctx, client) {
  const core = await observeCore(client);
  const slots = orgSlots(core.projects);
  const ref = resolveTorneos(slots);
  client.setCreatedRef(ref);
  const project = await client.project(ref);
  const functions = await client.functions(ref);
  const empty = (await client.sql(ref, F.TORNEOS_EMPTY_SQL))[0]?.json_build_object ?? null;
  const pooler = await client.pooler(ref);
  const failures = coreFailures(core);
  if (project.status !== 'ACTIVE_HEALTHY') failures.push('TORNEOS_NOT_ACTIVE_HEALTHY');
  if (functions.length) failures.push('EDGE_FUNCTIONS_NOT_ZERO');
  let migrations;
  try { migrations = F.loadMigrations(ctx.deps.repoRoot ?? F.REPO_ROOT).map((m) => ({ seq: m.seq, file: m.file, sha256: m.actual, bytes: m.bytes, abs: m.abs })); } catch (e) { stop('MIGRATION_HASH_MISMATCH', { error: e.message }); }
  const host = pooler.hosts.find((h) => POOLER_HOST_PATTERN.test(h)) ?? null;
  if (!host) failures.push('POOLER_HOST_NOT_SA_EAST_1');
  const pre = ctx.deps.psqlPrerequisites();
  failures.push(...pre);
  let state = 'apply';
  if (!empty) failures.push('DATABASE_STATE_UNREADABLE');
  else if (Number(empty.torneos_roles) === 3 && Number(empty.private_schema) === 1 && Number(empty.public_relations) > 0) state = 'installed';
  else if (Number(empty.public_relations) !== 0 || Number(empty.public_functions) !== 0 || Number(empty.private_schema) !== 0 || Number(empty.torneos_roles) !== 0) failures.push('DATABASE_NOT_EMPTY_OR_PARTIAL');
  if (empty && Number(empty.pgcrypto_available) !== 1) failures.push('PGCRYPTO_UNAVAILABLE');
  const keychain = ctx.deps.keychain.check();
  if (keychain !== 'PRESENT') failures.push('KEYCHAIN_DB_PASSWORD_ABSENT');
  const plan = { mode: '--migrate', ref, state, transport: `psql ${host ?? '?'}:5432 postgres.${ref} sslmode=verify-full`, files: migrations.map(({ abs, ...m }) => m), empty, functions: functions.length };
  return { core, ref, project, functions, empty, pooler, host, migrations, failures, state, plan, plan_id: planIdOf(plan) };
}

async function runMigrate(ctx, client) {
  const o = await observeMigrate(ctx, client);
  const base = { generated_at: new Date(ctx.deps.now()).toISOString(), mode: '--migrate', ref: o.ref, project: o.project, plan: o.plan, plan_id: o.plan_id, failures: o.failures };
  if (o.failures.length) {
    writeEvidence(ctx, `r3-04-migrate-blocked-${ctx.stamp}.json`, { ...base, verdict: 'MIGRATE_BLOCKED', requests: client.requests });
    stop('MIGRATE_BLOCKED', { failures: o.failures });
  }
  if (o.state === 'installed') {
    writeEvidence(ctx, `r3-04-migrate-${ctx.stamp}.json`, { ...base, verdict: 'MIGRATIONS_ALREADY_INSTALLED', applied: [], requests: client.requests });
    return { verdict: 'MIGRATIONS_ALREADY_INSTALLED' };
  }
  ctx.say(`\nPLAN ${o.plan_id}: apply EXCLUSIVELY these 4 files to Arma2 Torneos ${o.ref}, in order, one psql run each (ON_ERROR_STOP; each file is its own BEGIN…COMMIT):\n${o.migrations.map((m) => `  ${m.seq} ${m.file} sha256 ${m.sha256}`).join('\n')}\n  transport: ${o.plan.transport} · password from Keychain (PGPASSWORD of the child only)\n  no ledger write, no repair, no extra SQL`);
  const authorization = requirePhrase(ctx, MODES['--migrate'].phrase(o.plan_id, o.ref));
  const again = await observeMigrate(ctx, client);
  if (again.plan_id !== o.plan_id || again.failures.length) stop('STATE_CHANGED_SINCE_PLAN', { before: o.plan_id, after: again.plan_id, failures: again.failures });
  const password = ctx.deps.keychain.read();
  ctx.known.push(password);
  const env = psqlEnv({ host: o.host, ref: o.ref, password });
  const redact = (t) => { let s = String(t); for (const k of ctx.known) if (k && k.length >= 8) s = s.split(k).join('«REDACTED»'); return s; };
  const applied = [];
  for (const m of o.migrations) {
    // Re-hash immediately before sending: the bytes psql reads are the certified bytes.
    if (F.sha256(fs.readFileSync(m.abs)) !== m.sha256) stop('MIGRATION_HASH_CHANGED_BEFORE_APPLY', { seq: m.seq });
    ctx.say(`  applying ${m.seq} ${m.file} …`);
    const r = await ctx.deps.applyFile({ file: m.abs, env, redact });
    const marker = r.code === 0 ? (await client.sql(o.ref, MARKERS[m.seq]))[0]?.ok === true : null;
    applied.push({ seq: m.seq, file: m.file, sha256: m.sha256, exit_code: r.code, signal: r.signal ?? null, elapsed_ms: r.elapsed_ms, stderr_tail: r.code === 0 ? null : r.stderr_tail, marker_ok: marker });
    if (r.code !== 0 || marker !== true) {
      writeEvidence(ctx, `r3-04-migrate-FAILED-${ctx.stamp}.json`, { ...base, verdict: 'MIGRATION_FAILED', authorization, applied, stopped_at: m.seq, requests: client.requests });
      stop('MIGRATION_FAILED', { seq: m.seq, exit_code: r.code });
    }
    ctx.say(`  ${m.seq} ok (${r.elapsed_ms} ms)`);
  }
  writeEvidence(ctx, `r3-04-migrate-${ctx.stamp}.json`, { ...base, verdict: 'MIGRATIONS_0000_0003_APPLIED', authorization, applied, management_api_writes: client.writes, requests: client.requests });
  return { verdict: 'MIGRATIONS_0000_0003_APPLIED' };
}

async function runCertify(ctx, client) {
  const pin = readExpectedCatalog(ctx);
  const core = await observeCore(client);
  const slots = orgSlots(core.projects);
  const ref = resolveTorneos(slots);
  client.setCreatedRef(ref);
  const project = await client.project(ref);
  const functions = await client.functions(ref);
  const secrets = await client.secretNames(ref);
  const branches = await client.branches(ref);
  const catalog = (await client.sql(ref, F.CATALOG_SQL))[0]?.json_build_object ?? null;
  const authUsers = (await client.sql(ref, 'select count(*)::int as n from auth.users'))[0]?.n ?? null;
  const dbMigrations = await client.dbMigrations(ref);
  const tpa = await client.thirdPartyAuth(ref);
  const auth = await client.authConfig(ref);
  const postgrest = await client.postgrest(ref);
  const keys = await client.apiKeys(ref);
  const failures = coreFailures(core);
  if (core.staging?.status !== 'INACTIVE') failures.push('STAGING_NOT_INACTIVE');
  if (project.status !== 'ACTIVE_HEALTHY' || project.region !== F.REGION) failures.push('TORNEOS_NOT_ACTIVE_HEALTHY_SA_EAST_1');
  if (functions.length) failures.push('EDGE_FUNCTIONS_NOT_ZERO');
  const nonPlatformSecrets = secrets.filter((n) => !/^SUPABASE_/.test(n));
  if (nonPlatformSecrets.length) failures.push('NON_PLATFORM_SECRETS_PRESENT');
  const diff = catalogDiff(catalog, pin.catalog);
  if (diff.length) failures.push('CATALOG_DIFFERS_FROM_PIN');
  const inv = F.catalogInvariantFailures(catalog);
  failures.push(...inv.map((x) => `INVARIANT_${x}`));
  if (authUsers !== 0) failures.push('TORNEOS_AUTH_HAS_USERS');
  if (dbMigrations.length) failures.push('MIGRATIONS_LEDGER_NOT_EMPTY_UNEXPECTED');
  if (Array.isArray(tpa) && tpa.length) failures.push('THIRD_PARTY_AUTH_UNEXPECTED');
  const schemas = String(postgrest?.db_schema ?? '').split(',').map((s) => s.trim());
  if (schemas.includes('private') || schemas.includes('app_private')) failures.push('PRIVATE_SCHEMA_EXPOSED');
  let probe = null;
  if (!keys.probeKey) failures.push('POSTGREST_PROBE_KEY_UNAVAILABLE');
  else {
    ctx.known.push(keys.probeKey);
    probe = await probePostgrest({ ref, apikey: keys.probeKey, transport: ctx.deps.probeTransport });
    if (!probe.pass) failures.push('POSTGREST_PROBE_FAILED');
  }
  const b03 = !Array.isArray(tpa) ? 'B03_BLOCKED' : tpa.length === 0 ? 'B03_REMOTE_ACTION_REQUIRED' : 'B03_BLOCKED';
  const commerce = { torneos_edge_functions: functions.length, payments_login_roles: (catalog?.role_members ?? []).filter((m) => m.role === 'torneos_payment_service' && m.member !== 'postgres').length, mercado_pago_secrets: secrets.filter((n) => /MERCADO|MP_/.test(n)).length, gateway_logins: (catalog?.role_members ?? []).filter((m) => /^torneos_edge_/.test(m.member)).length, pre_request: catalog?.authenticator_pre_request ?? null };
  if (commerce.payments_login_roles || commerce.mercado_pago_secrets || commerce.gateway_logins) failures.push('COMMERCE_NOT_OFF');
  const verdict = failures.length ? 'TORNEOS_DB_CERTIFICATION_FAILED' : 'TORNEOS_DB_CERTIFIED';
  writeEvidence(ctx, `r3-05-certify-${ctx.stamp}.json`, {
    generated_at: new Date(ctx.deps.now()).toISOString(), mode: '--certify', read_only: true, verdict, ref, project,
    core_production: { project: core.prod, torneos_core_contract: core.prodFn, certification: F.CORE_PROD_CERTIFICATION },
    core_staging: core.staging, old_project: core.old, org: core.org, slots,
    edge_functions: { count: functions.length }, secret_names: secrets, branches,
    catalog, catalog_pin: { file: 'pins/expected-catalog.json', sha256: F.sha256(fs.readFileSync(ctx.deps.expectedCatalogFile ?? EXPECTED_CATALOG_FILE)) }, catalog_diff: diff, invariant_failures: inv,
    auth: { config: auth, users: authUsers }, migrations_ledger_api: dbMigrations, third_party_auth: tpa, b03, postgrest_config: postgrest,
    api_keys: keys.keys, postgrest_probe: probe && { key_kind: keys.probeKeyKind, ...probe }, commerce, failures,
    management_api_writes: client.writes, requests: client.requests,
  });
  if (failures.length) stop(verdict, { failures });
  return { verdict, b03 };
}
export const catalogDiff = F.catalogDiff;

// ─────────────────────────── entry ───────────────────────────
export async function runFoundation({ mode, request, deps }) {
  if (!MODES[mode]) throw new StopError('USAGE', { modes: Object.keys(MODES) });
  if (!request || typeof request !== 'object' || Object.keys(request).join(',') !== 'pat') throw new StopError('REQUEST_REFUSED', { expected: '{"pat":…} only' });
  if (!F.PAT_PATTERN.test(request.pat)) throw new StopError('PAT_MALFORMED');
  let armed = null;
  const ctx = { deps, known: [request.pat], evidence: [], say: deps.say, stamp: stampOf(new Date(deps.now())) };
  // One client for the whole run; its arming is read at each request and can only be the mode's own write.
  const client = makeClient({ transport: deps.transport, pat: request.pat, armedFor: () => armed, known: ctx.known });
  ctx.armedFor = (w) => { if (MODES[mode].writes !== w) throw new StopError('ARMING_REFUSED', { mode, w }); armed = w; };
  try {
    if (mode === '--staging-prepause') return await runPrepause(ctx, client);
    if (mode === '--pause-staging') return await runPause(ctx, client);
    if (mode === '--create-preflight') return await runCreate(ctx, client, { preflightOnly: true });
    if (mode === '--create-project') return await runCreate(ctx, client, { preflightOnly: false });
    if (mode === '--migrate') return await runMigrate(ctx, client);
    return await runCertify(ctx, client);
  } catch (e) {
    if (e instanceof StopError) throw e;
    if (e instanceof ApiError) throw new StopError(e.code, e.detail);
    throw new StopError('UNEXPECTED_ERROR', { error: String(e?.message ?? e).slice(0, 200) });
  } finally {
    ctx.known.splice(0);
  }
}

function systemTty() {
  return {
    readLine(prompt) {
      const fd = fs.openSync('/dev/tty', 'r+');
      try {
        fs.writeSync(fd, prompt);
        const buf = Buffer.alloc(1); let line = '';
        for (;;) { const n = fs.readSync(fd, buf, 0, 1, null); if (n === 0) break; const ch = buf.toString('utf8'); if (ch === '\n') break; line += ch; if (line.length > 400) break; }
        return line.replace(/\r$/, '');
      } finally { fs.closeSync(fd); }
    },
  };
}

async function main() {
  const mode = process.argv[2];
  if (process.argv.length !== 3 || !MODES[mode]) { process.stderr.write(`FOUNDATION_USAGE: one of ${Object.keys(MODES).join(' | ')}\n`); process.exit(2); }
  const stdin = await new Promise((resolve) => { const c = []; process.stdin.on('data', (x) => c.push(x)); process.stdin.on('end', () => resolve(Buffer.concat(c).toString('utf8'))); });
  let request; try { request = JSON.parse(stdin); } catch { process.stderr.write('FOUNDATION_STDIN_NOT_JSON\n'); process.exit(2); }
  const say = (s) => process.stdout.write(`${s}\n`);
  const deps = {
    transport: httpsTransport, probeTransport: httpsProbeTransport, keychain: systemKeychain(), tty: systemTty(),
    applyFile, psqlPrerequisites: () => assertPsqlPrerequisites(), now: () => Date.now(), sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    evidenceDir: EVIDENCE_DIR, say,
  };
  try {
    const r = await runFoundation({ mode, request, deps });
    request.pat = '';
    say(`\nRESULT ${r.verdict}${r.ref ? ` ${r.ref}` : ''}${r.b03 ? ` ${r.b03}` : ''}`);
    process.exit(0);
  } catch (e) {
    request.pat = '';
    const detail = e?.detail ? JSON.stringify(e.detail).slice(0, 1500) : '';
    say(`\nSTOP ${e?.code ?? 'ERROR'} ${F.secretFindings(detail).length ? '(detail withheld: secret-shaped)' : detail}`);
    process.exit(1);
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
