#!/usr/bin/env node
// GATEWAY/AUTH (G2) — Production gateway/auth tooling for Arma2 Torneos (onzpwnqxnvlgsevivngf) with Core Production
// (rcyuuoaqfwcembdajcss) as the HTTPS authority. Operator-run through run-gateway-auth.sh (a real terminal; the PAT is
// typed there, the phrase is read here from /dev/tty). NOT phase3b/remote: no Staging, no Edge Function deploy, no
// nonprod custody. Every mode re-observes the whole state first; every write mode prints its plan, takes the exact
// phrase, re-observes (plan id must be unchanged), performs ONLY its declared write, post-checks, writes evidence.
//
//   --preflight         READ-ONLY  Core Prod + contract certified, Staging/old INACTIVE, Torneos healthy, foundation
//                                  intact, 0 Edge Functions, SUPABASE_* secrets only; classifies W1 / W2+W3 / KR / W5
//                                  and measures the installer's privileges for W2/W3 → STOP
//   --auth-lockdown     W1         PATCH config/auth with exactly AUTH_LOCKDOWN_BODY (6 keys); post-check: nothing else in
//                                  Auth moved, GoTrue signup/OTP refused, 0 users, 0 third-party auth
//   --db-bootstrap      W2 + W3    ONE psql transaction: 2 LOGIN NOINHERIT roles (SCRAM verifiers; passwords generated
//                                  into the Keychain), 2 GRANTs, pgrst.db_pre_request = private.check_token
//   --keyring-generate  LOCAL      a new Production ring (k1 active, k2 standby) into the Keychain + the public JWKS pin
//   --b03               W5         POST third-party-auth {custom_jwks: pinned public k1+k2} → measured bridge probes
//   --deploy-preflight  READ-ONLY  the gateway's Production env, built from pins + custody presence, validated by the REAL
//                                  gateway config.ts (topology = production) → pending human decisions listed → STOP
//   --certify           READ-ONLY  the post-gateway/auth state: foundation intact + delta pin + invariants + Auth locked +
//                                  custom_jwks + 0 Edge Functions + probes + Core Prod unchanged + Staging INACTIVE
//
// stdin: exactly {"pat":"sbp_…"}. No ref, no key, no URL, no --force: all of them are pins.
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as G from './gateway-auth-contract.mjs';
import * as FC from '../torneos-foundation/foundation-contract.mjs';
import { makeClient, httpsTransport, ApiError } from './mgmt-gateway-auth.mjs';
import { systemKeychain } from './keychain-gateway-auth.mjs';
import { applySql, psqlEnv, assertPsqlPrerequisites, POOLER_HOST_PATTERN, CA_CERT } from './psql-gateway-auth.mjs';
import { generateRing, jwksPinDocument, assertJwksPin, publicFromPkcs8, gatewayRingDocument, jwksDigest, rotationPlan } from './keyring.mjs';
import { probeBridge } from './bridge-probe.mjs';
import { probeAuthRefusals, httpsAuthProbeTransport } from './auth-probe.mjs';
import { probePostgrest, httpsProbeTransport } from '../torneos-foundation/postgrest-probe.mjs';

export const EVIDENCE_DIR = path.join(G.REPO_ROOT, 'backend/torneos/mp-b/evidence/gateway-auth');
export const MODES = Object.freeze({
  '--preflight': { seq: '01', phrase: null },
  '--auth-lockdown': { seq: '02', phrase: (id) => `LOCK TORNEOS AUTH ${G.TORNEOS_REF} ${id}` },
  '--db-bootstrap': { seq: '03', phrase: (id) => `BOOTSTRAP TORNEOS GATEWAY DB ${G.TORNEOS_REF} ${id}` },
  '--keyring-generate': { seq: '04', phrase: (id) => `GENERATE TORNEOS PRODUCTION BRIDGE RING ${id}` },
  '--b03': { seq: '05', phrase: (id) => `PUBLISH TORNEOS B03 CUSTOM JWKS ${G.TORNEOS_REF} ${id}` },
  '--deploy-preflight': { seq: '06', phrase: null },
  '--certify': { seq: '07', phrase: null },
});

export class StopError extends Error { constructor(code, detail) { super(code); this.code = code; this.detail = detail ?? null; } }
const stop = (code, detail) => { throw new StopError(code, detail); };
const stampOf = (d) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
const planIdOf = (plan) => G.sha256(JSON.stringify(plan)).slice(0, 12);
const canon = (v) => JSON.stringify(v, (k, x) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.keys(x).sort().map((key) => [key, x[key]])) : x));

function writeEvidence(ctx, name, body) {
  const file = `${ctx.deps.evidencePrefix ?? ''}${name}`;
  const obj = { ...(ctx.deps.annotation ? { annotation: ctx.deps.annotation } : {}), tool: 'backend/torneos/infra/torneos-gateway-auth', ...body };
  const text = `${JSON.stringify(obj, null, 1)}\n`;
  const leaks = G.secretFindings(text, ctx.known);
  if (leaks.length) stop('EVIDENCE_REJECTED_SECRET_LEAK', { file, findings: leaks });
  fs.mkdirSync(ctx.deps.evidenceDir, { recursive: true, mode: 0o700 });
  try { fs.writeFileSync(path.join(ctx.deps.evidenceDir, file), text, { mode: 0o600, flag: 'wx' }); } catch (e) { stop(e.code === 'EEXIST' ? 'EVIDENCE_EXISTS' : 'EVIDENCE_WRITE_FAILED', { file }); }
  const digest = G.sha256(text);
  ctx.evidence.push({ file, sha256: digest });
  ctx.say(`EVIDENCE ${file} ${digest}`);
  return digest;
}
function requirePhrase(ctx, expected) {
  ctx.say(`\nTo proceed type exactly:\n  ${expected}\n(anything else stops, nothing is written)`);
  const typed = ctx.deps.tty.readLine('> ');
  if (typed !== expected) stop('NOT_AUTHORIZED', { expected_phrase: expected });
  return { phrase: expected, typed_on: '/dev/tty' };
}
const readJson = (file) => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; } };

// ─────────────────────────── pins ───────────────────────────
function loadPins(ctx) {
  const drift = G.foundationDrift(ctx.deps.repoRoot ?? G.REPO_ROOT);
  if (drift.length) stop('FOUNDATION_TOOLING_DRIFT', { files: drift });
  const foundation = readJson(ctx.deps.foundationPinFile ?? G.FOUNDATION_PIN_FILE);
  if (!foundation?.catalog) stop('FOUNDATION_PIN_MISSING');
  const delta = readJson(ctx.deps.deltaPinFile ?? G.DELTA_PIN_FILE);
  if (delta && (delta.foundation_pin_sha256 !== G.FOUNDATION_FILES['backend/torneos/infra/torneos-foundation/pins/expected-catalog.json'] || delta.bootstrap_sql_template_sha256 !== G.sha256(G.BOOTSTRAP_SQL_TEMPLATE))) stop('DELTA_PIN_NOT_FOR_THIS_FOUNDATION_OR_SQL');
  const jwksFile = ctx.deps.jwksPinFile ?? G.JWKS_PIN_FILE;
  let jwks = null;
  if (fs.existsSync(jwksFile)) { jwks = readJson(jwksFile); try { assertJwksPin(jwks); } catch (e) { stop('JWKS_PIN_INVALID', { error: e.message }); } }
  return { foundation, delta, jwks, jwksFile };
}
const NON_DELTA_STRICT = FC.STRICT_CATALOG_PATHS.filter((p) => !G.DELTA_PATHS.includes(p));
export function foundationDiff(catalog, foundationPin) {
  return NON_DELTA_STRICT.filter((p) => canon(G.getPath(catalog, p)) !== canon(G.getPath(foundationPin.catalog, p))).map((p) => ({ path: p }));
}

// ─────────────────────────── observation (read-only) ───────────────────────────
export function coreFailures(o) {
  const f = [];
  if (o.prod?.ref !== G.CORE_PROD_REF || o.prod?.organization_slug !== G.ORG_SLUG || o.prod?.region !== G.REGION) f.push('CORE_PROD_IDENTITY_MISMATCH');
  if (o.prod?.status !== 'ACTIVE_HEALTHY') f.push('CORE_PROD_NOT_ACTIVE_HEALTHY');
  if (o.prodFn?.status !== 'ACTIVE' || o.prodFn?.ezbr_sha256 !== G.CORE_CONTRACT_EZBR || o.prodFn?.verify_jwt !== false) f.push('CORE_CONTRACT_NOT_CERTIFIED');
  if (o.staging?.ref !== G.STAGING_REF || o.staging?.status !== 'INACTIVE') f.push('STAGING_NOT_INACTIVE');
  if (o.old?.ref !== G.OLD_REF || o.old?.status !== 'INACTIVE') f.push('OLD_PROJECT_NOT_INACTIVE');
  if (o.torneos?.ref !== G.TORNEOS_REF || o.torneos?.name !== G.PROJECT_NAME || o.torneos?.organization_slug !== G.ORG_SLUG || o.torneos?.region !== G.REGION) f.push('TORNEOS_IDENTITY_MISMATCH');
  if (o.torneos?.status !== 'ACTIVE_HEALTHY') f.push('TORNEOS_NOT_ACTIVE_HEALTHY');
  const inOrg = (o.projects ?? []).filter((p) => p?.organization_slug === G.ORG_SLUG);
  if (inOrg.some((p) => ![G.CORE_PROD_REF, G.STAGING_REF, G.OLD_REF, G.TORNEOS_REF].includes(p.ref))) f.push('UNEXPECTED_PROJECT_IN_ORG');
  if (inOrg.filter((p) => p.ref === G.TORNEOS_REF).length !== 1) f.push('TORNEOS_NOT_LISTED_ONCE');
  return f;
}

async function observe(ctx, client, pins, { deep = false } = {}) {
  const core = { prod: await client.prodProject(), prodFn: await client.prodContractFn(), staging: await client.project(G.STAGING_REF), old: await client.project(G.OLD_REF),
    torneos: await client.project(G.TORNEOS_REF), org: await client.org(), projects: await client.projects() };
  const functions = await client.functions();
  const { config: auth, fingerprint: authFingerprint } = await client.authConfig();
  const tpa = await client.thirdPartyAuth();
  const catalog = (await client.sql(G.CATALOG_SQL))[0]?.json_build_object ?? null;
  const roles = (await client.sql(G.GATEWAY_ROLES_SQL))[0]?.json_build_object ?? null;
  const t = { functions: functions.map((f) => f.slug), auth, tpa, catalog, roles };
  if (deep) {
    t.health = await client.health();
    t.secrets = await client.secretNames();
    t.postgrest = await client.postgrest();
    t.ledger = await client.dbMigrations();
  }
  const kc = ctx.deps.keychain;
  const logins = G.EDGE_LOGINS.map((l) => kc.dbLogin(l.login).check());
  const custody = {
    dataplane_installer: kc.dataplane.check(),
    gateway_logins: logins.every((x) => x === 'PRESENT') ? 'PRESENT' : logins.every((x) => x === 'ABSENT') ? 'ABSENT' : 'PARTIAL',
    ring: kc.ring.check(),
    jwks_pin: pins.jwks ? { file: path.basename(pins.jwksFile), kids: pins.jwks.keys.map((k) => k.kid), digest: jwksDigest(pins.jwks) } : null,
  };
  const steps = {
    W1: G.authState(auth),
    DB: G.dbState(catalog, roles, pins.foundation, pins.delta),
    KR: custody.ring === 'ABSENT' && !pins.jwks ? 'absent' : custody.ring === 'PRESENT' && pins.jwks ? 'present' : 'inconsistent',
    W5: G.b03State(tpa, pins.jwks),
  };
  const failures = coreFailures(core);
  if (functions.length !== 0) failures.push('EDGE_FUNCTIONS_NOT_ZERO');
  if (!catalog || !roles) failures.push('CATALOG_UNREADABLE');
  const fdiff = catalog ? foundationDiff(catalog, pins.foundation) : [];
  if (fdiff.length) failures.push('FOUNDATION_CATALOG_DRIFT');
  if (steps.W1.problems?.length) failures.push(...steps.W1.problems);
  if (steps.DB.state === 'foreign' || steps.DB.state === 'unreadable') failures.push(`DB_STATE_${steps.DB.state.toUpperCase()}`);
  if (steps.KR === 'inconsistent') failures.push('RING_CUSTODY_AND_PIN_INCONSISTENT');
  if (steps.W5.state === 'foreign' || steps.W5.state === 'unreadable') failures.push(`B03_STATE_${steps.W5.state.toUpperCase()}`);
  if (tpa?.some((x) => x.custom_jwks_private_material)) failures.push('B03_PRIVATE_MATERIAL_PUBLISHED');
  if (custody.gateway_logins === 'PARTIAL') failures.push('GATEWAY_LOGIN_CUSTODY_PARTIAL');
  if (steps.DB.state === 'applied' && custody.gateway_logins !== 'PRESENT') failures.push('GATEWAY_LOGINS_WITHOUT_CUSTODY');
  if (Number(roles?.auth_users) !== 0) failures.push('TORNEOS_AUTH_HAS_USERS');
  if (deep) {
    if (!t.health?.length || !t.health.every((s) => s.status === 'ACTIVE_HEALTHY')) failures.push('TORNEOS_SERVICES_NOT_HEALTHY');
    if ((t.secrets ?? []).some((n) => !/^SUPABASE_/.test(n))) failures.push('NON_PLATFORM_SECRETS_PRESENT');
    const schemas = String(t.postgrest?.db_schema ?? '').split(',').map((s) => s.trim());
    if (schemas.includes('private') || schemas.includes('app_private')) failures.push('PRIVATE_SCHEMA_EXPOSED');
    if ((t.ledger ?? []).length) failures.push('MIGRATIONS_LEDGER_NOT_EMPTY_UNEXPECTED');
  }
  const invariants = catalog ? (steps.DB.state === 'applied' ? G.gatewayInvariantFailures(catalog, roles) : FC.catalogInvariantFailures(catalog)) : ['catalog_unreadable'];
  if (invariants.length) failures.push(...invariants.map((x) => `INVARIANT_${x}`));
  // authFingerprint: in memory only, never serialized (see fingerprintAuthConfig).
  return { core, torneos: t, custody, steps, failures, foundation_diff: fdiff, invariants, authFingerprint };
}
const stateSummary = (o) => ({ W1: o.steps.W1.state, W2_W3: o.steps.DB.state, KR: o.steps.KR, W5: o.steps.W5.state, edge_functions: o.torneos.functions.length, custody: o.custody });
const coreSummary = (o) => ({ prod: o.core.prod?.status, prod_contract: { status: o.core.prodFn?.status, ezbr: o.core.prodFn?.ezbr_sha256, verify_jwt: o.core.prodFn?.verify_jwt }, staging: o.core.staging?.status, old: o.core.old?.status, torneos: o.core.torneos?.status });

function base(ctx, mode, o) {
  return { generated_at: new Date(ctx.deps.now()).toISOString(), mode, core: coreSummary(o), state: stateSummary(o), failures: o.failures };
}
function blocked(ctx, mode, o, code, extra = {}) {
  writeEvidence(ctx, `ga-${MODES[mode].seq}-${mode.slice(2)}-blocked-${ctx.stamp}.json`, { ...base(ctx, mode, o), verdict: code, ...extra, management_api_writes: ctx.client.writes, requests: ctx.client.requests });
  stop(code, { failures: o.failures, ...extra });
}

// ─────────────────────────── modes ───────────────────────────
async function runPreflight(ctx, client, pins) {
  const o = await observe(ctx, client, pins, { deep: true });
  const pooler = await client.pooler();
  const installer = o.torneos.roles?.installer ?? null;
  const measured = { installer, pooler_hosts: pooler.hosts, pooler_sa_east_1: pooler.hosts.some((h) => POOLER_HOST_PATTERN.test(h)), psql_prerequisites: ctx.deps.psqlPrerequisites() };
  const next = o.steps.W1.state !== 'applied' ? '--auth-lockdown' : o.steps.DB.state !== 'applied' ? '--db-bootstrap' : o.steps.KR === 'absent' ? '--keyring-generate' : o.steps.W5.state !== 'applied' ? '--b03' : '--deploy-preflight';
  const risks = [];
  if (installer && !(installer.super || (installer.createrole && installer.admin_on_authenticator && installer.admin_on_identity_writer && installer.admin_on_core_adapter))) risks.push('DB_INSTALLER_LACKS_PRIVILEGE_FOR_W2_W3');
  if (!measured.pooler_sa_east_1) risks.push('POOLER_HOST_NOT_SA_EAST_1');
  const verdict = o.failures.length ? 'GATEWAY_AUTH_PREFLIGHT_BLOCKED' : 'GATEWAY_AUTH_PREFLIGHT_PASS';
  writeEvidence(ctx, `ga-01-preflight-${ctx.stamp}.json`, { ...base(ctx, '--preflight', o), read_only: true, verdict, next_mode: o.failures.length ? null : next, measured, risks,
    foundation_diff: o.foundation_diff, invariants: o.invariants, auth: o.torneos.auth, third_party_auth: o.torneos.tpa, secret_names: o.torneos.secrets, postgrest_config: o.torneos.postgrest,
    remote_delta: { W1: G.AUTH_LOCKDOWN_BODY, W2_W3_sql_template: G.BOOTSTRAP_SQL_TEMPLATE, W5: 'custom_jwks = public k1 + k2 of pins/production-bridge-jwks.json' },
    management_api_writes: client.writes, requests: client.requests });
  if (o.failures.length) stop(verdict, { failures: o.failures });
  return { verdict, next };
}

// Keys of the WHOLE Auth answer whose value moved between two observations (by default the body's own keys excepted).
const authKeysChanged = (a, b, { body = false } = {}) => [...new Set([...Object.keys(a ?? {}), ...Object.keys(b ?? {})])].filter((k) => (body || !(k in G.AUTH_LOCKDOWN_BODY)) && a?.[k] !== b?.[k]).sort();
const tpaFailures = (o) => (Array.isArray(o.torneos.tpa) && o.torneos.tpa.length === 0 ? [] : ['THIRD_PARTY_AUTH_NOT_ZERO']);

async function runAuthLockdown(ctx, client, pins) {
  const mode = '--auth-lockdown';
  const o = await observe(ctx, client, pins);
  o.failures.push(...tpaFailures(o));
  if (o.failures.length) blocked(ctx, mode, o, 'AUTH_LOCKDOWN_BLOCKED', { auth: o.torneos.auth, must_off_checked: G.authMustOffKeys(o.torneos.auth) });
  if (o.steps.W1.state === 'applied') {
    writeEvidence(ctx, `ga-02-auth-lockdown-${ctx.stamp}.json`, { ...base(ctx, mode, o), verdict: 'AUTH_LOCKDOWN_ALREADY_APPLIED', auth: o.torneos.auth, management_api_writes: 0, requests: client.requests });
    return { verdict: 'AUTH_LOCKDOWN_ALREADY_APPLIED' };
  }
  const mustOff = G.authMustOffKeys(o.torneos.auth);
  const plan = { mode, write: `PATCH /v1/projects/${G.TORNEOS_REF}/config/auth`, body: G.AUTH_LOCKDOWN_BODY, before: o.torneos.auth, must_off_checked: mustOff, state: stateSummary(o), core: coreSummary(o) };
  const planId = planIdOf(plan);
  const beforeBody = Object.keys(G.AUTH_LOCKDOWN_BODY).map((k) => `${k}=${JSON.stringify(o.torneos.auth?.[k])}`).join(' ');
  ctx.say(`\nPLAN ${planId}: lock Arma2 Torneos Auth (${G.TORNEOS_REF}) — Torneos has no login of its own\n  write: PATCH config/auth with EXACTLY ${JSON.stringify(G.AUTH_LOCKDOWN_BODY)}\n  now:   ${beforeBody}\n  differs now: ${o.steps.W1.differs.join(', ')}\n  checked off (not written): ${mustOff.length} flags, all false · auth.users ${o.torneos.roles?.auth_users} · third-party auth ${o.torneos.tpa.length} · Edge Functions ${o.torneos.functions.length}\n  untouched: every other Auth setting · Core Production ${o.core.prod.status} (read only) · Staging ${o.core.staging?.status}`);
  const authorization = requirePhrase(ctx, MODES[mode].phrase(planId));
  const again = await observe(ctx, client, pins);
  again.failures.push(...tpaFailures(again));
  const planAgain = { mode, write: plan.write, body: G.AUTH_LOCKDOWN_BODY, before: again.torneos.auth, must_off_checked: G.authMustOffKeys(again.torneos.auth), state: stateSummary(again), core: coreSummary(again) };
  const movedSincePlan = authKeysChanged(o.authFingerprint, again.authFingerprint, { body: true });
  if (planIdOf(planAgain) !== planId || again.failures.length || movedSincePlan.length) stop('STATE_CHANGED_SINCE_PLAN', { before: planId, after: planIdOf(planAgain), failures: again.failures, auth_keys_moved: movedSincePlan });
  ctx.arm('auth-lockdown');
  const response = await client.authLockdown();
  ctx.arm(null);
  const after = await observe(ctx, client, pins);
  const failures = [...after.failures, ...tpaFailures(after)];
  if (after.steps.W1.state !== 'applied') failures.push('AUTH_LOCKDOWN_NOT_EFFECTIVE');
  const changedOutsideBody = authKeysChanged(again.authFingerprint, after.authFingerprint);
  if (changedOutsideBody.length) failures.push('AUTH_SETTINGS_OUTSIDE_THE_BODY_CHANGED');
  // GoTrue refusal probes: only on a lockdown the Management API shows applied, with nothing else wrong.
  let authProbe = null; let final = null;
  if (!failures.length) {
    const keys = await client.apiKeys();
    if (!keys.probeKey) failures.push('AUTH_PROBE_KEY_UNAVAILABLE');
    else if (typeof ctx.deps.authProbeTransport !== 'function') failures.push('AUTH_PROBE_TRANSPORT_MISSING');
    else {
      ctx.known.push(keys.probeKey);
      try {
        authProbe = await probeAuthRefusals({ ref: G.TORNEOS_REF, apikey: keys.probeKey, transport: ctx.deps.authProbeTransport, stamp: ctx.stamp, known: ctx.known });
      } catch (e) { authProbe = { error: String(e.message).slice(0, 160) }; failures.push('AUTH_PROBE_ERROR'); }
      if (authProbe?.failures) failures.push(...authProbe.failures);
    }
    // After the probes: still 0 users, 0 third-party auth, and no Auth key moved since the post-PATCH read.
    final = await observe(ctx, client, pins);
    failures.push(...final.failures.filter((f) => !failures.includes(f)), ...tpaFailures(final).filter((f) => !failures.includes(f)));
    if (final.steps.W1.state !== 'applied') failures.push('AUTH_LOCKDOWN_NOT_EFFECTIVE_AFTER_PROBES');
    if (authKeysChanged(after.authFingerprint, final.authFingerprint).length) failures.push('AUTH_SETTINGS_CHANGED_DURING_PROBES');
  }
  const last = final ?? after;
  const verdict = failures.length ? 'AUTH_LOCKDOWN_POSTCHECK_FAILED' : 'TORNEOS_AUTH_LOCKED';
  writeEvidence(ctx, `ga-02-auth-lockdown-${ctx.stamp}.json`, { ...base(ctx, mode, last), verdict, plan, plan_id: planId, authorization, response, auth_before: again.torneos.auth, auth_after: last.torneos.auth,
    must_off_checked: G.authMustOffKeys(last.torneos.auth), changed_outside_body: changedOutsideBody, auth_users_after: Number(last.torneos.roles?.auth_users), third_party_auth_after: last.torneos.tpa?.length ?? null,
    edge_functions_after: last.torneos.functions.length, auth_probe: authProbe, failures, management_api_writes: client.writes, requests: client.requests });
  if (failures.length) stop(verdict, { failures });
  return { verdict };
}

async function runDbBootstrap(ctx, client, pins) {
  const mode = '--db-bootstrap';
  if (!pins.delta) stop('DELTA_PIN_MISSING');
  const o = await observe(ctx, client, pins);
  const pooler = await client.pooler();
  const host = pooler.hosts.find((h) => POOLER_HOST_PATTERN.test(h)) ?? null;
  const failures = [...o.failures];
  if (o.steps.W1.state !== 'applied') failures.push('ORDER_AUTH_LOCKDOWN_FIRST');
  if (!host) failures.push('POOLER_HOST_NOT_SA_EAST_1');
  failures.push(...ctx.deps.psqlPrerequisites());
  if (o.custody.dataplane_installer !== 'PRESENT') failures.push('KEYCHAIN_DATAPLANE_INSTALLER_ABSENT');
  const inst = o.torneos.roles?.installer;
  if (o.steps.DB.state === 'pending' && !(inst?.super || (inst?.createrole && inst?.admin_on_authenticator && inst?.admin_on_identity_writer && inst?.admin_on_core_adapter))) failures.push('DB_INSTALLER_LACKS_PRIVILEGE_FOR_W2_W3');
  if (failures.length) blocked(ctx, mode, { ...o, failures }, 'DB_BOOTSTRAP_BLOCKED');
  if (o.steps.DB.state === 'applied') {
    writeEvidence(ctx, `ga-03-db-bootstrap-${ctx.stamp}.json`, { ...base(ctx, mode, o), verdict: 'DB_BOOTSTRAP_ALREADY_APPLIED', roles: o.torneos.roles, management_api_writes: 0, psql_writes: 0, requests: client.requests });
    return { verdict: 'DB_BOOTSTRAP_ALREADY_APPLIED' };
  }
  const custodyPlan = o.custody.gateway_logins === 'ABSENT' ? 'generate (keychain-gateway-auth.py, secrets.token_urlsafe(30), pty)' : 'reuse (PRESENT from an attempt that did not commit; no regeneration)';
  const plan = { mode, transport: `psql ${host}:5432 postgres.${G.TORNEOS_REF} sslmode=verify-full (SQL on stdin)`, sql_template_sha256: G.sha256(G.BOOTSTRAP_SQL_TEMPLATE), custody: custodyPlan, state: stateSummary(o), core: coreSummary(o) };
  const planId = planIdOf(plan);
  ctx.say(`\nPLAN ${planId}: gateway DB bootstrap on Arma2 Torneos ${G.TORNEOS_REF} — ONE transaction (W2 + W3):\n${G.BOOTSTRAP_SQL_TEMPLATE.split('\n').filter(Boolean).map((l) => `  ${l}`).join('\n')}\n  login passwords: ${custodyPlan} → Keychain ${G.KEYCHAIN_GATEWAY_DB_SERVICE}/<login>; the server receives SCRAM verifiers only\n  NOT created: any payments login · NOT touched: Core Production, Edge Functions, secrets`);
  const authorization = requirePhrase(ctx, MODES[mode].phrase(planId));
  const again = await observe(ctx, client, pins);
  const planAgain = { ...plan, state: stateSummary(again), core: coreSummary(again) };
  if (planIdOf(planAgain) !== planId || again.failures.length) stop('STATE_CHANGED_SINCE_PLAN', { before: planId, after: planIdOf(planAgain), failures: again.failures });
  const kc = ctx.deps.keychain;
  if (o.custody.gateway_logins === 'ABSENT') for (const l of G.EDGE_LOGINS) kc.dbLogin(l.login).generate();
  const verifiers = {};
  for (const l of G.EDGE_LOGINS) { const pw = kc.dbLogin(l.login).read(); ctx.known.push(pw); verifiers[l.login] = G.scramVerifier(pw); ctx.known.push(verifiers[l.login]); }
  const installerPw = kc.dataplane.read(); ctx.known.push(installerPw);
  const redact = (t) => { let s = String(t); for (const k of ctx.known) if (k && k.length >= 8) s = s.split(k).join('«REDACTED»'); return s.replace(/SCRAM-SHA-256\$[^'\s]+/g, '«SCRAM»'); };
  const sql = G.renderBootstrapSql(verifiers);
  const r = await ctx.deps.applySql({ sql, env: psqlEnv({ host, password: installerPw }), redact });
  const after = await observe(ctx, client, pins);
  const post = [...after.failures];
  if (r.code !== 0) post.push('DB_BOOTSTRAP_TRANSACTION_FAILED');
  if (after.steps.DB.state !== 'applied') post.push('DB_BOOTSTRAP_NOT_EFFECTIVE');
  const verdict = post.length ? (r.code !== 0 && after.steps.DB.state === 'pending' ? 'DB_BOOTSTRAP_ROLLED_BACK' : 'DB_BOOTSTRAP_POSTCHECK_FAILED') : 'TORNEOS_GATEWAY_DB_BOOTSTRAPPED';
  writeEvidence(ctx, `ga-03-db-bootstrap-${ctx.stamp}.json`, { ...base(ctx, mode, after), verdict, plan, plan_id: planId, authorization,
    psql: { exit_code: r.code, signal: r.signal ?? null, elapsed_ms: r.elapsed_ms, stderr_tail: r.code === 0 ? null : r.stderr_tail },
    custody: { service: G.KEYCHAIN_GATEWAY_DB_SERVICE, accounts: G.EDGE_LOGINS.map((l) => l.login), mode: custodyPlan, values_printed: false },
    roles_after: after.torneos.roles, pre_request_after: after.torneos.catalog?.authenticator_pre_request ?? null, failures: post,
    management_api_writes: client.writes, psql_writes: 1, requests: client.requests });
  if (post.length) stop(verdict, { failures: post });
  return { verdict };
}

async function runKeyringGenerate(ctx, client, pins) {
  const mode = '--keyring-generate';
  const o = await observe(ctx, client, pins);
  const failures = [...o.failures];
  if (o.steps.W1.state !== 'applied') failures.push('ORDER_AUTH_LOCKDOWN_FIRST');
  if (o.steps.DB.state !== 'applied') failures.push('ORDER_DB_BOOTSTRAP_FIRST');
  if (o.steps.W5.state !== 'pending') failures.push('B03_NOT_PENDING_REFUSE_NEW_RING');
  if (o.steps.KR !== 'absent') failures.push('RING_ALREADY_PRESENT_REFUSE_REGENERATE');
  if (failures.length) blocked(ctx, mode, { ...o, failures }, 'KEYRING_BLOCKED');
  const plan = { mode, local_only: true, custody: `${G.KEYCHAIN_BRIDGE_SERVICE} / k1.meta, k1.part*, k2.meta, k2.part*`, pin: path.relative(G.REPO_ROOT, pins.jwksFile), alg: 'RS256', modulus_bits: G.RSA_MODULUS_BITS, state: stateSummary(o) };
  const planId = planIdOf(plan);
  ctx.say(`\nPLAN ${planId}: generate a NEW Production bridge ring (k1 active, k2 standby), RSA ${G.RSA_MODULUS_BITS}, RS256\n  private halves → Keychain ${G.KEYCHAIN_BRIDGE_SERVICE} (never printed, never a file) · public halves → ${plan.pin}\n  no import, no nonprod key, no remote write (B03 is a separate mode)`);
  const authorization = requirePhrase(ctx, MODES[mode].phrase(planId));
  const again = await observe(ctx, client, pins);
  if (planIdOf({ ...plan, state: stateSummary(again) }) !== planId || again.failures.length) stop('STATE_CHANGED_SINCE_PLAN', { failures: again.failures });
  const ring = generateRing();
  for (const s of ring.slots) ctx.known.push(s.pkcs8);
  ctx.deps.keychain.ring.store(ring);
  // Custody read-back ≡ generated public halves, before the pin exists.
  for (const s of ring.slots) { const back = publicFromPkcs8(ctx.deps.keychain.ring.read(s.slot, s.kid), s.kid); if (back.n !== s.publicJwk.n) stop('KEYCHAIN_RING_READBACK_MISMATCH', { slot: s.slot }); }
  const pinDoc = jwksPinDocument(ring.jwks, { generatedAt: new Date(ctx.deps.now()).toISOString() });
  const pinText = `${JSON.stringify(pinDoc, null, 1)}\n`;
  if (G.secretFindings(pinText, ctx.known).length) stop('JWKS_PIN_WOULD_CARRY_SECRET');
  fs.mkdirSync(path.dirname(pins.jwksFile), { recursive: true });
  try { fs.writeFileSync(pins.jwksFile, pinText, { mode: 0o644, flag: 'wx' }); } catch { stop('JWKS_PIN_EXISTS'); }
  writeEvidence(ctx, `ga-04-keyring-generate-${ctx.stamp}.json`, { ...base(ctx, mode, o), verdict: 'PRODUCTION_BRIDGE_RING_GENERATED', plan, plan_id: planId, authorization,
    ring: { active: pinDoc.active, standby: pinDoc.standby, jwks_digest: jwksDigest(pinDoc), pin_sha256: G.sha256(pinText) }, rotation_plan: rotationPlan(pinDoc),
    management_api_writes: client.writes, requests: client.requests });
  return { verdict: 'PRODUCTION_BRIDGE_RING_GENERATED', kids: [pinDoc.active, pinDoc.standby] };
}

function readRing(ctx, jwksPin) {
  const out = {};
  for (const [i, slot] of G.RING_SLOTS.entries()) {
    const kid = jwksPin.keys[i].kid;
    const pkcs8 = ctx.deps.keychain.ring.read(slot, kid);
    ctx.known.push(pkcs8);
    const pub = publicFromPkcs8(pkcs8, kid);
    if (pub.n !== jwksPin.keys[i].n || pub.e !== jwksPin.keys[i].e) stop('RING_CUSTODY_DIFFERS_FROM_PIN', { slot });
    out[slot] = { pkcs8, kid };
  }
  return out;
}

async function runB03(ctx, client, pins) {
  const mode = '--b03';
  const o = await observe(ctx, client, pins);
  const failures = [...o.failures];
  if (o.steps.W1.state !== 'applied') failures.push('ORDER_AUTH_LOCKDOWN_FIRST');
  if (o.steps.DB.state !== 'applied') failures.push('ORDER_DB_BOOTSTRAP_FIRST');
  if (o.steps.KR !== 'present') failures.push('ORDER_KEYRING_FIRST');
  if (failures.length) blocked(ctx, mode, { ...o, failures }, 'B03_BLOCKED');
  const ring = readRing(ctx, pins.jwks);
  const keys = await client.apiKeys();
  if (!keys.probeKey) stop('POSTGREST_PROBE_KEY_UNAVAILABLE');
  ctx.known.push(keys.probeKey);
  const probe = (label) => probeBridge({ ref: G.TORNEOS_REF, apikey: keys.probeKey, ring, transport: ctx.deps.probeTransport }).then((r) => ({ label, ...r }));
  if (o.steps.W5.state === 'applied') {
    const p = await probe('already applied');
    writeEvidence(ctx, `ga-05-b03-${ctx.stamp}.json`, { ...base(ctx, mode, o), verdict: 'B03_ALREADY_APPLIED', third_party_auth: o.torneos.tpa, bridge_probe: p, management_api_writes: 0, requests: client.requests });
    return { verdict: 'B03_ALREADY_APPLIED' };
  }
  const body = G.customJwksBody(pins.jwks);
  const plan = { mode, write: `POST /v1/projects/${G.TORNEOS_REF}/config/auth/third-party-auth`, body_digest: G.sha256(JSON.stringify(body)), kids: body.custom_jwks.keys.map((k) => k.kid), state: stateSummary(o), core: coreSummary(o) };
  const planId = planIdOf(plan);
  const before = await probe('before B03 (bridge tokens must be refused)');
  if (before.hostAcceptsBridge) stop('BRIDGE_TOKEN_ACCEPTED_BEFORE_B03', { checks: before.checks });
  ctx.say(`\nPLAN ${planId}: B03 on Arma2 Torneos ${G.TORNEOS_REF}\n  write: POST third-party-auth {custom_jwks: {keys: [${plan.kids.join(', ')}]}} — public halves only, digest ${plan.body_digest.slice(0, 16)}…\n  then: measured probes (k1/k2 → PT401 identity gate; unknown key → 401 before the DB)`);
  const authorization = requirePhrase(ctx, MODES[mode].phrase(planId));
  const again = await observe(ctx, client, pins);
  if (planIdOf({ ...plan, state: stateSummary(again), core: coreSummary(again) }) !== planId || again.failures.length) stop('STATE_CHANGED_SINCE_PLAN', { failures: again.failures });
  ctx.arm('b03');
  const created = await client.createThirdPartyAuth(body);
  ctx.arm(null);
  const after = await observe(ctx, client, pins);
  const post = [...after.failures];
  if (after.steps.W5.state !== 'applied') post.push('B03_NOT_EFFECTIVE');
  // The host may need a moment to resolve the integration: bounded re-probes, same tokens class, no write.
  let probeAfter = null;
  for (let i = 0; i < (ctx.deps.b03ProbeAttempts ?? 6); i += 1) { probeAfter = await probe(`after B03 #${i + 1}`); if (probeAfter.pass) break; await ctx.deps.sleep(ctx.deps.b03ProbeIntervalMs ?? 10000); }
  if (!probeAfter.hostAcceptsBridge) post.push('B03_HOST_REJECTS_BRIDGE_TOKEN');
  else if (!probeAfter.pass) post.push('B03_BRIDGE_PROBE_FAILED');
  const verdict = post.includes('B03_HOST_REJECTS_BRIDGE_TOKEN') ? 'B03_HOST_REJECTS_BRIDGE_TOKEN' : post.length ? 'B03_POSTCHECK_FAILED' : 'B03_APPLIED_BRIDGE_ACCEPTED';
  writeEvidence(ctx, `ga-05-b03-${ctx.stamp}.json`, { ...base(ctx, mode, after), verdict, plan, plan_id: planId, authorization, created, third_party_auth_after: after.torneos.tpa,
    bridge_probe_before: before, bridge_probe_after: probeAfter, failures: post, management_api_writes: client.writes, requests: client.requests });
  if (post.length) stop(verdict, { failures: post });
  return { verdict };
}

/** The gateway's Production environment: pins + custody presence; secrets replaced by shape-equal placeholders. */
export function productionGatewayEnv({ publicUrl, poolerHost, jwksPin, k1Pkcs8, torneosAnonKey, caPem }) {
  const pw = 'x'.repeat(40);
  return {
    TORNEOS_GATEWAY_PUBLIC_URL: publicUrl,
    TORNEOS_ALLOWED_ORIGIN: G.GATEWAY_TOPOLOGY.allowedOrigin,
    CORE_AUTH_URL: G.GATEWAY_TOPOLOGY.coreAuthUrl,
    CORE_JWT_ISSUER: G.GATEWAY_TOPOLOGY.coreJwtIssuer,
    CORE_CONTRACT_URL: G.GATEWAY_TOPOLOGY.coreContractUrl,
    TORNEOS_CONTRACT_SERVICE_SECRET: 'ab'.repeat(32),
    TORNEOS_REST_URL: G.GATEWAY_TOPOLOGY.torneosRestUrl,
    TORNEOS_ANON_KEY: torneosAnonKey,
    TORNEOS_DB_IDENTITY_WRITER_URL: `postgres://${G.GATEWAY_TOPOLOGY.identityWriterLogin}.${G.TORNEOS_REF}:${pw}@${poolerHost}:6543/postgres`,
    TORNEOS_DB_CORE_ADAPTER_URL: `postgres://${G.GATEWAY_TOPOLOGY.coreAdapterLogin}.${G.TORNEOS_REF}:${pw}@${poolerHost}:6543/postgres`,
    TORNEOS_DB_SSL_CA: Buffer.from(caPem).toString('base64'),
    TORNEOS_BRIDGE_KEYS: JSON.stringify(gatewayRingDocument({ k1Pkcs8, jwksPin })),
  };
}
export const DEPLOY_SECRET_NAMES = Object.freeze(['TORNEOS_CONTRACT_SERVICE_SECRET', 'TORNEOS_BRIDGE_KEYS', 'TORNEOS_DB_IDENTITY_WRITER_URL', 'TORNEOS_DB_CORE_ADAPTER_URL']);
export const DEPLOY_CONFIG_NAMES = Object.freeze(['TORNEOS_GATEWAY_PUBLIC_URL', 'TORNEOS_ALLOWED_ORIGIN', 'CORE_AUTH_URL', 'CORE_JWT_ISSUER', 'CORE_ANON_KEY', 'CORE_CONTRACT_URL', 'TORNEOS_REST_URL', 'TORNEOS_ANON_KEY', 'TORNEOS_DB_SSL_CA']);

async function runDeployPreflight(ctx, client, pins) {
  const mode = '--deploy-preflight';
  const o = await observe(ctx, client, pins, { deep: true });
  const failures = [...o.failures];
  for (const [k, s] of [['W1', o.steps.W1.state], ['W2_W3', o.steps.DB.state], ['W5', o.steps.W5.state]]) if (s !== 'applied') failures.push(`ORDER_${k}_NOT_APPLIED`);
  if (o.steps.KR !== 'present') failures.push('ORDER_KEYRING_NOT_PRESENT');
  const decisions = ctx.deps.deployDecisions ?? G.GATEWAY_DEPLOY_DECISIONS;
  const pending = Object.entries(decisions).filter(([, v]) => v === null).map(([k]) => `DEPLOY_DECISION_PENDING_${k}`);
  let validation = null;
  if (!failures.length) {
    const ring = readRing(ctx, pins.jwks);
    const keys = await client.apiKeys();
    const poolerHost = (await client.pooler()).hosts.find((h) => POOLER_HOST_PATTERN.test(h)) ?? null;
    if (!keys.probeKey) failures.push('TORNEOS_PUBLISHABLE_KEY_UNAVAILABLE'); else ctx.known.push(keys.probeKey);
    if (!poolerHost) failures.push('POOLER_HOST_NOT_SA_EAST_1');
    let caPem = null; try { caPem = fs.readFileSync(ctx.deps.caCert ?? CA_CERT, 'utf8'); } catch { failures.push('SUPABASE_CA_MISSING'); }
    if (!failures.length) {
      const env = productionGatewayEnv({ publicUrl: decisions.publicUrl ?? 'https://gateway-decision-pending.invalid/functions/v1/torneos-gateway', poolerHost, jwksPin: pins.jwks, k1Pkcs8: ring.k1.pkcs8, torneosAnonKey: keys.probeKey, caPem });
      try {
        validation = await ctx.deps.validateGatewayEnv(env);
        if (validation.topology?.kind !== 'production') failures.push('GATEWAY_TOPOLOGY_NOT_PRODUCTION');
        if (validation.commerce !== 'off') failures.push('GATEWAY_COMMERCE_NOT_OFF');
        if (canon(validation.trustedKids) !== canon(pins.jwks.keys.map((k) => k.kid)) || validation.activeKid !== pins.jwks.active) failures.push('GATEWAY_RING_NOT_THE_PIN');
      } catch (e) { failures.push('GATEWAY_CONFIG_REJECTED'); validation = { error: String(e.message).slice(0, 200) }; }
      const names = Object.keys(env).concat('CORE_ANON_KEY');
      if (canon([...new Set(names)].sort()) !== canon([...DEPLOY_SECRET_NAMES, ...DEPLOY_CONFIG_NAMES].sort())) failures.push('GATEWAY_ENV_NAMES_NOT_EXACT');
    }
  }
  const all = [...failures, ...pending];
  const verdict = all.length ? 'GATEWAY_DEPLOY_PREFLIGHT_BLOCKED' : 'GATEWAY_DEPLOY_PREFLIGHT_PASS';
  writeEvidence(ctx, `ga-06-deploy-preflight-${ctx.stamp}.json`, { ...base(ctx, mode, o), read_only: true, verdict, failures, pending_decisions: pending,
    gateway_env: { secrets: DEPLOY_SECRET_NAMES, config: DEPLOY_CONFIG_NAMES, deploy_time_public_inputs: ['CORE_ANON_KEY (Core Production publishable key, public by design)'], organization_variables: [], supabase_edge_functions: 0 },
    validation, management_api_writes: client.writes, requests: client.requests });
  if (all.length) stop(verdict, { failures, pending_decisions: pending });
  return { verdict };
}

async function runCertify(ctx, client, pins) {
  const mode = '--certify';
  if (!pins.delta) stop('DELTA_PIN_MISSING');
  const o = await observe(ctx, client, pins, { deep: true });
  const failures = [...o.failures];
  for (const [k, s] of [['W1', o.steps.W1.state], ['W2_W3', o.steps.DB.state], ['W5', o.steps.W5.state]]) if (s !== 'applied') failures.push(`${k}_NOT_APPLIED`);
  if (o.steps.KR !== 'present') failures.push('KEYRING_NOT_PRESENT');
  const deltaDiff = G.DELTA_PATHS.filter((p) => canon(G.getPath(o.torneos.catalog, p)) !== canon(G.getPath(pins.delta.catalog, p))).map((p) => ({ path: p }));
  if (deltaDiff.length) failures.push('CATALOG_DIFFERS_FROM_DELTA_PIN');
  let postgrestProbe = null; let bridge = null;
  const keys = await client.apiKeys();
  if (!keys.probeKey) failures.push('POSTGREST_PROBE_KEY_UNAVAILABLE');
  else {
    ctx.known.push(keys.probeKey);
    postgrestProbe = await probePostgrest({ ref: G.TORNEOS_REF, apikey: keys.probeKey, transport: ctx.deps.probeTransport });
    if (!postgrestProbe.pass) failures.push('POSTGREST_PROBE_FAILED');
    if (o.steps.KR === 'present') {
      bridge = await probeBridge({ ref: G.TORNEOS_REF, apikey: keys.probeKey, ring: readRing(ctx, pins.jwks), transport: ctx.deps.probeTransport });
      if (!bridge.hostAcceptsBridge) failures.push('B03_HOST_REJECTS_BRIDGE_TOKEN'); else if (!bridge.pass) failures.push('BRIDGE_PROBE_FAILED');
    }
  }
  const verdict = failures.length ? 'GATEWAY_AUTH_CERTIFICATION_FAILED' : 'GATEWAY_AUTH_CERTIFIED';
  writeEvidence(ctx, `ga-07-certify-${ctx.stamp}.json`, { ...base(ctx, mode, o), read_only: true, verdict,
    foundation: { pin_sha256: G.FOUNDATION_FILES['backend/torneos/infra/torneos-foundation/pins/expected-catalog.json'], non_delta_strict_paths: NON_DELTA_STRICT.length, diff: o.foundation_diff },
    delta: { pin_sha256: G.sha256(fs.readFileSync(ctx.deps.deltaPinFile ?? G.DELTA_PIN_FILE)), paths: G.DELTA_PATHS, diff: deltaDiff },
    invariants: o.invariants, roles: o.torneos.roles, auth: o.torneos.auth, third_party_auth: o.torneos.tpa, jwks_pin: o.custody.jwks_pin,
    edge_functions: { count: o.torneos.functions.length }, secret_names: o.torneos.secrets, postgrest_config: o.torneos.postgrest, migrations_ledger_api: o.torneos.ledger,
    postgrest_probe: postgrestProbe, bridge_probe: bridge, gateway: 'NOT_DEPLOYED (external gateway: later remote phase)', failures,
    management_api_writes: client.writes, requests: client.requests });
  if (failures.length) stop(verdict, { failures });
  return { verdict };
}

// ─────────────────────────── entry ───────────────────────────
export async function runGatewayAuth({ mode, request, deps }) {
  if (!MODES[mode]) throw new StopError('USAGE', { modes: Object.keys(MODES) });
  if (!request || typeof request !== 'object' || Object.keys(request).join(',') !== 'pat') throw new StopError('REQUEST_REFUSED', { expected: '{"pat":…} only' });
  if (!G.PAT_PATTERN.test(request.pat)) throw new StopError('PAT_MALFORMED');
  let armed = null;
  const ctx = { deps, known: [request.pat], evidence: [], say: deps.say, stamp: stampOf(new Date(deps.now())) };
  let pins = null;
  const client = makeClient({ transport: deps.transport, pat: request.pat, mode, armedFor: () => armed, jwksPin: () => pins?.jwks ?? null, known: ctx.known });
  ctx.client = client;
  ctx.arm = (w) => { if (w !== null && G.MODE_WRITES[mode] !== w) throw new StopError('ARMING_REFUSED', { mode, w }); armed = w; };
  try {
    pins = loadPins(ctx);
    if (mode === '--preflight') return await runPreflight(ctx, client, pins);
    if (mode === '--auth-lockdown') return await runAuthLockdown(ctx, client, pins);
    if (mode === '--db-bootstrap') return await runDbBootstrap(ctx, client, pins);
    if (mode === '--keyring-generate') return await runKeyringGenerate(ctx, client, pins);
    if (mode === '--b03') return await runB03(ctx, client, pins);
    if (mode === '--deploy-preflight') return await runDeployPreflight(ctx, client, pins);
    return await runCertify(ctx, client, pins);
  } catch (e) {
    if (e instanceof StopError) throw e;
    if (e instanceof ApiError) throw new StopError(e.code, e.detail);
    throw new StopError('UNEXPECTED_ERROR', { error: String(e?.message ?? e).slice(0, 200) });
  } finally {
    armed = null;
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

/** Validates an env document with the REAL gateway config.ts + boot() (recording DB stub: nothing connects). */
export async function validateGatewayEnvWithRealConfig(env) {
  const { loadGatewayTree } = await import('./gateway-loader.mjs');
  const tree = await loadGatewayTree();
  try {
    const idx = await tree.import('torneos-gateway/index.ts');
    const rt = idx.boot(env);
    return { topology: rt.cfg.topology, commerce: rt.commerce.mode, activeKid: rt.cfg.bridge.activeKid, trustedKids: rt.cfg.bridge.trustedKids, allowedOrigin: rt.cfg.allowedOrigin };
  } finally { await tree.cleanup(); }
}

async function main() {
  const mode = process.argv[2];
  if (process.argv.length !== 3 || !MODES[mode]) { process.stderr.write(`GATEWAY_AUTH_USAGE: one of ${Object.keys(MODES).join(' | ')}\n`); process.exit(2); }
  const stdin = await new Promise((resolve) => { const c = []; process.stdin.on('data', (x) => c.push(x)); process.stdin.on('end', () => resolve(Buffer.concat(c).toString('utf8'))); });
  let request; try { request = JSON.parse(stdin); } catch { process.stderr.write('GATEWAY_AUTH_STDIN_NOT_JSON\n'); process.exit(2); }
  const say = (s) => process.stdout.write(`${s}\n`);
  const deps = {
    transport: httpsTransport, probeTransport: httpsProbeTransport, authProbeTransport: httpsAuthProbeTransport, keychain: systemKeychain(), tty: systemTty(), applySql, psqlPrerequisites: () => assertPsqlPrerequisites(),
    validateGatewayEnv: validateGatewayEnvWithRealConfig, now: () => Date.now(), sleep: (ms) => new Promise((r) => setTimeout(r, ms)), evidenceDir: EVIDENCE_DIR, say,
  };
  try {
    const r = await runGatewayAuth({ mode, request, deps });
    request.pat = '';
    say(`\nRESULT ${r.verdict}${r.next ? ` next=${r.next}` : ''}`);
    process.exit(0);
  } catch (e) {
    request.pat = '';
    const detail = e?.detail ? JSON.stringify(e.detail).slice(0, 1500) : '';
    say(`\nSTOP ${e?.code ?? 'ERROR'} ${G.secretFindings(detail).length ? '(detail withheld: secret-shaped)' : detail}`);
    process.exit(1);
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
