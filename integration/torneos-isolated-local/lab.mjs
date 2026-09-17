// Phase 3B — R2 LOCAL lab controller for the ISOLATED Torneos non-production stack.
// Local only: the fixed Docker socket, this compose file, this project name. No Supabase CLI,
// no product .env, no remote target — the runner does not know any hostname but 127.0.0.1 and
// never imports the remote helpers (phase3b/remote/*). Hash-pinned inputs: the certified Phase 2D
// baseline + gate, the shared verification contract (phase3b/contracts) and the Postgres image id
// certified in Phase 2C/2D. Commands: prepare | up | certify | reset | status | drift | down | destroy.
import { mkdir, readFile, writeFile, access, stat } from 'node:fs/promises';
import { createHash, randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';
import { generateKey } from './jwt.mjs';

export const root = fileURLToPath(new URL('.', import.meta.url));
export const repo = fileURLToPath(new URL('../../', import.meta.url));
export const PROJECT = 'arma2-torneos-isolated-local';
export const REST = 'http://127.0.0.1:58430';
export const GATEWAY_PORT = 58431; // R4 only; reserved, never bound in R2
export const EVIDENCE = `${repo}backend/torneos/phase3b/evidence/`;
export const CONTRACTS = `${repo}backend/torneos/phase3b/contracts/`;
export const CERTIFIED = Object.freeze({
  baseline: 'f857bd0939054bc1a32a3855894b7b20e14a0c7456c9d5c8c5e8432e5b8ed19f',
  gate: '3df4b96eecc7321eaeda84a480f089fe4bff2b28c20aa4479db92caf33457e62',
  verify_sql_rendered: '0d6ef458d0d46375d8332c6a85e014597a7d30f0d4891d1b62e12df88c9c844c',
  expect: '2c0772c2bda3433e60a44c00b62a8ef79de976c205a7a88379c9e44dfdb81118',
  image: 'public.ecr.aws/supabase/postgres:17.6.1.143',
  image_id: 'sha256:80d7b27c3e8d77cfa7226eee9508671796da214781ff15a35b3670d7ad5ee453',
  postgrest_image: 'public.ecr.aws/supabase/postgrest:v14.15',
});
export const FILES = Object.freeze({
  baseline: `${repo}backend/torneos/supabase/migrations/00000000000000_torneos_baseline_v1.sql`,
  gate: `${repo}backend/torneos/supabase/migrations/00000000000001_staging_v1_rpc_exposure.sql`,
  gateJson: `${repo}backend/torneos/phase2d/staging-v1-rpc-gate.json`,
  allowlist: `${repo}backend/torneos/phase2d/staging-v1-rpc-allowlist.json`,
  verify: `${CONTRACTS}torneos-bootstrap-verify.sql`,
  expect: `${CONTRACTS}torneos-bootstrap-expect.json`,
  aclInventory: `${repo}backend/torneos/phase2c/acl-inventory.sql`,
  certifiedAcl: `${repo}backend/torneos/phase2d/evidence/real-image-acl-after-real.json`,
});
// Literals that must never appear in anything this lab renders or runs: Production, Core
// staging, the hosted platform, Core services of the other labs, Core migrations, other projects.
export const FORBIDDEN_LITERALS = Object.freeze(['rcyuuoaqfwcembdajcss', 'hhyvmhgpapyuzjgxfnqv', 'supabase.co', 'api.supabase.com',
  'core-db', 'core-auth', 'core-api', 'core-rest', 'core-functions', '/supabase/migrations', 'arma2-core-contracts-phase3a', 'arma2-sso-phase15', 'arma2-torneos-qa-seed', 'service_role_key', 'SERVICE_ROLE']);
const DOCKER = process.platform === 'darwin' ? '/Applications/Docker.app/Contents/Resources/bin/docker' : 'docker';
export const STAMP = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
export const sha256 = (data) => createHash('sha256').update(data).digest('hex');
export const secretsKnown = [];

class Stop extends Error { constructor(code, detail) { super(detail ? `${code}: ${detail}` : code); this.code = code; } }
export const stop = (code, detail) => { throw new Stop(code, detail); };

// Force the local Unix socket, ignoring DOCKER_HOST/context inherited by the shell.
export function docker(args, { input, capture = true, check = true } = {}) {
  const r = spawnSync(DOCKER, ['--host', 'unix:///var/run/docker.sock', ...args], {
    cwd: root, input, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024,
    env: { PATH: process.platform === 'darwin' ? `/Applications/Docker.app/Contents/Resources/bin:${process.env.PATH}` : process.env.PATH, HOME: process.env.HOME },
    stdio: ['pipe', capture ? 'pipe' : 'inherit', 'pipe'],
  });
  if (check && r.status !== 0) throw new Stop('DOCKER_FAILED', `${args.slice(0, 3).join(' ')} (${(r.stderr ?? '').split('\n').filter(Boolean).slice(-3).join(' | ')})`);
  return r;
}
export function dc(args, input, capture = true) {
  return docker(['compose', '--project-name', PROJECT, '--env-file', '.runtime/compose.env', '-f', 'compose.yaml', ...args], { input, capture }).stdout;
}
const PSQL = ['psql', '-d', 'postgres', '-X', '-A', '-t', '-q', '-v', 'ON_ERROR_STOP=1'];
/** SQL as a database superuser through the container's local socket (no password, no port). */
export function sql(query, user = 'supabase_admin') {
  if (!['supabase_admin', 'postgres'].includes(user)) throw new Stop('UNKNOWN_DB_USER', user);
  return dc(['exec', '-T', 'torneos-db', 'psql', '-U', user, ...PSQL.slice(1)], query, true);
}
export function sqlTry(query, user = 'supabase_admin') {
  if (!['supabase_admin', 'postgres'].includes(user)) throw new Stop('UNKNOWN_DB_USER', user);
  const r = docker(['compose', '--project-name', PROJECT, '--env-file', '.runtime/compose.env', '-f', 'compose.yaml', 'exec', '-T', 'torneos-db', 'psql', '-U', user, ...PSQL.slice(1)], { input: query, check: false });
  return { ok: r.status === 0, out: r.stdout ?? '', error: r.status === 0 ? null : (r.stderr ?? '').split('\n').filter((l) => l.startsWith('ERROR:') || l.startsWith('psql:')).join('\n') };
}
/** A shell snippet inside torneos-db (isolation probes only; the image ships bash/getent/timeout). */
export function inDb(script) {
  const r = docker(['compose', '--project-name', PROJECT, '--env-file', '.runtime/compose.env', '-f', 'compose.yaml', 'exec', '-T', 'torneos-db', 'bash', '-c', script], { check: false });
  return { status: r.status, out: (r.stdout ?? '').trim(), err: (r.stderr ?? '').trim() };
}
export async function config() { return JSON.parse(await readFile(`${root}.runtime/config.json`, 'utf8')); }
export async function runInfo() { try { return JSON.parse(await readFile(`${root}.runtime/run.json`, 'utf8')); } catch { return null; } }

export async function prepare() {
  await mkdir(`${root}.runtime/public`, { recursive: true, mode: 0o700 });
  try { await access(`${root}.runtime/config.json`); }
  catch {
    // Lab secrets (never Staging/Production secrets): DB admin password, the two gateway logins,
    // an RS256 key ring with one active key and one standby (its kid is NOT in the JWKS).
    const secret = () => randomBytes(32).toString('hex');
    const keys = [generateKey('p3b-k1'), generateKey('p3b-k2')];
    const cfg = { project: PROJECT, dbPassword: secret(), writerPassword: secret(), adapterPassword: secret(),
      keys, activeKid: 'p3b-k1', trustedKids: ['p3b-k1'] };
    await writeFile(`${root}.runtime/config.json`, JSON.stringify(cfg), { mode: 0o600 });
    await writeFile(`${root}.runtime/compose.env`, `DB_PASSWORD=${cfg.dbPassword}\n`, { mode: 0o600 });
    await writeFile(`${root}.runtime/public/jwks.json`, JSON.stringify({ keys: [keys[0].publicKey] }) + '\n');
  }
  const c = await config();
  secretsKnown.push(c.dbPassword, c.writerPassword, c.adapterPassword, ...c.keys.flatMap((k) => k.privateKey.split('\n').filter((l) => l.length >= 16 && !l.startsWith('-----'))));
  return c;
}

export async function gatedNames() {
  const g = JSON.parse(await readFile(FILES.gateJson, 'utf8'));
  const names = [...new Set(g.functions.map((f) => f.name))];
  if (names.length !== 33 || names.some((x) => !/^[a-z_]+$/.test(x))) stop('GATE_MANIFEST_UNEXPECTED');
  return names;
}
/** The shared verification contract, rendered exactly as the remote runner renders it. */
export async function renderVerify(names) {
  const template = (await readFile(FILES.verify, 'utf8')).replace(/\s+$/, '');
  const rendered = template.split('__GATED_NAMES__').join(names.map((x) => `'${x}'`).join(','));
  if (sha256(rendered) !== CERTIFIED.verify_sql_rendered) stop('VERIFY_SQL_DIFFERS_FROM_CERTIFIED', sha256(rendered));
  return rendered;
}
/** Same comparison the remote runner makes: scalars by string form, arrays/objects by JSON text. */
export function evaluateExpect(expectDoc, verification) {
  const asText = (v) => (v == null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v));
  return Object.entries(expectDoc).map(([key, expected]) => ({ key, expected: asText(expected), got: asText(verification[key]), ok: asText(expected) === asText(verification[key]) }));
}
export async function integrity() {
  const baseline = await readFile(FILES.baseline);
  const gate = await readFile(FILES.gate);
  const expectText = await readFile(FILES.expect);
  const out = { baseline_sha256: sha256(baseline), gate_sha256: sha256(gate), expect_sha256: sha256(expectText) };
  if (out.baseline_sha256 !== CERTIFIED.baseline) stop('BASELINE_DIFFERS_FROM_CERTIFIED', out.baseline_sha256);
  if (out.gate_sha256 !== CERTIFIED.gate) stop('GATE_DIFFERS_FROM_CERTIFIED', out.gate_sha256);
  if (out.expect_sha256 !== CERTIFIED.expect) stop('EXPECT_DIFFERS_FROM_CERTIFIED', out.expect_sha256);
  const names = await gatedNames();
  out.verify_sql = await renderVerify(names);
  out.verify_sql_sha256 = sha256(out.verify_sql);
  out.gated_names = names;
  out.expect = JSON.parse(expectText);
  if (Object.keys(out.expect).length !== 16) stop('EXPECT_COUNT', String(Object.keys(out.expect).length));
  // The image is identified by id, never pulled: the tag alone could move.
  const img = docker(['image', 'inspect', CERTIFIED.image, '--format', '{{.Id}}'], { check: false });
  if (img.status !== 0) stop('IMAGE_NOT_PRESENT_LOCALLY', CERTIFIED.image);
  out.image = CERTIFIED.image; out.image_id = img.stdout.trim();
  if (out.image_id !== CERTIFIED.image_id) stop('IMAGE_ID_DIFFERS_FROM_CERTIFIED', out.image_id);
  return out;
}

async function portFree(port) {
  return new Promise((resolve) => {
    const s = createServer();
    s.once('error', () => resolve(false));
    s.listen({ host: '127.0.0.1', port, exclusive: true }, () => s.close(() => resolve(true)));
  });
}
export function projectResources() {
  const f = `label=com.docker.compose.project=${PROJECT}`;
  const list = (args) => docker(args).stdout.split('\n').map((s) => s.trim()).filter(Boolean);
  return { containers: list(['ps', '-a', '--filter', f, '--format', '{{.Names}}']), volumes: list(['volume', 'ls', '--filter', f, '--format', '{{.Name}}']), networks: list(['network', 'ls', '--filter', f, '--format', '{{.Name}}']) };
}
/** Fail-closed isolation preflight on the RENDERED compose configuration, before anything starts. */
export async function preflightIsolation({ expectAbsent }) {
  const rendered = dc(['config', '--format', 'json']);
  const findings = [];
  for (const lit of FORBIDDEN_LITERALS) if (rendered.includes(lit)) findings.push(`forbidden literal in rendered compose: ${lit}`);
  const cfg = JSON.parse(rendered);
  for (const [name, svc] of Object.entries(cfg.services ?? {})) {
    for (const p of svc.ports ?? []) if (p.host_ip !== '127.0.0.1') findings.push(`${name}: port ${p.published} not bound to 127.0.0.1`);
    if (name === 'torneos-db' && (svc.ports ?? []).length) findings.push('torneos-db publishes a port');
    if (name === 'torneos-db' && Object.keys(svc.networks ?? {}).join() !== 'isolated') findings.push('torneos-db not confined to the internal network');
    if (['torneos-db', 'torneos-rest'].includes(name) && Object.keys(svc.networks ?? {}).includes('egress')) findings.push(`${name} attached to egress`);
    for (const v of svc.volumes ?? []) if (v.type === 'bind' && !v.source.startsWith(repo.replace(/\/$/, ''))) findings.push(`${name}: bind mount outside this worktree: ${v.source}`);
    if (svc.image?.split(':')[0] === CERTIFIED.image.split(':')[0] && svc.image !== CERTIFIED.image) findings.push(`${name}: postgres image is not the certified tag`);
    if (name === 'torneos-rest' && svc.image !== CERTIFIED.postgrest_image) findings.push(`${name}: postgrest image is not the certified tag`);
  }
  if (cfg.networks?.isolated?.internal !== true) findings.push('network isolated is not internal');
  if (cfg.networks?.['loopback-ingress']?.driver_opts?.['com.docker.network.bridge.enable_ip_masquerade'] !== 'false') findings.push('loopback-ingress masquerade not disabled');
  if (cfg.name !== PROJECT) findings.push(`compose project name ${cfg.name}`);
  const res = projectResources();
  if (expectAbsent && (res.containers.length || res.volumes.length || res.networks.length)) findings.push(`project already exists: ${JSON.stringify(res)} (use reset/destroy)`);
  if (expectAbsent) for (const port of [58430, GATEWAY_PORT]) if (!(await portFree(port))) findings.push(`port ${port} busy`);
  return { findings, services: Object.keys(cfg.services ?? {}), resources: res };
}

export function canonical(value) { // stable JSON for hashing: sorted keys, no whitespace variance
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`;
  return JSON.stringify(value);
}
/** Write evidence: never overwrite, never a known secret, never a Production target, always JSON. */
export async function promoteEvidence(name, doc) {
  if (!/^local-torneos-[A-Za-z0-9.-]+\.json$/.test(name)) stop('EVIDENCE_NAME', name);
  const path = `${EVIDENCE}${name}`;
  try { await stat(path); stop('EVIDENCE_EXISTS', path); } catch (e) { if (e instanceof Stop) throw e; }
  const text = JSON.stringify(doc, null, 2) + '\n';
  for (const s of secretsKnown) if (s && s.length >= 8 && text.includes(s)) stop('EVIDENCE_REJECTED_SECRET_LEAK', name);
  const [prodRef, ...remoteLits] = FORBIDDEN_LITERALS; // Production ref; Core staging ref, hosted platform hosts
  if (text.includes(`"ref":"${prodRef}"`) || text.includes(`"ref": "${prodRef}"`)) stop('EVIDENCE_REJECTED_PRODUCTION_TARGET');
  for (const lit of remoteLits.slice(0, 3)) if (text.includes(lit)) stop('EVIDENCE_REJECTED_REMOTE_LITERAL', lit);
  await mkdir(EVIDENCE, { recursive: true });
  await writeFile(path, text, { flag: 'wx' });
  console.log(`EVIDENCE ${path.slice(repo.length)}\n${sha256(text)}`);
  return { file: path.slice(repo.length), sha256: sha256(text) };
}

async function waitFor(label, probe, attempts = 60) {
  for (let i = 0; i < attempts; i++) {
    try { if (await probe()) return; } catch { /* fixed local target only */ }
    await new Promise((r) => setTimeout(r, 1000));
  }
  stop('LOCAL_READINESS_FAILED', label);
}
const PREFLIGHT_SQL = "select json_build_object('installer', current_user, 'server_version', current_setting('server_version'), 'public_relations', (select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind in ('r','v','m','S')), 'pgcrypto_available', (select count(*) from pg_available_extensions where name='pgcrypto'), 'torneos_roles', (select count(*) from pg_roles where rolname like 'torneos%'), 'identity_table', to_regclass('public.torneos_identity') is not null, 'db_host_ref', current_database())";

export async function up() {
  const t0 = Date.now();
  const integ = await integrity();
  console.log(`[ok] baseline ${integ.baseline_sha256}\n[ok] gate ${integ.gate_sha256}\n[ok] verify sql ${integ.verify_sql_sha256} (rendered)\n[ok] expect ${integ.expect_sha256}\n[ok] image ${integ.image} ${integ.image_id}`);
  const c = await prepare();
  const pre = await preflightIsolation({ expectAbsent: true });
  if (pre.findings.length) stop('ISOLATION_PREFLIGHT', pre.findings.join('; '));
  console.log(`[ok] isolation preflight: 0 findings (${pre.services.join(', ')})`);
  dc(['up', '-d', '--wait', 'torneos-db'], undefined, false);
  const preflight = JSON.parse(sql(PREFLIGHT_SQL));
  console.log(`  ${JSON.stringify(preflight)}`);
  if (preflight.identity_table !== false) stop('ALREADY_INSTALLED', 'torneos_identity exists on a fresh volume');
  if (preflight.public_relations !== 0) stop('PUBLIC_NOT_EMPTY', String(preflight.public_relations));
  if (preflight.pgcrypto_available !== 1) stop('PGCRYPTO_UNAVAILABLE');
  if (preflight.torneos_roles !== 0) stop('TORNEOS_ROLES_EXIST', String(preflight.torneos_roles));
  // Install as supabase_admin, baseline then gate, each file its own transaction (certified route 2C/2D/3A).
  const baselineText = await readFile(FILES.baseline, 'utf8');
  const gateText = await readFile(FILES.gate, 'utf8');
  let step = 'baseline';
  try {
    sql(baselineText); step = 'gate';
    sql(gateText); step = 'post-install';
    // Post-install identical to the remote runner (bootstrap-torneos.sh): server logins as
    // NOINHERIT members of the baseline's NOLOGIN roles, pre-request hook on authenticator, reload.
    sql(`begin; create role torneos_edge_identity_writer login noinherit password '${c.writerPassword}'; create role torneos_edge_core_adapter login noinherit password '${c.adapterPassword}'; grant torneos_identity_writer to torneos_edge_identity_writer; grant torneos_core_adapter to torneos_edge_core_adapter; alter role authenticator set pgrst.db_pre_request = 'private.check_token'; commit; notify pgrst, 'reload config'; notify pgrst, 'reload schema';`);
    // Local transport only: PostgREST connects with a password (hosted Supabase manages this itself).
    sql(`alter role authenticator password '${c.dbPassword}';`);
  } catch (e) {
    console.error(`!! install failed at ${step}; destroying the volume (never repair by hand)`);
    dc(['down', '-v', '--remove-orphans'], undefined, false);
    throw e;
  }
  dc(['up', '-d', 'torneos-rest'], undefined, false);
  await waitFor('torneos-rest', async () => (await fetch(`${REST}/`, { signal: AbortSignal.timeout(3000) })).status === 200);
  const run = { stamp: STAMP, started_at: new Date(t0).toISOString(), fresh_volume: true };
  await writeFile(`${root}.runtime/run.json`, JSON.stringify(run) + '\n', { mode: 0o600 });
  // Verification: the shared contract, the shared expectations (first mismatch = STOP, as remote).
  // A query error is a finding in its own right: recorded as evidence, the stack is left running
  // for inspection (never repaired by hand), the command fails.
  let verification = null, verificationError = null;
  const tried = sqlTry(integ.verify_sql);
  if (tried.ok) verification = JSON.parse(tried.out); else verificationError = tried.error;
  const expectations = verification ? evaluateExpect(integ.expect, verification) : [];
  const failed = expectations.filter((e) => !e.ok);
  const doc = {
    generated_at: new Date().toISOString(), tool: 'integration/torneos-isolated-local/lab.mjs up', phase: '3B', step: 'R2-local bootstrap', project: PROJECT,
    target: { kind: 'local docker compose', rest: REST, gateway_port_reserved_for_R4: GATEWAY_PORT, remote_requests: 0 },
    image: integ.image, image_id: integ.image_id, postgrest_image: CERTIFIED.postgrest_image,
    baseline_sha256: integ.baseline_sha256, gate_sha256: integ.gate_sha256, verify_sql_sha256: integ.verify_sql_sha256, expect_sha256: integ.expect_sha256,
    isolation_preflight: { findings: pre.findings, services_rendered: pre.services },
    preflight, install: { installer: 'supabase_admin', baseline_bytes: Buffer.byteLength(baselineText), gate_bytes: Buffer.byteLength(gateText), post_install: 'identical to phase3b/remote/bootstrap-torneos.sh (edge logins NOINHERIT, pgrst.db_pre_request=private.check_token, notify pgrst)', local_transport_only: 'alter role authenticator password (PostgREST connection)' },
    verification, verification_error: verificationError, expectations, expectations_passed: expectations.length - failed.length, expectations_total: 16,
    catalog_hash: verification ? sha256(canonical(verification)) : null, run, ok: !verificationError && failed.length === 0,
    custody: { db_password: '.runtime/config.json (0600, gitignored; lab secret)', edge_logins: '.runtime/config.json', bridge_keys: '.runtime/config.json (p3b-k1 active, p3b-k2 standby); JWKS .runtime/public/jwks.json' },
  };
  const ev = await promoteEvidence(`local-torneos-bootstrap-${STAMP}.json`, doc);
  if (verificationError) stop('VERIFICATION_QUERY_FAILED', `${verificationError} (stack left running for inspection)`);
  if (failed.length) stop('VERIFICATION_FAILED', failed.map((f) => `${f.key}=${f.got} (expected ${f.expected})`).join('; '));
  console.log(`PHASE3B_R2_LOCAL_BOOTSTRAP_VERIFIED ${PROJECT} ${expectations.length}/${expectations.length} → ${ev.file}`);
  return doc;
}
function run(node, args) {
  const r = spawnSync(process.execPath, [node, ...args], { cwd: root, stdio: 'inherit', env: { PATH: process.env.PATH, HOME: process.env.HOME, NO_COLOR: '1' } });
  if (r.status !== 0) process.exit(r.status ?? 1);
}
async function main() {
  const cmd = process.argv[2];
  if (cmd === 'prepare') return void await prepare();
  if (cmd === 'up') return void await up();
  if (cmd === 'certify') return run(`${repo}backend/torneos/phase3b/local/certify-torneos-local.mjs`, process.argv.slice(3));
  if (cmd === 'drift') return run(`${repo}backend/torneos/phase3b/local/drift-torneos-local.mjs`, process.argv.slice(3));
  if (cmd === 'reset') { await prepare(); dc(['down', '-v', '--remove-orphans'], undefined, false); await up(); return run(`${repo}backend/torneos/phase3b/local/certify-torneos-local.mjs`, []); }
  if (cmd === 'status') { await prepare(); console.log(dc(['ps', '--format', 'table {{.Name}}\t{{.Status}}\t{{.Ports}}'])); console.log(JSON.stringify(projectResources())); return; }
  if (cmd === 'down') { await prepare(); return void dc(['down', '--remove-orphans'], undefined, false); }
  if (cmd === 'destroy') { await prepare(); return void dc(['down', '-v', '--remove-orphans'], undefined, false); }
  throw new Stop('USAGE', 'prepare | up | certify | reset | status | drift | down | destroy — local only, no remote operations');
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((e) => { console.error(`!! STOP ${e?.message ?? e}`); process.exitCode = 1; });
}
