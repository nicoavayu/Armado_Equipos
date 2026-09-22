#!/usr/bin/env node
// OFFLINE tests for the Phase 3B remote inventory harness. No socket is opened: the
// transport is injected. Run: node --test backend/torneos/phase3b/remote/inventory.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  PROD_REF, PROBES, WRITE_VERBS, AUTH_CONFIG_KEYS, AbortError,
  assertNoProduction, assertNonProductionRef, assertReadOnlySql, assertRequestEnvelope,
  projectProject, projectFunction, projectApiKey, projectAuthConfig, projectRolconfig, projectOrganization,
  redact, registerSecret, run,
} from './mgmt.mjs';
import { PROJECT_NAME_PATTERN, assertProjectName, createProjectBody, opCreateProject, run as runWrite } from './mgmt-write.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MGMT_SRC = fs.readFileSync(path.join(HERE, 'mgmt.mjs'), 'utf8');
const SHELL_SRC = fs.readFileSync(path.join(HERE, 'inventory.sh'), 'utf8');
const R2_SRC = fs.readFileSync(path.join(HERE, 'create-torneos-project.sh'), 'utf8');
const ORG = 'gwqrborhnqjdzzmpxulh';
const R2_NAME = 'arma2-torneos-isolated-staging';
const PAT = 'sbp_0123456789abcdef0123456789abcdef01234567';
const STAGING = 'hhyvmhgpapyuzjgxfnqv';

const throwsAbort = (fn, code) => assert.throws(fn, (e) => e instanceof AbortError && e.message.includes(code));

test('Production denylist: ref, path, body, token', () => {
  throwsAbort(() => assertNonProductionRef(PROD_REF), 'ref_is_production');
  throwsAbort(() => assertNonProductionRef('short'), 'ref_malformed');
  throwsAbort(() => assertNoProduction('path', `/v1/projects/${PROD_REF}/functions`), 'production_ref_in_path');
  throwsAbort(() => assertRequestEnvelope({ method: 'GET', path: `/v1/projects/${PROD_REF}` }), 'production_ref_in_path');
  throwsAbort(() => assertRequestEnvelope({ method: 'POST', path: `/v1/projects/${STAGING}/database/query`,
    body: { query: `select '${PROD_REF}'`, read_only: true } }), 'production_ref_in_body');
  assert.equal(assertNonProductionRef(STAGING), STAGING);
});

test('envelope: only GET and read-only POST /database/query', () => {
  throwsAbort(() => assertRequestEnvelope({ method: 'DELETE', path: '/v1/projects/x' }), 'method_not_allowed');
  throwsAbort(() => assertRequestEnvelope({ method: 'PATCH', path: '/v1/projects/x' }), 'method_not_allowed');
  throwsAbort(() => assertRequestEnvelope({ method: 'POST', path: `/v1/projects/${STAGING}/secrets`, body: [{ name: 'X', value: 'y' }] }), 'post_only_database_query');
  throwsAbort(() => assertRequestEnvelope({ method: 'POST', path: `/v1/projects/${STAGING}/database/query`, body: { query: 'select 1' } }), 'post_requires_read_only');
  throwsAbort(() => assertRequestEnvelope({ method: 'POST', path: `/v1/projects/${STAGING}/database/query`, body: { query: 'select 1', read_only: false } }), 'post_requires_read_only');
  throwsAbort(() => assertRequestEnvelope({ method: 'GET', path: '/projects' }), 'path_not_v1');
  assert.equal(assertRequestEnvelope({ method: 'GET', path: `/v1/projects/${STAGING}/functions` }), null);
});

test('SQL guard: every probe is a single read; writes are refused even inside CTEs', () => {
  for (const sql of Object.values(PROBES)) assert.equal(assertReadOnlySql(sql), sql);
  for (const bad of ['select 1; select 2', 'delete from x', 'with w as (update t set a=1 returning 1) select 1',
    'alter role authenticator password \'x\'', 'select 1 from t for update', 'create table t()', 'call f()', 'do $$ begin end $$',
    'select pg_sleep(1) union all select 1 -- ; drop', 'insert into t values (1)', 'set role postgres', 'copy t to stdout',
    'security label on x is y', 'refresh materialized view m', 'grant all on t to anon', 'revoke all on t from anon'])
    assert.throws(() => assertReadOnlySql(bad), AbortError, bad);
  // The privilege name 'EXECUTE' inside a literal is data, not a verb.
  assert.equal(assertReadOnlySql("select has_function_privilege('anon', 1, 'EXECUTE')"), "select has_function_privilege('anon', 1, 'EXECUTE')");
  assert.match(WRITE_VERBS.source, /truncate/);
});

test('mgmt.mjs source has no write method and no CLI/link usage', () => {
  assert.doesNotMatch(MGMT_SRC, /method:\s*'(PUT|PATCH|DELETE)'/);
  const code = MGMT_SRC.split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
  assert.doesNotMatch(code, /supabase\s+(db|link|functions|secrets)|--linked|\.temp\/project-ref/);
  assert.doesNotMatch(MGMT_SRC, /child_process|execSync|spawn/);
  assert.doesNotMatch(MGMT_SRC, /api_key\b(?!,? never)/);
  assert.match(MGMT_SRC, /read_only:\s*true/);
  assert.match(MGMT_SRC, /rejectUnauthorized:\s*true/);
  assert.match(MGMT_SRC, /minVersion:\s*'TLSv1\.2'/);
  assert.match(MGMT_SRC, /redirect_refused_status/);
});

test('projections drop every sensitive field', () => {
  assert.deepEqual(projectApiKey({ id: 'k', name: 'anon', type: 'legacy', api_key: 'eyJ.secret.x', hash: 'h' }),
    { id: 'k', name: 'anon', type: 'legacy', description: null });
  const fn = projectFunction({ slug: 's', status: 'ACTIVE', version: 3, verify_jwt: false, updated_at: 1, ezbr_sha256: 'e', import_map: 'x', entrypoint_path: 'index.ts' });
  assert.equal(fn.verify_jwt, false, 'false must survive (jq // gotcha)');
  assert.equal('import_map' in fn, false);
  const auth = projectAuthConfig({ site_url: 'https://x', smtp_pass: 'P', external_google_secret: 'S', hook_send_sms_secrets: 'H', disable_signup: true, jwt_exp: 3600 });
  assert.deepEqual(Object.keys(auth).sort(), ['disable_signup', 'jwt_exp', 'site_url']);
  for (const key of AUTH_CONFIG_KEYS) assert.doesNotMatch(key, /secret|password|_pass\b|private|_key$|_token$|_url_[a-z]+_secret/i, key);
  const rol = projectRolconfig([{ rolname: 'authenticator', rolconfig: ['pgrst.db_pre_request=private.check_token', 'statement_timeout=8s', 'pgrst.jwt_secret=abc', 'app.custom=zzz'] }]);
  assert.deepEqual(rol[0].rolconfig, ['pgrst.db_pre_request=private.check_token', 'statement_timeout=8s', '<omitted:pgrst.jwt_secret>', '<omitted:app.custom>']);
  const p = projectProject({ id: PROD_REF, name: 'arma2', database: { host: 'db.x', version: '17', postgres_engine: '17', release_channel: 'ga' } });
  assert.equal(p.classification, 'PRODUCTION (denylisted)');
  assert.equal('host' in p.database, false);
  assert.equal(projectProject({ id: STAGING }).classification, 'NON_PRODUCTION');
});

test('redaction: the PAT never reaches output', () => {
  registerSecret(PAT);
  assert.equal(redact(`Bearer ${PAT} done`), 'Bearer «REDACTED» done');
});

function fakeTransport(log, responses) {
  return async (req) => {
    assert.equal('pat' in req, true);
    log.push({ method: req.method, path: req.path, body: req.body });
    const key = `${req.method} ${req.path.split('?')[0]}`;
    const r = responses[key] ?? (req.method === 'POST' ? responses.POST_DEFAULT : undefined);
    if (!r) return { status: 404, body: null };
    return typeof r === 'function' ? r(req) : r;
  };
}

test('op projects: classifies Production out of the target set without targeting it', async () => {
  const log = [];
  const t = fakeTransport(log, { 'GET /v1/projects': { status: 200, body: [
    { id: PROD_REF, name: 'arma2', region: 'us-east-1', status: 'ACTIVE_HEALTHY', organization_id: 'o' },
    { id: STAGING, name: 'arma2-staging', region: 'us-east-1', status: 'ACTIVE_HEALTHY', organization_id: 'o' }] } });
  const out = await run({ op: 'projects', pat: PAT }, t);
  assert.equal(out.production_present, true);
  assert.deepEqual(out.non_production_refs, [STAGING]);
  assert.equal(log.length, 1);
  assert.equal(log[0].path, '/v1/projects');
});

test('op project-inventory: read-only GETs + read-only SQL, per-probe error isolation, refuses Production', async () => {
  const log = [];
  const t = fakeTransport(log, {
    [`GET /v1/projects/${STAGING}`]: { status: 200, body: { id: STAGING, name: 'arma2-staging', region: 'us-east-1', status: 'ACTIVE_HEALTHY' } },
    [`GET /v1/projects/${STAGING}/functions`]: { status: 200, body: [{ slug: 'tournament-media-signer', status: 'ACTIVE', verify_jwt: true, version: 1 }] },
    [`GET /v1/projects/${STAGING}/secrets`]: { status: 200, body: [{ name: 'TOURNAMENT_MEDIA_ATTESTATION_SECRET', value: 'SECRETVALUE123' }] },
    [`GET /v1/projects/${STAGING}/api-keys`]: { status: 200, body: [{ id: '1', name: 'anon', type: 'legacy', api_key: 'eyJANONKEY' }, { id: '2', name: 'service_role', type: 'legacy', api_key: 'eyJSERVICEKEY' }] },
    [`GET /v1/projects/${STAGING}/postgrest`]: { status: 200, body: { db_schema: 'public, graphql_public', max_rows: 1000, jwt_secret: 'nope' } },
    [`GET /v1/projects/${STAGING}/config/auth`]: { status: 200, body: { site_url: 'https://s', smtp_pass: 'SMTPSECRET', jwt_exp: 3600 } },
    POST_DEFAULT: (req) => {
      if (req.body.query === PROBES.cron_jobs) return { status: 400, body: { message: 'relation "cron.job" does not exist' } };
      if (req.body.query === PROBES.migrations) return { status: 200, body: [{ version: '20260727090000', name: 'arma2_canonical_baseline' }] };
      return { status: 200, body: [{ ok: 1 }] };
    },
  });
  const out = await run({ op: 'project-inventory', pat: PAT, ref: STAGING }, t);
  const text = JSON.stringify(out);
  assert.doesNotMatch(text, /SECRETVALUE123|eyJANONKEY|eyJSERVICEKEY|SMTPSECRET|nope/);
  assert.deepEqual(out.control_plane.secret_names, ['TOURNAMENT_MEDIA_ATTESTATION_SECRET']);
  assert.equal(out.control_plane.api_keys[1].name, 'service_role');
  assert.equal(out.database.cron_jobs.error, 'status_400');
  assert.equal(out.database.migrations[0].version, '20260727090000');
  assert.equal(log.filter((l) => l.method === 'POST').length, Object.keys(PROBES).length);
  for (const l of log) {
    assert.match(l.path, new RegExp(`^/v1/projects/${STAGING}(/|$)`));
    if (l.method === 'POST') { assert.equal(l.body.read_only, true); assertReadOnlySql(l.body.query); }
  }
  await assert.rejects(run({ op: 'project-inventory', pat: PAT, ref: PROD_REF }, t), (e) => e.message.includes('ref_is_production'));
  await assert.rejects(run({ op: 'project-inventory', pat: PAT, ref: 'nope' }, t), (e) => e.message.includes('ref_malformed'));
});

test('run: PAT validation and unknown ops fail closed before any transport call', async () => {
  const calls = [];
  const t = async () => { calls.push(1); return { status: 200, body: [] }; };
  await assert.rejects(run({ op: 'projects', pat: 'not-a-pat' }, t), /missing_or_malformed_pat/);
  await assert.rejects(run({ op: 'projects' }, t), /missing_or_malformed_pat/);
  await assert.rejects(run({ op: 'delete-project', pat: PAT }, t), /unknown_op/);
  await assert.rejects(run({ op: 'projects', pat: `sbp_${PROD_REF}${PROD_REF}` }, t), /production_ref_in_token/);
  assert.equal(calls.length, 0);
});

test('CLI: stdin contract, PAT redacted from the failure line, no network for a bad PAT', () => {
  const r = spawnSync(process.execPath, [path.join(HERE, 'mgmt.mjs')], { input: JSON.stringify({ op: 'projects', pat: 'sbp_bad' }), encoding: 'utf8', timeout: 10000 });
  assert.equal(r.status, 1);
  assert.match(r.stdout, /missing_or_malformed_pat/);
  const r2 = spawnSync(process.execPath, [path.join(HERE, 'mgmt.mjs')], { input: 'not json', encoding: 'utf8', timeout: 10000 });
  assert.match(r2.stdout, /stdin_not_json/);
});

test('inventory.sh: credential contract (tty, builtin printf pipe, no argv/env/file, unset on exit)', () => {
  assert.match(SHELL_SRC, /IFS= read -rs PAT < \/dev\/tty/);
  assert.match(SHELL_SRC, /printf '\{"op":"%s","pat":"%s"\}' "\$1" "\$PAT" \| node/);
  assert.match(SHELL_SRC, /trap 'unset PAT; PAT=""/);
  assert.doesNotMatch(SHELL_SRC, /export PAT|SUPABASE_ACCESS_TOKEN|<<<|--linked|supabase (db|link)|curl /);
  assert.doesNotMatch(SHELL_SRC, /grep[^\n]*\$PAT/, 'the PAT must not be an argv of any external command');
  assert.match(SHELL_SRC, /PHASE3B_INVENTORY_BLOCKED_NO_TTY/);
  assert.match(SHELL_SRC, /PRODUCTION_REF_REFUSED/);
  assert.match(SHELL_SRC, /EVIDENCE_REJECTED_SECRET_LEAK/);
  const r = spawnSync('bash', ['-n', path.join(HERE, 'inventory.sh')], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
});

test('inventory.sh: without a TTY it stops before reading anything', () => {
  const r = spawnSync('bash', [path.join(HERE, 'inventory.sh')], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 10000 });
  if (r.status === 2) assert.match(r.stderr, /PHASE3B_INVENTORY_BLOCKED_NO_TTY/);
  else assert.notEqual(r.status, 0, 'a TTY-less run must never succeed');
});

// ───────────────────────── R2 (create Torneos non-prod project) ─────────────────────────

test('op org: one read-only GET, plan projected, billing/members never emitted, fails closed without a plan', async () => {
  const log = [];
  const t = fakeTransport(log, { [`GET /v1/organizations/${ORG}`]: { status: 200, body: { id: ORG, slug: ORG, name: "nicoavayu's Org", plan: 'pro',
    opt_in_tags: [], allowed_release_channels: ['ga'], billing_email: 'x@y', members: [{ email: 'a@b' }], payment_method: 'visa-4242' } } });
  const out = await run({ op: 'org', pat: PAT, slug: ORG }, t);
  assert.deepEqual(out.organization, { id: ORG, slug: ORG, name: "nicoavayu's Org", plan: 'pro', allowed_release_channels: ['ga'] });
  assert.doesNotMatch(JSON.stringify(out), /x@y|a@b|visa|billing|members/);
  assert.deepEqual(log.map((l) => `${l.method} ${l.path}`), [`GET /v1/organizations/${ORG}`]);
  await assert.rejects(run({ op: 'org', pat: PAT, slug: '../v1/projects' }, t), /org_slug_malformed/);
  await assert.rejects(run({ op: 'org', pat: PAT, slug: PROD_REF }, t), /production_ref_in_org/);
  const t2 = fakeTransport([], { [`GET /v1/organizations/${ORG}`]: { status: 200, body: { id: ORG, name: 'o', plan: 'gold' } } });
  await assert.rejects(run({ op: 'org', pat: PAT, slug: ORG }, t2), /organization_plan_unreadable/);
  assert.equal(projectOrganization({ slug: ORG, name: 'o', plan: 'free' }).id, ORG);
});

test('projections follow the current Management API: ref/organization_slug preferred, id kept for consumers', () => {
  const p = projectProject({ ref: STAGING, organization_slug: ORG, name: 'arma2-torneos-staging', region: 'us-east-1', status: 'ACTIVE_HEALTHY' });
  assert.equal(p.id, STAGING); assert.equal(p.organization_id, ORG); assert.equal(p.organization_slug, ORG); assert.equal(p.classification, 'NON_PRODUCTION');
  assert.equal(projectProject({ ref: PROD_REF, id: PROD_REF, name: 'p' }).classification, 'PRODUCTION (denylisted)');
  assert.equal(projectProject({ id: STAGING, organization_id: ORG }).organization_slug, ORG, 'legacy shape still projects');
});

test('R2 project name: non-production label mandatory, production labels refused, duplicates refused, preflight list mandatory', () => {
  for (const good of [R2_NAME, 'arma2-torneos-staging', 'arma2-torneos-nonprod', 'arma2-torneos-preprod-2', `${R2_NAME}-r2`]) assert.equal(assertProjectName(good, []), good);
  for (const [bad, code] of [['arma2-torneos', 'must_mark'], ['arma2-torneos-prod', 'must_mark'], ['arma2-torneos-stagingx', 'must_mark'], ['arma2-torneos-isolated', 'must_mark'],
    ['Arma2-torneos-staging', 'must_mark'], ['arma2-torneos--staging', 'must_mark'], ['arma2-torneos-production-staging', 'production_label'], ['arma2-torneos-staging-live', 'production_label']])
    throwsAbort(() => assertProjectName(bad, []), code);
  throwsAbort(() => assertProjectName('arma2-torneos-staging', ['arma2-torneos-staging', "nicoavayu's Project"]), 'project_name_already_exists');
  throwsAbort(() => assertProjectName(R2_NAME), 'existing_names_required');
  throwsAbort(() => assertProjectName(R2_NAME, 'arma2-torneos-staging'), 'existing_names_required');
  assert.equal(PROJECT_NAME_PATTERN.test(R2_NAME), true);
});

test('R2 create body: organization_slug + region_selection (OpenAPI 2026-09-15), no deprecated organization_id/region/plan, smallest size by default', () => {
  const body = createProjectBody({ organization_slug: ORG, name: R2_NAME, region: 'us-east-1', db_pass: 'p'.repeat(40) });
  assert.deepEqual(body, { organization_slug: ORG, name: R2_NAME, region_selection: { type: 'specific', code: 'us-east-1' }, db_pass: 'p'.repeat(40) });
  assert.equal('organization_id' in body || 'region' in body || 'plan' in body || 'desired_instance_size' in body, false);
  assert.deepEqual(createProjectBody({ organization_slug: ORG, name: R2_NAME, region: 'us-east-1', db_pass: 'p', desired_instance_size: 'micro' }).desired_instance_size, 'micro');
  throwsAbort(() => createProjectBody({ organization_slug: ORG, name: R2_NAME, region: 'us-east-1', db_pass: 'p', desired_instance_size: 'large' }), 'instance_size_not_allowed');
});

test('R2 create op: exactly one POST /v1/projects, db_pass redacted, Production/foreign ref or name mismatch in the response is refused', async () => {
  const db_pass = 'Q'.repeat(40);
  const created = 'abcdefghijabcdefghij';
  const log = [];
  const transport = async (req) => { log.push(req); return { status: 201, body: { id: created, ref: created, organization_slug: ORG, name: R2_NAME, region: 'us-east-1', status: 'COMING_UP', created_at: 'now' } }; };
  const out = await runWrite({ op: 'create-project', pat: PAT, organization_slug: ORG, name: R2_NAME, region: 'us-east-1', db_pass, existing_names: ['arma2-torneos-staging', "nicoavayu's Project", 'Arma2'] }, transport);
  assert.equal(out.project.id, created); assert.equal(out.project.classification, 'NON_PRODUCTION');
  assert.equal(log.length, 1); assert.equal(log[0].method, 'POST'); assert.equal(log[0].reqPath, '/v1/projects');
  assert.deepEqual(Object.keys(log[0].body).sort(), ['db_pass', 'name', 'organization_slug', 'region_selection']);
  assert.equal(redact(`x${db_pass}y`), 'x«REDACTED»y');
  const prodBack = async () => ({ status: 201, body: { ref: PROD_REF, name: R2_NAME } });
  await assert.rejects(opCreateProject(prodBack, PAT, { organization_slug: ORG, name: R2_NAME, region: 'us-east-1', db_pass, existing_names: [] }), /unexpected_ref/);
  const otherName = async () => ({ status: 201, body: { ref: created, name: 'arma2-torneos-staging' } });
  await assert.rejects(opCreateProject(otherName, PAT, { organization_slug: ORG, name: R2_NAME, region: 'us-east-1', db_pass, existing_names: [] }), /unexpected_name/);
  await assert.rejects(runWrite({ op: 'create-project', pat: PAT, organization_slug: ORG, name: R2_NAME, region: 'ap-south-1', db_pass, existing_names: [] }, transport), /region_not_allowed/);
  await assert.rejects(runWrite({ op: 'create-project', pat: PAT, organization_slug: ORG, name: 'arma2-torneos-staging', region: 'us-east-1', db_pass, existing_names: ['arma2-torneos-staging'] }, transport), /already_exists/);
  await assert.rejects(runWrite({ op: 'create-project', pat: PAT, organization_slug: `${PROD_REF}`, name: R2_NAME, region: 'us-east-1', db_pass, existing_names: [] }, transport), /production_ref_in_org/);
});

test('R2 runner contract: read-only preflight, plan/cost shown, --plan-only stops, human phrase gates the only write, evidence prefixes', () => {
  const r = spawnSync('bash', ['-n', path.join(HERE, 'create-torneos-project.sh')], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.match(R2_SRC, /NAME="\$\{3:-arma2-torneos-isolated-staging\}"/);
  assert.match(R2_SRC, /\[\[ "\$REGION" == "us-east-1" \]\] \|\| abort/);
  const preflight = R2_SRC.indexOf('step "preflight (read-only)');
  const planOnlyStop = R2_SRC.indexOf('PHASE3B_R2_PLAN_ONLY_STOP');
  const human = R2_SRC.indexOf('step "HUMAN AUTHORIZATION"');
  const write = R2_SRC.indexOf('mgmt_write create-project');
  assert.ok(preflight > 0 && planOnlyStop > preflight && human > planOnlyStop && write > human, 'order: preflight → plan-only stop → human phrase → single write');
  assert.equal((R2_SRC.match(/mgmt_write /g) || []).length, 1, 'create-project is the only write');
  assert.match(R2_SRC.slice(human, write), /IFS= read -r CONFIRM < \/dev\/tty/);
  assert.match(R2_SRC.slice(human, write), /\[\[ "\$CONFIRM" == "CREATE \$NAME" \]\] \|\| abort "PHASE3B_R2_NOT_AUTHORIZED/);
  for (const shown of ['expected cost', 'PAT requirement', 'Administrator (or Owner)', 'organization      :', 'region            :', 'Production        :', 'production_present', 'name_taken', 'active_in_org'])
    assert.ok(R2_SRC.includes(shown), shown);
  assert.match(R2_SRC, /r2-preflight-\$STAMP\.json/);
  assert.ok(R2_SRC.indexOf('r2-preflight-$STAMP.json') < write, 'preflight evidence is written before any write');
  assert.ok(R2_SRC.indexOf('project-create-$STAMP.json') > write, 'project-create evidence only after the write');
  assert.match(R2_SRC, /\\"existing_names\\":\$EXISTING_NAMES/, 'the duplicate-name preflight list reaches mgmt-write');
  assert.match(R2_SRC, /\\"organization_slug\\":\\"\$ORG_SLUG\\"/);
  assert.doesNotMatch(R2_SRC, /desired_instance_size":\s*"(nano|micro|small)/);
  assert.doesNotMatch(R2_SRC, /export PAT|SUPABASE_ACCESS_TOKEN|<<<|--linked|supabase (db|link)|curl /);
});

test('R2 runner: without a TTY it stops before reading anything (no PAT, no network)', () => {
  const r = spawnSync('bash', [path.join(HERE, 'create-torneos-project.sh'), '--plan-only', ORG], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 10000 });
  if (r.status === 1) assert.match(r.stderr, /PHASE3B_BLOCKED_NO_TTY|Keychain/);
  else assert.notEqual(r.status, 0, 'a TTY-less run must never succeed');
});

// ───────────────────────── R3 bootstrap runner ↔ shared verification contract (Phase 3B R2-local) ─────────────────────────

test('bootstrap-torneos.sh: verification SQL and expectations come from phase3b/contracts (V2), pinned at runtime, rendered bytes match the pin', () => {
  const src = fs.readFileSync(path.join(HERE, 'bootstrap-torneos.sh'), 'utf8');
  assert.equal(spawnSync('bash', ['-n', path.join(HERE, 'bootstrap-torneos.sh')], { encoding: 'utf8' }).status, 0);
  const contracts = path.join(HERE, '../contracts');
  const template = fs.readFileSync(path.join(contracts, 'torneos-bootstrap-verify.sql'), 'utf8').replace(/\s+$/, '');
  const gate = JSON.parse(fs.readFileSync(path.join(HERE, '../../phase2d/staging-v1-rpc-gate.json'), 'utf8'));
  const names = [...new Set(gate.functions.map((f) => f.name))];
  assert.equal(names.length, 33);
  const rendered = template.split('__GATED_NAMES__').join(names.map((x) => `'${x}'`).join(','));
  const pinned = src.match(/^CERTIFIED_VERIFY_SQL="([0-9a-f]{64})"$/m)?.[1];
  const pinnedExpect = src.match(/^CERTIFIED_EXPECT="([0-9a-f]{64})"$/m)?.[1];
  const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
  assert.equal(sha(rendered), pinned, 'rendered shared SQL ≠ the hash the runner pins');
  assert.equal(pinned, '0d6ef458d0d46375d8332c6a85e014597a7d30f0d4891d1b62e12df88c9c844c', 'the pin is contract v2 (lazy optional-relation probes)');
  assert.equal(sha(fs.readFileSync(path.join(contracts, 'torneos-bootstrap-expect.json'))), pinnedExpect);
  assert.equal(Object.keys(JSON.parse(fs.readFileSync(path.join(contracts, 'torneos-bootstrap-expect.json'), 'utf8'))).length, 16);
  assert.doesNotMatch(src, /VERIFY_SQL="select json_build_object/, 'no inline copy of the SQL');
  assert.doesNotMatch(src, /^expect [a-z_]+ /m, 'no inline expectations');
  assert.match(src, /\[\[ "\$EXPECT_COUNT" == 16 \]\] \|\| abort/);
  assert.ok(src.indexOf('CERTIFIED_VERIFY_SQL" ]] || abort') < src.indexOf('read_pat'), 'pins verified before the PAT is read');
  assert.doesNotMatch(src, /export PAT|SUPABASE_ACCESS_TOKEN|<<<|--linked|supabase (db|link)|curl /);
});
