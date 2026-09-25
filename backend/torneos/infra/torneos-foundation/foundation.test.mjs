// INFRA-1 R3 — offline tests of the foundation tooling. No network, no Keychain, no psql: every
// dependency is an in-memory fake. Run: node --test backend/torneos/infra/torneos-foundation/foundation.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import * as F from './foundation-contract.mjs';
import { runFoundation, StopError, MODES, orgSlots, stagingFailures } from './foundation.mjs';
import { psqlEnv } from './psql-foundation.mjs';
import { makeClient } from './mgmt-foundation.mjs';
import { assertProbeTarget, probePostgrest, forgeTokens } from './postgrest-probe.mjs';
import { assertNamespace } from './keychain-foundation.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PAT = 'sbp_' + 'a1'.repeat(20);
const NEW_REF = 'qwertyuiopasdfghjklz';
const DB_PASS = 'Zx9_' + 'k'.repeat(36);
const PUB_KEY = 'sb_publishable_' + 'P'.repeat(30);
const SERVICE_JWT = 'eyJhbGciOiJIUzI1NiJ9.' + Buffer.from(JSON.stringify({ role: 'service_role' })).toString('base64url') + '.c2lnbmF0dXJlc2lnbmF0dXJl';

// ───────────────────────── catalog fixture (passes every invariant) ─────────────────────────
function goodCatalog() {
  return {
    server_version: '17.6', roles: ['torneos_core_adapter', 'torneos_identity_writer', 'torneos_payment_service'].map((name) => ({ name, login: false, inherit: false, super: false, bypassrls: false, createrole: false, createdb: false })),
    role_members: [{ role: 'torneos_payment_service', member: 'postgres' }], login_roles_torneos: 0,
    tables: { public_tables: 105, public_views: 0, private_tables: 2, sequences: 7, public_tables_without_rls: [], public_tables_forced_rls: 1, names_md5: 'n', owners: { postgres: 114 } },
    policies: { count: 64, md5: 'p' },
    functions: { public: 366, private: 7, procedures: 0, aggregates: 0, definer: 312, signatures_md5: 's', bodies_md5: 'b', owners: { postgres: 373 }, public_acl_default: 0, public_execute_by_public_role: 0 },
    execute: { torneos_payment_service: { count: 4, md5: 'x' }, anon: { count: 14, md5: 'a' } },
    execute_payment_service: [...F.PAYMENT_SERVICE_EXECUTE], execute_anon: ['get_public_tournament_page(text,text)'],
    table_privileges: { anon: { count: 78, md5: 't' } }, anon_table_privileges: ['tournament_competition_formats:SELECT'],
    watermark: { exists: true, rls: true, api_privileges: 0, requires_manual_review: 1, date_last_updated: 1 },
    provider_ordering: { order_verified: true, apply_status_ordered: true, apply_reversal_ordered: true, apply_status_unordered_absent: true, apply_reversal_unordered_absent: true, unordered_wrapped: true },
    audit: { purchase_events_append_only: 1, grant_events_append_only: 1 },
    identity: { current_identity_id: true, check_token: true, bridge_issuer_pinned: 1 },
    authenticator_pre_request: [], extensions: [{ name: 'pgcrypto', schema: 'extensions' }], foreign_servers: 0, user_mappings: 0, migrations_ledger: false,
  };
}

// ───────────────────────── fake Management API ─────────────────────────
function world(over = {}) {
  const w = {
    plan: 'free', prod: 'ACTIVE_HEALTHY', prodEzbr: F.CORE_CONTRACT_EZBR, staging: 'ACTIVE_HEALTHY', old: 'INACTIVE',
    torneos: null, torneosStatusSeq: ['COMING_UP', 'COMING_UP', 'ACTIVE_HEALTHY'], stagingPauseSeq: ['PAUSING', 'INACTIVE'],
    regions: { all: { smartGroup: [], specific: [{ code: 'sa-east-1', name: 'São Paulo', type: 'specific', provider: 'AWS' }] }, recommendations: { smartGroup: { code: 'americas' }, specific: [] } },
    activity: { cron_available: true, auth_activity: { sessions_touched_60m: 0, sign_ins_60m: 0, last_sign_in_at: '2026-09-21T14:00:00Z' }, client_connections: [] },
    cron: [{ jobid: 1, jobname: 'auto', schedule: '*/5 * * * *', active: true, hosts: [], command_md5: 'm' }],
    extraProjects: [], torneosFunctions: [], empty: { public_relations: 0, public_functions: 0, private_schema: 0, torneos_roles: 0, pgcrypto_available: 1 },
    catalog: goodCatalog(), tpa: [], secrets: ['SUPABASE_ANON_KEY', 'SUPABASE_DB_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_URL'],
    authUsers: 0, dbMigrations: [], poolerHost: 'aws-0-sa-east-1.pooler.supabase.com', markers: true,
    requests: [], bodies: [], createBody: null,
    ...over,
  };
  const proj = (ref, name, status, region) => ({ ref, id: ref, name, organization_slug: F.ORG_SLUG, region, status, created_at: '2026-01-01T00:00:00Z', database: { version: '17.6.1.147' } });
  const projects = () => [
    proj(F.PROD_REF, "nicoavayu's Project", w.prod, 'sa-east-1'), proj(F.STAGING_REF, 'arma2-torneos-staging', w.staging, 'us-east-1'), proj(F.OLD_REF, 'Arma2', w.old, 'us-west-2'),
    ...(w.torneos ? [proj(w.torneos.ref, F.PROJECT_NAME, w.torneos.status, 'sa-east-1')] : []), ...w.extraProjects,
  ];
  w.transport = async ({ pat, method, path: p, body }) => {
    assert.equal(pat, PAT);
    const cls = F.classifyRequest({ method, path: p, body }, { armedFor: method === 'POST' && p.endsWith('/pause') ? 'pause' : method === 'POST' && p === '/v1/projects' ? 'create' : null, createdRef: w.torneos?.ref ?? NEW_REF });
    w.requests.push(`${method} ${p}`);
    if (body !== undefined) w.bodies.push(JSON.stringify(body));
    const r = (status, b) => ({ status, body: b, raw: JSON.stringify(b) });
    switch (cls.id) {
      case 'org': return r(200, { slug: F.ORG_SLUG, name: "nicoavayu's Org", plan: w.plan });
      case 'projects': return r(200, projects());
      case 'regions': return r(200, w.regions);
      case 'prod-project': return r(200, projects()[0]);
      case 'prod-contract-fn': return r(200, { slug: F.CORE_CONTRACT_SLUG, status: 'ACTIVE', version: 3, verify_jwt: false, ezbr_sha256: w.prodEzbr });
      case 'project': {
        if (cls.ref === F.STAGING_REF && w.pausing) { w.staging = w.stagingPauseSeq.shift() ?? 'INACTIVE'; if (w.staging === 'INACTIVE') w.pausing = false; }
        if (w.torneos && cls.ref === w.torneos.ref && w.torneosStatusSeq.length) w.torneos.status = w.torneosStatusSeq.shift();
        const row = projects().find((x) => x.ref === cls.ref); return row ? r(200, row) : r(404, { message: 'not found' });
      }
      case 'functions': return r(200, cls.ref === F.STAGING_REF ? [{ slug: 'push-sender', status: 'ACTIVE', version: 5 }] : w.torneosFunctions);
      case 'branches': return r(404, { message: 'branching not enabled' });
      case 'health': return r(200, ['auth', 'db', 'pooler', 'rest', 'db_postgres_user'].map((name) => ({ name, status: 'ACTIVE_HEALTHY', healthy: true })));
      case 'pooler': return r(200, [{ db_host: w.poolerHost, db_port: 5432, pool_mode: 'session', db_user: `postgres.${cls.ref}` }]);
      case 'third-party-auth': return r(200, w.tpa);
      case 'auth-config': return r(200, { site_url: 'http://localhost:3000', disable_signup: false, external_email_enabled: true, smtp_pass: 'never-leaves' });
      case 'postgrest': return r(200, { db_schema: 'public,graphql_public', max_rows: 1000, jwt_secret: 'never-leaves' });
      case 'api-keys': return r(200, [{ name: 'anon', type: 'legacy', api_key: 'eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoiYW5vbiJ9.c2lnbmF0dXJlc2ln' }, { name: 'service_role', type: 'legacy', api_key: SERVICE_JWT }, { name: 'default', type: 'publishable', api_key: PUB_KEY }, { name: 'default', type: 'secret', api_key: 'sb_secret_abcd••••' }]);
      case 'secrets': return r(200, w.secrets.map((name) => ({ name, value: 'digest' })));
      case 'db-migrations': return r(200, w.dbMigrations);
      case 'query': {
        const q = body.query;
        if (q === F.STAGING_PREPAUSE_SQL) return r(201, [{ json_build_object: w.activity }]);
        if (q === F.STAGING_CRON_SQL) return r(201, [{ jobs: w.cron }]);
        if (q === F.TORNEOS_EMPTY_SQL) return r(201, [{ json_build_object: w.empty }]);
        if (q === F.CATALOG_SQL) return r(201, [{ json_build_object: w.catalog }]);
        if (q.includes('auth.users')) return r(201, [{ n: w.authUsers }]);
        return r(201, [{ ok: w.markers }]);
      }
      case 'pause': w.pausing = true; return r(200, {});
      case 'create': w.createBody = body; w.torneos = { ref: NEW_REF, status: 'COMING_UP' }; return r(201, proj(NEW_REF, F.PROJECT_NAME, 'COMING_UP', 'sa-east-1'));
      default: throw new Error(`unhandled ${cls.id}`);
    }
  };
  return w;
}

function fakeKeychain(state = 'ABSENT') {
  const k = { state, generated: 0, reads: 0, namespace: { ...F.KEYCHAIN_DB } };
  k.check = () => k.state;
  k.generate = () => { if (k.state === 'PRESENT') throw new Error('KEYCHAIN_ENTRY_PRESENT_REFUSE_REGENERATE'); k.state = 'PRESENT'; k.generated++; return 'KEYCHAIN_GENERATED'; };
  k.read = () => { if (k.state !== 'PRESENT') throw new Error('keychain_read_failed_status_44'); k.reads++; return DB_PASS; };
  return k;
}
const okProbe = async ({ path: p, method, headers = {} }) => {
  if (headers.Authorization) return { status: 401, body: { code: 'PGRST301', message: 'JWSError' } };
  if (p === '/rest/v1/') return { status: 200, body: { paths: { '/': {}, '/tournament_competition_formats': {} } } };
  if (p.startsWith(`/rest/v1/${F.PROBE_ANON_READ_TABLE}`)) return { status: 200, body: [] };
  if (p.startsWith('/rest/v1/core_contract_attestations')) return { status: 406, body: { code: 'PGRST106', message: 'schema must be one of public' } };
  return { status: method === 'POST' ? 404 : 401, body: { code: '42501', message: 'permission denied' } };
};

function setup(over = {}, { keychain = fakeKeychain(), phrase = null, applyFile = null, probeTransport = okProbe, pinCatalog = goodCatalog() } = {}) {
  const w = world(over);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'infra1-r3-'));
  const pinFile = path.join(dir, 'expected-catalog.json');
  fs.writeFileSync(pinFile, JSON.stringify({ migrations: F.MIGRATIONS.map((m) => ({ seq: m.seq, sha256: m.sha256 })), catalog: pinCatalog }));
  let t = Date.parse('2026-09-25T00:00:00Z');
  const lines = [];
  const applied = [];
  const deps = {
    transport: w.transport, probeTransport, keychain, now: () => t, sleep: async (ms) => { t += ms; }, say: (s) => lines.push(s),
    tty: { readLine: () => (typeof phrase === 'function' ? phrase(lines) : phrase ?? '') },
    applyFile: applyFile ?? (async ({ file, env }) => { applied.push({ file: path.basename(file), env }); return { code: 0, elapsed_ms: 5 }; }),
    psqlPrerequisites: () => [], evidenceDir: path.join(dir, 'ev'), expectedCatalogFile: pinFile, pollIntervalMs: 1000,
  };
  return { w, deps, dir, lines, applied, keychain };
}
const planPhrase = (lines) => { const l = lines.join('\n'); const m = /To proceed type exactly:\n {2}(.+)\n/.exec(l); return m ? m[1] : 'nope'; };
const run = (mode, s) => runFoundation({ mode, request: { pat: PAT }, deps: s.deps });
const evidence = (s) => { const d = s.deps.evidenceDir; return fs.existsSync(d) ? fs.readdirSync(d).map((f) => ({ f, text: fs.readFileSync(path.join(d, f), 'utf8') })) : []; };
const noSecrets = (s) => { for (const { f, text } of evidence(s)) for (const secret of [PAT, DB_PASS, PUB_KEY, SERVICE_JWT, 'never-leaves']) assert.ok(!text.includes(secret), `${secret.slice(0, 8)} in ${f}`); };
const stopCode = async (p) => { try { await p; } catch (e) { assert.ok(e instanceof StopError, e.message); return e.code; } assert.fail('expected STOP'); };

// ───────────────────────── contract ─────────────────────────
test('allowlist: Production is reachable only by its two GETs', () => {
  assert.equal(F.classifyRequest({ method: 'GET', path: `/v1/projects/${F.PROD_REF}` }).id, 'prod-project');
  assert.equal(F.classifyRequest({ method: 'GET', path: `/v1/projects/${F.PROD_REF}/functions/torneos-core-contract` }).id, 'prod-contract-fn');
  for (const p of [`/v1/projects/${F.PROD_REF}/functions`, `/v1/projects/${F.PROD_REF}/secrets`, `/v1/projects/${F.PROD_REF}/config/auth`]) assert.throws(() => F.classifyRequest({ method: 'GET', path: p }));
  assert.throws(() => F.classifyRequest({ method: 'POST', path: `/v1/projects/${F.PROD_REF}/database/query`, body: { query: 'select 1', read_only: true } }), /production_only_two_gets/);
  assert.throws(() => F.classifyRequest({ method: 'POST', path: `/v1/projects/${F.PROD_REF}/pause` }, { armedFor: 'pause' }));
  assert.throws(() => F.classifyRequest({ method: 'POST', path: `/v1/projects/${NEW_REF}/database/query`, body: { query: `select '${F.PROD_REF}'`, read_only: true } }, { createdRef: NEW_REF }), /production_ref_in_body/);
});
test('allowlist: the pause exists only for Core Staging, only armed, without body', () => {
  assert.throws(() => F.classifyRequest({ method: 'POST', path: `/v1/projects/${F.STAGING_REF}/pause` }), /pause_not_armed/);
  assert.equal(F.classifyRequest({ method: 'POST', path: `/v1/projects/${F.STAGING_REF}/pause` }, { armedFor: 'pause' }).kind, 'write:pause');
  assert.throws(() => F.classifyRequest({ method: 'POST', path: `/v1/projects/${F.STAGING_REF}/pause` }, { armedFor: 'create' }), /pause_not_armed/);
  assert.throws(() => F.classifyRequest({ method: 'POST', path: `/v1/projects/${NEW_REF}/pause` }, { armedFor: 'pause', createdRef: NEW_REF }), /endpoint_not_allowlisted/);
  assert.throws(() => F.classifyRequest({ method: 'POST', path: `/v1/projects/${F.STAGING_REF}/pause`, body: {} }, { armedFor: 'pause' }), /pause_takes_no_body/);
  for (const p of [`/v1/projects/${F.STAGING_REF}/restore`, `/v1/projects/${F.STAGING_REF}`]) assert.throws(() => F.classifyRequest({ method: 'POST', path: p }, { armedFor: 'pause' }));
  for (const m of ['DELETE', 'PATCH', 'PUT']) assert.throws(() => F.classifyRequest({ method: m, path: `/v1/projects/${F.STAGING_REF}` }), /method_refused/);
});
test('allowlist: create only armed and only with the exact pinned body', () => {
  const body = F.createProjectBody(DB_PASS);
  assert.throws(() => F.classifyRequest({ method: 'POST', path: '/v1/projects', body }), /create_not_armed/);
  assert.equal(F.classifyRequest({ method: 'POST', path: '/v1/projects', body }, { armedFor: 'create' }).kind, 'write:create');
  for (const bad of [{ ...body, plan: 'pro' }, { ...body, desired_instance_size: 'micro' }, { ...body, name: 'Arma2 Torneos 2' }, { ...body, region_selection: { type: 'specific', code: 'us-east-1' } }, { ...body, region_selection: { type: 'smartGroup', code: 'americas' } }, { ...body, organization_slug: 'other' }, { ...body, db_pass: 'short' }, { ...body, template_url: 'x' }]) {
    assert.throws(() => F.classifyRequest({ method: 'POST', path: '/v1/projects', body: bad }, { armedFor: 'create' }));
  }
});
test('allowlist: SQL is read-only single statements; unknown refs/endpoints refused; old project GET only', () => {
  const q = (query, extra = {}) => F.classifyRequest({ method: 'POST', path: `/v1/projects/${F.STAGING_REF}/database/query`, body: { query, read_only: true, ...extra } });
  assert.equal(q('select 1').kind, 'read-sql');
  for (const bad of ['update x set a=1', 'select 1; drop table x', 'with a as (delete from t returning 1) select 1', 'grant all on x to anon', 'alter role authenticator set x = 1', 'select pg_notify(1)', "select set_config('role','service_role',false)", 'select pg_terminate_backend(1)', "select net.http_post('x')", 'select nextval(1)', 'begin']) assert.throws(() => q(bad));
  assert.throws(() => F.classifyRequest({ method: 'POST', path: `/v1/projects/${F.STAGING_REF}/database/query`, body: { query: 'select 1', read_only: false } }), /sql_must_be_read_only/);
  assert.throws(() => q('select 1', { parameters: [] }), /sql_must_be_read_only/);
  assert.throws(() => F.classifyRequest({ method: 'GET', path: '/v1/projects/abcdefghijabcdefghij' }), /ref_not_in_scope/);
  assert.equal(F.classifyRequest({ method: 'GET', path: '/v1/projects/abcdefghijabcdefghij' }, { createdRef: 'abcdefghijabcdefghij' }).id, 'project');
  assert.throws(() => F.classifyRequest({ method: 'GET', path: `/v1/projects/${F.OLD_REF}/functions` }), /old_project_get_only/);
  assert.throws(() => F.classifyRequest({ method: 'GET', path: `/v1/projects/${F.STAGING_REF}/api-keys?reveal=true` }), /endpoint_not_allowlisted/);
  assert.throws(() => F.classifyRequest({ method: 'GET', path: `/v1/projects/${F.STAGING_REF}/secrets?x=1` }), /endpoint_not_allowlisted/);
  for (const sql of [F.STAGING_PREPAUSE_SQL, F.STAGING_CRON_SQL, F.TORNEOS_EMPTY_SQL, F.CATALOG_SQL]) assert.doesNotThrow(() => F.assertReadOnlySql(sql));
});
test('pins: migration hashes are the certified four; drift is detected', () => {
  assert.deepEqual(F.MIGRATIONS.map((m) => m.sha256), ['f857bd0939054bc1a32a3855894b7b20e14a0c7456c9d5c8c5e8432e5b8ed19f', '3df4b96eecc7321eaeda84a480f089fe4bff2b28c20aa4479db92caf33457e62', '06378f12b57620e8ae550a0d881ad66464ffdc0a734ad621cba8a6ba3e6d6078', 'd54b3293da53aea1202d3daed9a70e45d86e306a56a1fdd58107fc5719e36714']);
  assert.equal(F.loadMigrations().length, 4);
  const fake = fs.mkdtempSync(path.join(os.tmpdir(), 'infra1-mig-'));
  fs.mkdirSync(path.join(fake, F.MIGRATIONS_DIR), { recursive: true });
  for (const m of F.MIGRATIONS) fs.copyFileSync(path.join(F.REPO_ROOT, F.MIGRATIONS_DIR, m.file), path.join(fake, F.MIGRATIONS_DIR, m.file));
  fs.appendFileSync(path.join(fake, F.MIGRATIONS_DIR, F.MIGRATIONS[2].file), '\n-- drift\n');
  assert.throws(() => F.loadMigrations(fake), /MIGRATION_HASH_MISMATCH 00000000000002/);
  const dirFiles = fs.readdirSync(path.join(F.REPO_ROOT, F.MIGRATIONS_DIR)).filter((f) => f.endsWith('.sql')).sort();
  assert.deepEqual(dirFiles, F.MIGRATIONS.map((m) => m.file), 'the migrations directory holds exactly the four certified files');
});
test('custody: Keychain namespace is exclusive; psql env is minimal and sa-east-1 only', () => {
  assert.doesNotThrow(() => assertNamespace(F.KEYCHAIN_DB));
  assert.ok(!F.FORBIDDEN_KEYCHAIN_SERVICES.includes(F.KEYCHAIN_DB.service));
  assert.throws(() => assertNamespace({ service: 'arma2-torneos-nonprod-db', account: 'postgres' }));
  const env = psqlEnv({ host: 'aws-1-sa-east-1.pooler.supabase.com', ref: NEW_REF, password: DB_PASS });
  assert.equal(env.PGUSER, `postgres.${NEW_REF}`); assert.equal(env.PGSSLMODE, 'verify-full'); assert.equal(env.PGPORT, '5432');
  assert.deepEqual(Object.keys(env).filter((k) => /^PG/.test(k)).sort(), ['PGAPPNAME', 'PGCONNECT_TIMEOUT', 'PGDATABASE', 'PGHOST', 'PGPASSWORD', 'PGPORT', 'PGSSLMODE', 'PGSSLROOTCERT', 'PGUSER']);
  assert.throws(() => psqlEnv({ host: 'aws-0-us-east-1.pooler.supabase.com', ref: NEW_REF, password: DB_PASS }), /sa_east_1/);
  const py = fs.readFileSync(path.join(HERE, 'keychain-foundation.py'), 'utf8');
  assert.match(py, /SERVICE = "arma2-torneos-dataplane-db"/); assert.match(py, /ACCOUNT = "postgres"/); assert.doesNotMatch(py, /"-U"/); assert.doesNotMatch(py, /delete-generic-password/);
});
test('secret scan catches PATs, keys, JWTs, DB URLs and known values', () => {
  assert.deepEqual(F.secretFindings('clean text'), []);
  for (const s of [PAT, 'sb_secret_abcdefghijklmnop', SERVICE_JWT, 'postgres://u:pw@h/db']) assert.ok(F.secretFindings(`x ${s} y`).length, s.slice(0, 10));
  assert.ok(F.secretFindings(`x ${DB_PASS} y`, [DB_PASS]).includes('known_secret_value'));
});
test('PostgREST probe: target pinned to the created ref; POST only for the denied RPC set; forged tokens rejected', async () => {
  for (const ref of F.KNOWN_REFS) assert.throws(() => assertProbeTarget(ref, '/rest/v1/x', 'GET'));
  assert.throws(() => assertProbeTarget(NEW_REF, '/rest/v1/rpc/create_tournament_organization', 'POST'), /denied_set/);
  assert.throws(() => assertProbeTarget(NEW_REF, '/rest/v1/tournament_purchases', 'POST'), /only_rpc/);
  assert.throws(() => assertProbeTarget(NEW_REF, '/auth/v1/signup', 'POST'));
  const good = await probePostgrest({ ref: NEW_REF, apikey: PUB_KEY, transport: okProbe });
  assert.equal(good.pass, true, JSON.stringify(good.checks.filter((c) => !c.pass)));
  // A forged service_role token that is ACCEPTED (200/403) must fail the certification.
  const leaky = await probePostgrest({ ref: NEW_REF, apikey: PUB_KEY, transport: async (r) => (r.headers.Authorization ? { status: 200, body: [] } : okProbe(r)) });
  assert.equal(leaky.pass, false);
  const t = forgeTokens(1_800_000_000);
  assert.equal(t.hs.split('.').length, 3); assert.ok(t.none.endsWith('.'));
  assert.equal(JSON.parse(Buffer.from(t.rs.split('.')[0], 'base64url')).alg, 'RS256');
});

// ───────────────────────── runner: staging pre-pause + pause ─────────────────────────
test('--staging-prepause: PASS with 0 writes, evidence without secrets', async () => {
  const s = setup();
  const r = await run('--staging-prepause', s);
  assert.equal(r.verdict, 'STAGING_PREPAUSE_PASS');
  assert.ok(s.w.requests.every((x) => !x.startsWith('POST') || x.endsWith('/database/query')));
  const [ev] = evidence(s); const d = JSON.parse(ev.text);
  assert.equal(d.management_api_writes, 0); assert.equal(d.read_only, true);
  noSecrets(s);
});
for (const [name, over, code] of [
  ['QA active (session touched in the last 60 min)', { activity: { cron_available: true, auth_activity: { sessions_touched_60m: 1, sign_ins_60m: 0 }, client_connections: [] } }, 'STAGING_QA_ACTIVE_LAST_60M'],
  ['external DB client connected', { activity: { cron_available: true, auth_activity: { sessions_touched_60m: 0, sign_ins_60m: 0 }, client_connections: [{ usename: 'arma2_a1_readonly' }] } }, 'STAGING_EXTERNAL_DB_CLIENT_CONNECTED'],
  ['cron job reaching an external host', { cron: [{ jobid: 7, active: true, hosts: [`${F.PROD_REF}.supabase.co`] }] }, 'STAGING_CRON_EXTERNAL_TARGET_7'],
  ['Core Production unhealthy', { prod: 'ACTIVE_UNHEALTHY' }, 'CORE_PROD_NOT_ACTIVE_HEALTHY'],
  ['contract ezbr differs from the certified artifact', { prodEzbr: 'f'.repeat(64) }, 'CORE_CONTRACT_NOT_CERTIFIED'],
  ['old project not INACTIVE', { old: 'ACTIVE_HEALTHY' }, 'OLD_PROJECT_NOT_INACTIVE'],
  ['organization not on the Free plan', { plan: 'pro' }, 'ORG_PLAN_NOT_FREE'],
  ['stray project in the organization', { extraProjects: [{ ref: 'zzzzzzzzzzzzzzzzzzzz', id: 'zzzzzzzzzzzzzzzzzzzz', name: 'x', organization_slug: F.ORG_SLUG, region: 'sa-east-1', status: 'ACTIVE_HEALTHY' }] }, 'UNEXPECTED_PROJECT_IN_ORG'],
]) {
  test(`--staging-prepause BLOCKED: ${name}`, async () => {
    const s = setup(over);
    assert.equal(await stopCode(run('--staging-prepause', s)), 'STAGING_PAUSE_BLOCKED');
    const d = JSON.parse(evidence(s)[0].text);
    assert.ok(d.failures.includes(code), JSON.stringify(d.failures));
    assert.equal(d.management_api_writes, 0);
  });
}
// ───────────────────────── scoped PAT contract ─────────────────────────
const READ_ONLY_MODES = ['--staging-prepause', '--create-preflight', '--migrate', '--certify'];
test('PAT: --staging-prepause needs exactly six Read permissions, organization-wide; only pause/create hold a Read-write', () => {
  const r = F.patRequirement('--staging-prepause');
  assert.deepEqual(r.permissions, ['Database: Read', 'Development Branches: Read', 'Edge Functions: Read', 'Organization Settings: Read', 'Project Settings: Read', 'Projects (account-wide): Read']);
  assert.deepEqual(r.fga, ['branching_development_read', 'database_read', 'edge_functions_read', 'organization_admin_read', 'project_admin_read', 'projects_read']);
  assert.deepEqual(r.resource_access, { type: 'Organization', organization_slug: F.ORG_SLUG });
  assert.deepEqual(r.writes, []); assert.deepEqual(r.unmapped, []);
  for (const m of READ_ONLY_MODES) {
    const q = F.patRequirement(m);
    assert.deepEqual(q.writes, [], m);
    assert.ok(q.permissions.every((p) => p.endsWith(': Read')), `${m} ${q.permissions}`);
    assert.ok(!q.fga.some((f) => /_(write|create|delete)$/.test(f)), m);
  }
  const pause = F.patRequirement('--pause-staging');
  assert.deepEqual(pause.writes, ['pause']);
  assert.deepEqual(pause.permissions.filter((p) => p.endsWith('Read-write')), ['Project Settings: Read-write']);
  assert.ok(!pause.permissions.includes('Project Settings: Read'));
  const create = F.patRequirement('--create-project');
  assert.deepEqual(create.writes, ['create']);
  assert.deepEqual(create.permissions.filter((p) => p.endsWith('Read-write')), ['Organization Projects: Read-write']);
  assert.throws(() => F.patRequirement('--force'), /mode_unknown/);
});
test('PAT: every endpoint carries its spec permission (x-fga-permissions); no OAuth scope names anywhere', () => {
  const expected = { org: 'organization_admin_read', projects: 'projects_read', 'prod-project': 'project_admin_read', 'prod-contract-fn': 'edge_functions_read', project: 'project_admin_read', functions: 'edge_functions_read', branches: 'branching_development_read', query: 'database_read', pause: 'project_admin_write', create: 'organization_projects_create', regions: null };
  for (const [id, fga] of Object.entries(expected)) assert.equal(F.ENDPOINTS.find((e) => e.id === id).fga, fga, id);
  for (const e of F.ENDPOINTS) { assert.ok('fga' in e, e.id); if (e.fga) assert.ok(F.FGA_LABELS[e.fga], e.fga); }
  for (const m of Object.keys(MODES)) {
    assert.ok(F.MODE_ENDPOINTS[m].every((id) => F.ENDPOINTS.some((e) => e.id === id)), m);
    const text = F.patRequirementText(m);
    assert.match(text, new RegExp(`resource access: Organization ${F.ORG_SLUG}`));
    assert.doesNotMatch(text, /\b(projects|database|organizations|secrets|edge_functions):(read|write)\b/);
  }
  const wrapper = fs.readFileSync(path.join(HERE, 'run-foundation.sh'), 'utf8');
  assert.doesNotMatch(wrapper, /projects:write/); assert.match(wrapper, /patRequirementText/);
  assert.doesNotMatch(fs.readFileSync(path.join(HERE, 'README.md'), 'utf8'), /\(projects:write\)/);
});
test('per mode: a read-only mode cannot reach a write endpoint, even armed; unlisted reads refused before the socket', async () => {
  for (const m of READ_ONLY_MODES) {
    assert.ok(!F.MODE_ENDPOINTS[m].some((id) => F.ENDPOINTS.find((e) => e.id === id).kind.startsWith('write:')), m);
    assert.throws(() => F.classifyRequest({ method: 'POST', path: `/v1/projects/${F.STAGING_REF}/pause` }, { armedFor: 'pause', mode: m }), /endpoint_not_in_mode/);
    assert.throws(() => F.classifyRequest({ method: 'POST', path: '/v1/projects', body: F.createProjectBody(DB_PASS) }, { armedFor: 'create', mode: m }), /endpoint_not_in_mode/);
  }
  assert.throws(() => F.classifyRequest({ method: 'GET', path: `/v1/projects/${F.STAGING_REF}/secrets` }, { mode: '--staging-prepause' }), /endpoint_not_in_mode/);
  assert.throws(() => makeClient({ transport: async () => assert.fail('socket'), pat: PAT }), (e) => e.code === 'CLIENT_MODE_REQUIRED');
  let sent = 0;
  const c = makeClient({ transport: async () => { sent++; return { status: 200, body: {} }; }, pat: PAT, mode: '--staging-prepause', armedFor: 'pause' });
  await assert.rejects(c.pauseStaging(), /endpoint_not_in_mode/);
  await assert.rejects(c.secretNames(F.STAGING_REF), /endpoint_not_in_mode/);
  assert.equal(sent, 0);
});
test('--staging-prepause: a token scoped to Production only → PAT_PERMISSION_DENIED naming the endpoint, ref and permission; 401 → PAT_REJECTED', async () => {
  for (const [status, code] of [[403, 'PAT_PERMISSION_DENIED'], [401, 'PAT_REJECTED']]) {
    const s = setup();
    const inner = s.w.transport;
    s.deps.transport = async (req) => (req.path.startsWith('/v1/projects/') && !req.path.includes(F.PROD_REF)
      ? (s.w.requests.push(`${req.method} ${req.path}`), { status, body: { message: 'Your account does not have the necessary privileges to access this endpoint.' } })
      : inner(req));
    const e = await run('--staging-prepause', s).then(() => assert.fail('expected STOP'), (x) => x);
    assert.equal(e.code, code);
    assert.deepEqual({ id: e.detail.id, ref: e.detail.ref, status: e.detail.status, perm: e.detail.required_permission, access: e.detail.required_resource_access }, { id: 'project', ref: F.STAGING_REF, status, perm: 'Project Settings: Read', access: `Organization ${F.ORG_SLUG}` });
    assert.deepEqual(s.w.requests, [`GET /v1/projects/${F.PROD_REF}`, `GET /v1/projects/${F.PROD_REF}/functions/${F.CORE_CONTRACT_SLUG}`, `GET /v1/projects/${F.STAGING_REF}`]);
    assert.equal(evidence(s).length, 0);
  }
});
test('--pause-staging: a wrong phrase writes nothing', async () => {
  const s = setup({}, { phrase: 'PAUSE CORE STAGING hhyvmhgpapyuzjgxfnqv' });
  assert.equal(await stopCode(run('--pause-staging', s)), 'NOT_AUTHORIZED');
  assert.ok(!s.w.requests.some((x) => x.endsWith('/pause')));
});
test('--pause-staging: exact phrase → exactly one write, INACTIVE, slot released, Prod still healthy', async () => {
  const s = setup({}, { phrase: planPhrase });
  const r = await run('--pause-staging', s);
  assert.equal(r.verdict, 'STAGING_PAUSED_SLOT_FREE');
  assert.deepEqual(s.w.requests.filter((x) => x.startsWith('POST') && !x.endsWith('/database/query')), [`POST /v1/projects/${F.STAGING_REF}/pause`]);
  const d = JSON.parse(evidence(s).find((e) => e.f.startsWith('r3-02-pause-')).text);
  assert.equal(d.management_api_writes, 1); assert.equal(d.after.staging.status, 'INACTIVE'); assert.equal(d.slots.active, 1); assert.equal(d.after.prod.status, 'ACTIVE_HEALTHY');
  assert.match(d.authorization.phrase, /^PAUSE CORE STAGING hhyvmhgpapyuzjgxfnqv [0-9a-f]{12}$/);
  noSecrets(s);
});
test('--pause-staging: a blocked pre-pause never reaches the phrase; already INACTIVE is a no-op', async () => {
  const s = setup({ activity: { cron_available: false, auth_activity: { sessions_touched_60m: 3, sign_ins_60m: 1 }, client_connections: [] } }, { phrase: () => assert.fail('phrase asked') });
  assert.equal(await stopCode(run('--pause-staging', s)), 'STAGING_PAUSE_BLOCKED');
  const s2 = setup({ staging: 'INACTIVE' }, { phrase: () => assert.fail('phrase asked') });
  assert.equal((await run('--pause-staging', s2)).verdict, 'STAGING_ALREADY_INACTIVE');
  assert.ok(!s2.w.requests.some((x) => x.endsWith('/pause')));
});

// ───────────────────────── runner: create ─────────────────────────
test('--create-preflight: blocked while Staging is active (no Free slot)', async () => {
  const s = setup();
  assert.equal(await stopCode(run('--create-preflight', s)), 'CREATE_BLOCKED');
  const d = JSON.parse(evidence(s)[0].text);
  assert.ok(d.failures.includes('STAGING_NOT_PAUSED') && d.failures.includes('NO_FREE_SLOT'), JSON.stringify(d.failures));
});
for (const [name, over, kc, code] of [
  ['sa-east-1 not offered', { staging: 'INACTIVE', regions: { all: { specific: [{ code: 'us-east-1' }] }, recommendations: { specific: [] } } }, 'ABSENT', 'REGION_SA_EAST_1_NOT_AVAILABLE'],
  ['sa-east-1 capacity-constrained', { staging: 'INACTIVE', regions: { all: { specific: [{ code: 'sa-east-1', status: 'capacity' }] }, recommendations: { specific: [] } } }, 'ABSENT', 'REGION_SA_EAST_1_CAPACITY_CONSTRAINED'],
  ['Keychain already holds a password without a project', { staging: 'INACTIVE' }, 'PRESENT', 'KEYCHAIN_PRESENT_WITHOUT_PROJECT'],
  ['project named Arma2 Torneos exists without custody', { staging: 'INACTIVE', torneos: { ref: NEW_REF, status: 'ACTIVE_HEALTHY' } }, 'ABSENT', 'TORNEOS_EXISTS_WITHOUT_CUSTODY'],
  ['two projects named Arma2 Torneos', { staging: 'INACTIVE', torneos: { ref: NEW_REF, status: 'ACTIVE_HEALTHY' }, extraProjects: [{ ref: 'mnbvcxzlkjhgfdsapoiu', id: 'mnbvcxzlkjhgfdsapoiu', name: 'arma2 torneos', organization_slug: F.ORG_SLUG, region: 'sa-east-1', status: 'COMING_UP' }] }, 'PRESENT', 'TORNEOS_PROJECT_AMBIGUOUS'],
]) {
  test(`--create-preflight BLOCKED: ${name}`, async () => {
    const s = setup(over, { keychain: fakeKeychain(kc) });
    assert.equal(await stopCode(run('--create-preflight', s)), 'CREATE_BLOCKED');
    assert.ok(JSON.parse(evidence(s)[0].text).failures.includes(code));
  });
}
// A scoped PAT is refused on available-regions (no x-fga-permissions): only that endpoint answers `status`.
const regionsDenied = (s, status) => {
  const inner = s.w.transport;
  s.deps.transport = async (req) => (req.path.startsWith('/v1/projects/available-regions')
    ? (s.w.requests.push(`${req.method} ${req.path}`), { status, body: { message: 'Your account does not have the necessary privileges to access this endpoint.' } })
    : inner(req));
  return s;
};
test('--create-preflight: available-regions 403 (scoped PAT) → PASS by the fallback, recorded as such, 0 writes', async () => {
  const s = regionsDenied(setup({ staging: 'INACTIVE' }), 403);
  assert.equal((await run('--create-preflight', s)).verdict, 'CREATE_PREFLIGHT_PASS');
  const d = JSON.parse(evidence(s)[0].text);
  assert.equal(d.verdict, 'CREATE_PREFLIGHT_PASS'); assert.deepEqual(d.failures, []);
  assert.match(d.region.source, /^fallback/); assert.equal(d.region.available, null);
  assert.deepEqual(d.region.fallback, { create_body_accepts_code: true, core_prod_active_in_region: true });
  assert.equal(d.management_api_writes, 0);
  assert.deepEqual(d.requests.find((r) => r.id === 'regions'), { id: 'regions', kind: 'read', method: 'GET', ref: null, status: 403 });
  assert.equal(d.slots.active, 1); assert.equal(d.plan.body.name, 'Arma2 Torneos'); assert.equal(d.plan.body.region_selection.code, 'sa-east-1');
  assert.ok(!s.w.requests.some((x) => x.startsWith('POST')));
});
test('--create-preflight: available-regions 403 + Core Prod not healthy in sa-east-1 → BLOCKED, region unverifiable', async () => {
  const s = regionsDenied(setup({ staging: 'INACTIVE', prod: 'ACTIVE_UNHEALTHY' }), 403);
  assert.equal(await stopCode(run('--create-preflight', s)), 'CREATE_BLOCKED');
  assert.ok(JSON.parse(evidence(s)[0].text).failures.includes('REGION_SA_EAST_1_UNVERIFIABLE'));
});
for (const [status, code] of [[401, 'PAT_REJECTED'], [500, 'API_STATUS_UNEXPECTED']]) {
  test(`--create-preflight: available-regions ${status} still stops (${code}), no evidence`, async () => {
    const s = regionsDenied(setup({ staging: 'INACTIVE' }), status);
    assert.equal(await stopCode(run('--create-preflight', s)), code);
    assert.equal(evidence(s).length, 0);
  });
}
test('--create-project: available-regions 403 → same plan id before and after the phrase → one POST, sa-east-1', async () => {
  const s = regionsDenied(setup({ staging: 'INACTIVE' }, { phrase: planPhrase }), 403);
  const r = await run('--create-project', s);
  assert.equal(r.verdict, 'ARMA2_TORNEOS_ACTIVE_HEALTHY');
  assert.equal(s.w.requests.filter((x) => x === 'POST /v1/projects').length, 1);
  assert.equal(s.w.createBody.region_selection.code, 'sa-east-1');
});
test('--create-project: exact phrase → Keychain generate → one POST with the pinned body → ACTIVE_HEALTHY, 0 functions', async () => {
  const kc = fakeKeychain();
  const s = setup({ staging: 'INACTIVE' }, { keychain: kc, phrase: planPhrase });
  const r = await run('--create-project', s);
  assert.equal(r.verdict, 'ARMA2_TORNEOS_ACTIVE_HEALTHY'); assert.equal(r.ref, NEW_REF);
  assert.equal(kc.generated, 1);
  assert.deepEqual(s.w.createBody, { organization_slug: F.ORG_SLUG, name: 'Arma2 Torneos', region_selection: { type: 'specific', code: 'sa-east-1' }, db_pass: DB_PASS });
  assert.equal(s.w.requests.filter((x) => x === 'POST /v1/projects').length, 1);
  assert.ok(!s.w.requests.some((x) => x.endsWith('/pause')));
  const d = JSON.parse(evidence(s).find((e) => /^r3-03-create-\d/.test(e.f)).text);
  assert.equal(d.project.status, 'ACTIVE_HEALTHY'); assert.equal(d.edge_functions.count, 0); assert.equal(d.custody.value_printed, false); assert.equal(d.custody.length, 40);
  assert.ok(d.health.transitions.length >= 2);
  noSecrets(s);
});
test('--create-project: wrong phrase → no Keychain write, no POST', async () => {
  const kc = fakeKeychain();
  const s = setup({ staging: 'INACTIVE' }, { keychain: kc, phrase: 'CREATE ARMA2 TORNEOS' });
  assert.equal(await stopCode(run('--create-project', s)), 'NOT_AUTHORIZED');
  assert.equal(kc.generated, 0); assert.ok(!s.w.requests.includes('POST /v1/projects'));
});
test('--create-project: resume after a crash (project + custody present) does not create again', async () => {
  const s = setup({ staging: 'INACTIVE', torneos: { ref: NEW_REF, status: 'COMING_UP' } }, { keychain: fakeKeychain('PRESENT'), phrase: () => assert.fail('phrase asked') });
  const r = await run('--create-project', s);
  assert.equal(r.verdict, 'ARMA2_TORNEOS_ACTIVE_HEALTHY');
  assert.ok(!s.w.requests.includes('POST /v1/projects'));
});
test('--create-project: Edge Functions present after create → STOP', async () => {
  const s = setup({ staging: 'INACTIVE', torneosFunctions: [{ slug: 'hello', status: 'ACTIVE' }] }, { phrase: planPhrase });
  assert.equal(await stopCode(run('--create-project', s)), 'CREATE_POSTCHECK_FAILED');
});

// ───────────────────────── runner: migrate ─────────────────────────
const torneosReady = { staging: 'INACTIVE', torneos: { ref: NEW_REF, status: 'ACTIVE_HEALTHY' }, torneosStatusSeq: [] };
test('--migrate: exact phrase → psql 0000, 0001, 0002, 0003 in order, password only in the child env', async () => {
  const s = setup(torneosReady, { keychain: fakeKeychain('PRESENT'), phrase: planPhrase });
  const r = await run('--migrate', s);
  assert.equal(r.verdict, 'MIGRATIONS_0000_0003_APPLIED');
  assert.deepEqual(s.applied.map((a) => a.file), F.MIGRATIONS.map((m) => m.file));
  for (const a of s.applied) { assert.equal(a.env.PGPASSWORD, DB_PASS); assert.equal(a.env.PGUSER, `postgres.${NEW_REF}`); }
  assert.ok(!s.w.requests.some((x) => x === 'POST /v1/projects' || x.endsWith('/pause')));
  assert.ok(s.w.bodies.every((b) => JSON.parse(b).read_only === true), 'every Management API POST in --migrate is a read-only query');
  const d = JSON.parse(evidence(s).find((e) => e.f.startsWith('r3-04-migrate-')).text);
  assert.equal(d.applied.length, 4); assert.ok(d.applied.every((a) => a.exit_code === 0 && a.marker_ok === true));
  noSecrets(s);
});
test('--migrate: a failing file STOPs; later files are never sent', async () => {
  const seen = [];
  const s = setup(torneosReady, { keychain: fakeKeychain('PRESENT'), phrase: planPhrase, applyFile: async ({ file }) => { seen.push(path.basename(file)); return path.basename(file).startsWith('00000000000002') ? { code: 3, elapsed_ms: 1, stderr_tail: `ERROR: boom ${DB_PASS}`.replace(DB_PASS, '«REDACTED»') } : { code: 0, elapsed_ms: 1 }; } });
  assert.equal(await stopCode(run('--migrate', s)), 'MIGRATION_FAILED');
  assert.deepEqual(seen, F.MIGRATIONS.slice(0, 3).map((m) => m.file));
  noSecrets(s);
});
test('--migrate: non-empty/partial database, missing custody, wrong pooler region or functions → blocked before the phrase', async () => {
  for (const [over, kc, code] of [
    [{ empty: { public_relations: 5, public_functions: 0, private_schema: 0, torneos_roles: 0, pgcrypto_available: 1 } }, 'PRESENT', 'DATABASE_NOT_EMPTY_OR_PARTIAL'],
    [{}, 'ABSENT', 'KEYCHAIN_DB_PASSWORD_ABSENT'],
    [{ poolerHost: 'aws-0-us-east-1.pooler.supabase.com' }, 'PRESENT', 'POOLER_HOST_NOT_SA_EAST_1'],
    [{ torneosFunctions: [{ slug: 'x' }] }, 'PRESENT', 'EDGE_FUNCTIONS_NOT_ZERO'],
  ]) {
    const s = setup({ ...torneosReady, ...over }, { keychain: fakeKeychain(kc), phrase: () => assert.fail('phrase asked') });
    assert.equal(await stopCode(run('--migrate', s)), 'MIGRATE_BLOCKED');
    assert.ok(JSON.parse(evidence(s)[0].text).failures.includes(code), code);
    assert.equal(s.applied.length, 0);
  }
});
test('--migrate: already installed is reported, never re-applied', async () => {
  const s = setup({ ...torneosReady, empty: { public_relations: 114, public_functions: 366, private_schema: 1, torneos_roles: 3, pgcrypto_available: 1 } }, { keychain: fakeKeychain('PRESENT'), phrase: () => assert.fail('phrase asked') });
  assert.equal((await run('--migrate', s)).verdict, 'MIGRATIONS_ALREADY_INSTALLED');
  assert.equal(s.applied.length, 0);
});

// ───────────────────────── runner: certify ─────────────────────────
test('--certify: pin + invariants + PostgREST → TORNEOS_DB_CERTIFIED, B03_REMOTE_ACTION_REQUIRED, 0 writes, no key persisted', async () => {
  const s = setup(torneosReady);
  const r = await run('--certify', s);
  assert.equal(r.verdict, 'TORNEOS_DB_CERTIFIED'); assert.equal(r.b03, 'B03_REMOTE_ACTION_REQUIRED');
  const d = JSON.parse(evidence(s)[0].text);
  assert.equal(d.management_api_writes, 0); assert.equal(d.edge_functions.count, 0); assert.equal(d.postgrest_probe.pass, true);
  assert.equal(d.auth.config.smtp_pass, undefined); assert.equal(d.postgrest_config.jwt_secret, undefined);
  assert.deepEqual(d.api_keys.map((k) => k.key_shape), ['jwt', 'jwt', 'sb_publishable_', 'sb_secret_']);
  noSecrets(s);
});
for (const [name, mutate, code] of [
  ['payment service with a 5th EXECUTE', (c) => { c.execute_payment_service.push('x()'); c.execute.torneos_payment_service.count = 5; }, 'INVARIANT_payment_service_execute_not_exactly_4'],
  ['watermark reachable by an API role', (c) => { c.watermark.api_privileges = 1; }, 'INVARIANT_watermark_api_privileges'],
  ['a public table without RLS', (c) => { c.tables.public_tables_without_rls = ['t']; }, 'INVARIANT_public_table_without_rls'],
  ['a DB-to-DB foreign server', (c) => { c.foreign_servers = 1; }, 'INVARIANT_db_to_db_objects_present'],
  ['anon privilege on an internal table', (c) => { c.anon_table_privileges.push('tournament_purchases:SELECT'); }, 'INVARIANT_anon_privilege_on_internal_tournament_purchases'],
]) {
  test(`--certify FAILS: ${name}`, async () => {
    const cat = goodCatalog(); mutate(cat);
    const s = setup({ ...torneosReady, catalog: cat }, { pinCatalog: cat });
    assert.equal(await stopCode(run('--certify', s)), 'TORNEOS_DB_CERTIFICATION_FAILED');
    assert.ok(JSON.parse(evidence(s)[0].text).failures.includes(code), code);
  });
}
test('--certify FAILS on catalog drift from the pin, on Edge Functions, on third-party auth, on a failed probe', async () => {
  const drift = goodCatalog(); drift.policies.count = 63;
  for (const [over, opts, code] of [
    [{ catalog: drift }, {}, 'CATALOG_DIFFERS_FROM_PIN'],
    [{ torneosFunctions: [{ slug: 'torneos-gateway' }] }, {}, 'EDGE_FUNCTIONS_NOT_ZERO'],
    [{ tpa: [{ id: '00000000-0000-0000-0000-000000000000', type: 'custom_jwks', custom_jwks: { keys: [{ kid: 'k' }] } }] }, {}, 'THIRD_PARTY_AUTH_UNEXPECTED'],
    [{}, { probeTransport: async (r) => (r.path.startsWith('/rest/v1/torneos_identity') && r.headers.apikey ? { status: 200, body: [] } : okProbe(r)) }, 'POSTGREST_PROBE_FAILED'],
    [{ secrets: ['SUPABASE_URL', 'MERCADO_PAGO_TEST_ACCESS_TOKEN'] }, {}, 'NON_PLATFORM_SECRETS_PRESENT'],
    [{ authUsers: 2 }, {}, 'TORNEOS_AUTH_HAS_USERS'],
    [{ staging: 'ACTIVE_HEALTHY' }, {}, 'STAGING_NOT_INACTIVE'],
  ]) {
    const s = setup({ ...torneosReady, ...over }, opts);
    assert.equal(await stopCode(run('--certify', s)), 'TORNEOS_DB_CERTIFICATION_FAILED');
    assert.ok(JSON.parse(evidence(s)[0].text).failures.includes(code), code);
  }
});

// ───────────────────────── entry + wrapper ─────────────────────────
test('entry: only {"pat"} is accepted; unknown modes refused', async () => {
  const s = setup();
  await assert.rejects(runFoundation({ mode: '--staging-prepause', request: { pat: PAT, ref: F.STAGING_REF }, deps: s.deps }), (e) => e.code === 'REQUEST_REFUSED');
  await assert.rejects(runFoundation({ mode: '--staging-prepause', request: { pat: 'nope' }, deps: s.deps }), (e) => e.code === 'PAT_MALFORMED');
  await assert.rejects(runFoundation({ mode: '--force', request: { pat: PAT }, deps: s.deps }), (e) => e.code === 'USAGE');
  assert.deepEqual(Object.keys(MODES), ['--staging-prepause', '--pause-staging', '--create-preflight', '--create-project', '--migrate', '--certify']);
});
test('wrapper: refuses force flags, extra args and a non-terminal', () => {
  const sh = path.join(HERE, 'run-foundation.sh');
  for (const args of [['--force'], ['-y'], ['--pause-staging', '--yes'], [], ['--delete']]) {
    const r = spawnSync('bash', [sh, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    assert.notEqual(r.status, 0); assert.match(r.stderr, /FOUNDATION_(USAGE|REFUSED)/);
  }
  const r = spawnSync('bash', [sh, '--staging-prepause'], { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], input: '' });
  assert.notEqual(r.status, 0); assert.match(r.stderr, /FOUNDATION_(BLOCKED_NO_TTY|REFUSED_NON_INTERACTIVE)/);
});
test('helpers: slot math and staging gates', () => {
  const slots = orgSlots([{ ref: F.PROD_REF, organization_slug: F.ORG_SLUG, status: 'ACTIVE_HEALTHY' }, { ref: F.STAGING_REF, organization_slug: F.ORG_SLUG, status: 'INACTIVE' }, { ref: F.OLD_REF, organization_slug: F.ORG_SLUG, status: 'INACTIVE' }]);
  assert.equal(slots.active, 1); assert.equal(slots.free_slots, 1);
  assert.deepEqual(stagingFailures({ branches: { branches: [{ is_default: false }] }, activity: { auth_activity: { sessions_touched_60m: 0, sign_ins_60m: 0 }, client_connections: [] }, cron: [] }), ['STAGING_PREVIEW_BRANCH_PRESENT']);
});
