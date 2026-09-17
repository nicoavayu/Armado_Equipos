#!/usr/bin/env node
// Phase 3B — the WRITE operations of the remote bootstrap, one per op, each pinned to a
// NON-PRODUCTION target. Kept apart from mgmt.mjs (which stays read-only by construction)
// and reusing its denylist, redaction and HTTPS transport rules.
//
//   create-project     POST /v1/projects                                (Torneos non-prod project)
//   pooler             GET  /v1/projects/{ref}/config/database/pooler   (read; pooler host for psql)
//   set-secrets        POST /v1/projects/{ref}/secrets                  (Edge Function secrets)
//   deploy-function    POST /v1/projects/{ref}/functions/deploy?slug=…  (multipart, CLI-shaped)
//   third-party-auth   POST /v1/projects/{ref}/config/auth/third-party-auth (JWKS trust, B03)
//   apply-core-contract POST /v1/projects/{ref}/database/query           (ONLY the two hash-pinned
//                      Core contract migrations; each one = file bytes + its ledger row INSERT in
//                      ONE transaction (core-contract.mjs renderApplySql, sha256 pinned); never
//                      arbitrary SQL. Probe-first on objects AND ledger: idempotent re-runs,
//                      reconciliation of an installed-but-unrecorded version, STOP on any
//                      inconsistent or foreign state)
//
// Credentials (PAT, secret values, db password) arrive as ONE JSON document on STDIN and are
// registered for redaction before anything else happens; they never reach argv, env or disk.
// Every request path must be under /v1/projects/<non-production ref>/… or, for create-project,
// exactly /v1/projects; Production may not appear in host, path, body or token.
import https from 'node:https';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import process from 'node:process';
import { pathToFileURL } from 'node:url';
import { PROD_REF, API_HOST, PAT_PATTERN, REF_PATTERN, ORG_SLUG_PATTERN, AbortError, assertNoProduction, assertNonProductionRef, redact, registerSecret, projectFunction, projectProject, assertReadOnlySql } from './mgmt.mjs';
import { MIGRATIONS as CONTRACT_MIGRATIONS, renderAll, ledgerInsertSql, ledgerRowsSql, LEDGER_SHAPE_SQL, ledgerShapeDiff, CORE_REF } from './core-contract.mjs';

// Socket idle timeout (no byte in either direction for this long → the request is destroyed; the
// server may still be executing) and the whole-process deadline. Observed 2026-09-17T17:08Z: the
// APPLY was cut < 106 s after the phrase with its error lost by the shell; the next failure carries
// `detail` (phase, version, status, elapsed_ms, code) so the timeout question can be answered from
// evidence instead of being guessed. The values themselves are unchanged.
const CONNECT_TIMEOUT_MS = 20000;
const DEADLINE_MS = 180000;
/** Every refusal is an AbortError; `detail` (optional, never a secret) travels to the {"ok":false} line. */
function fail(error, detail) { const e = new AbortError(redact(error)); if (detail !== undefined) e.detail = detail; throw e; }
/** Re-throw with the apply phase/version attached when the transport failed without one. */
function tagged(error, tag) { if (error instanceof AbortError && error.detail && typeof error.detail === 'object' && !('phase' in error.detail)) error.detail = { ...tag, ...error.detail }; else if (error instanceof AbortError && !error.detail) error.detail = { ...tag }; return error; }

export const ALLOWED_REGIONS = new Set(['us-east-1', 'us-east-2', 'us-west-1', 'us-west-2', 'sa-east-1', 'eu-west-1', 'eu-west-2', 'eu-central-1']);
// The name must carry a non-production marker as a whole dash-separated label anywhere after
// the `arma2-torneos` prefix (`arma2-torneos-isolated-staging`, `arma2-torneos-staging`, …) and
// may never carry a production-sounding label. Checked here AND in the shell runner.
export const PROJECT_NAME_PATTERN = /^arma2-torneos(?:-[a-z0-9]+)*-(?:staging|nonprod|preprod)(?:-[a-z0-9]+)*$/;
export const FORBIDDEN_NAME_LABELS = new Set(['prod', 'production', 'live', 'main']);
export const ALLOWED_INSTANCE_SIZES = new Set(['nano', 'micro']);
export function assertProjectName(name, existingNames) {
  if (typeof name !== 'string' || !PROJECT_NAME_PATTERN.test(name)) fail('project_name_must_mark_non_production');
  if (name.split('-').some((label) => FORBIDDEN_NAME_LABELS.has(label))) fail('project_name_carries_production_label__ABORT');
  // Preflight is mandatory: the caller must have listed the organization's projects first, so a
  // second project with the same name (the Core staging is `arma2-torneos-staging`) is refused.
  if (!Array.isArray(existingNames) || !existingNames.every((n) => typeof n === 'string')) fail('existing_names_required__ABORT');
  if (existingNames.includes(name)) fail('project_name_already_exists__ABORT');
  return name;
}

export function assertWritePath(method, reqPath) {
  if (method !== 'GET' && method !== 'POST') fail(`method_not_allowed_${method}__ABORT`);
  assertNoProduction('path', reqPath);
  if (method === 'POST' && reqPath === '/v1/projects') return;
  const m = /^\/v1\/projects\/([a-z]{20})\/(config\/database\/pooler|secrets|functions\/deploy\?slug=[a-z0-9-]+|config\/auth\/third-party-auth|database\/query)$/.exec(reqPath);
  if (!m) fail('path_not_allowed__ABORT');
  assertNonProductionRef(m[1]);
  if (method === 'GET' && !reqPath.endsWith('/config/database/pooler')) fail('get_only_pooler__ABORT');
  if (method === 'POST' && reqPath.endsWith('/config/database/pooler')) fail('pooler_is_read_only__ABORT');
}

export function httpsRequest({ pat, method, reqPath, body, contentType = 'application/json' }) {
  assertNoProduction('token', pat);
  assertWritePath(method, reqPath);
  const payload = body === undefined ? null : (Buffer.isBuffer(body) ? body : Buffer.from(JSON.stringify(body)));
  if (payload !== null) assertNoProduction('body', payload.toString('latin1'));
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const headers = { Authorization: `Bearer ${pat}`, Accept: 'application/json', 'User-Agent': 'arma2-torneos-phase3b-bootstrap/1' };
    if (payload !== null) { headers['Content-Type'] = contentType; headers['Content-Length'] = payload.length; }
    const req = https.request({ host: API_HOST, servername: API_HOST, port: 443, method, path: reqPath, headers, rejectUnauthorized: true, minVersion: 'TLSv1.2' }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400) { res.resume(); reject(new AbortError(`redirect_refused_status_${res.statusCode}__ABORT`)); return; }
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let parsed = null; try { parsed = text ? JSON.parse(text) : null; } catch { parsed = null; }
        resolve({ status: res.statusCode, body: parsed, raw: text, elapsed_ms: Date.now() - started });
      });
    });
    req.setTimeout(CONNECT_TIMEOUT_MS, () => req.destroy(new Error('idle_timeout')));
    req.on('error', (err) => { const e = new AbortError(redact(`request_failed_${err.message}`)); e.detail = { method, path: reqPath, code: err.code ?? null, elapsed_ms: Date.now() - started, idle_timeout_ms: CONNECT_TIMEOUT_MS, body_bytes: payload === null ? 0 : payload.length }; reject(e); });
    if (payload !== null) req.write(payload);
    req.end();
  });
}

// ─────────────────────────── ops ────────────────────────────
// Body shape per the Management API OpenAPI document read on 2026-09-15 (sha256 c781ed91…):
// `organization_slug` is required and `organization_id` deprecated; `region` is deprecated in
// favour of `region_selection: {type:'specific', code}`; `desired_instance_size` omitted =
// "the smallest possible size" (Micro on paid plans: Nano cannot be launched there).
export function createProjectBody({ organization_slug, name, region, db_pass, desired_instance_size }) {
  const body = { organization_slug, name, region_selection: { type: 'specific', code: region }, db_pass };
  if (desired_instance_size !== undefined) {
    if (!ALLOWED_INSTANCE_SIZES.has(desired_instance_size)) fail('instance_size_not_allowed');
    body.desired_instance_size = desired_instance_size;
  }
  return body;
}
export async function opCreateProject(transport, pat, { organization_slug, organization_id, name, region, db_pass, desired_instance_size, existing_names }) {
  const slug = organization_slug ?? organization_id;
  if (typeof slug !== 'string' || !ORG_SLUG_PATTERN.test(slug)) fail('organization_slug_malformed');
  assertNoProduction('org', slug);
  assertProjectName(name, existing_names);
  if (!ALLOWED_REGIONS.has(region)) fail('region_not_allowed');
  if (typeof db_pass !== 'string' || db_pass.length < 24 || !/^[A-Za-z0-9_-]+$/.test(db_pass)) fail('db_pass_weak_or_unsafe');
  registerSecret(db_pass);
  const body = createProjectBody({ organization_slug: slug, name, region, db_pass, desired_instance_size });
  const res = await transport({ pat, method: 'POST', reqPath: '/v1/projects', body });
  if (res.status !== 200 && res.status !== 201) fail(`create_project_status_${res.status}_${(res.raw ?? '').slice(0, 200)}`);
  const project = projectProject(res.body);
  if (!project?.id || !REF_PATTERN.test(project.id) || project.id === PROD_REF) fail('create_project_unexpected_ref__ABORT');
  if (project.name !== name) fail('create_project_unexpected_name__ABORT');
  return { project };
}

export function poolerHost(body) {
  const list = Array.isArray(body) ? body : [body];
  const hosts = new Set();
  for (const entry of list) {
    const host = entry?.db_host ?? (typeof entry?.connection_string === 'string' ? (() => { try { return new URL(entry.connection_string).hostname; } catch { return null; } })() : null);
    if (host) hosts.add(host);
  }
  const host = [...hosts].find((h) => /^aws-\d+-[a-z0-9-]+\.pooler\.supabase\.com$/.test(h));
  if (!host) fail('pooler_host_not_found');
  return { host, port_session: 5432, port_transaction: 6543 };
}
export async function opPooler(transport, pat, { ref }) {
  assertNonProductionRef(ref);
  const res = await transport({ pat, method: 'GET', reqPath: `/v1/projects/${ref}/config/database/pooler` });
  if (res.status !== 200) fail(`pooler_status_${res.status}`);
  return poolerHost(res.body);
}

export const SECRET_NAME_PATTERN = /^[A-Z][A-Z0-9_]{2,63}$/;
export async function opSetSecrets(transport, pat, { ref, secrets }) {
  assertNonProductionRef(ref);
  if (!Array.isArray(secrets) || secrets.length === 0 || secrets.length > 32) fail('secrets_list_invalid');
  for (const s of secrets) {
    if (!SECRET_NAME_PATTERN.test(s?.name ?? '')) fail('secret_name_invalid');
    if (typeof s.value !== 'string' || s.value.length === 0 || s.value.length > 65536) fail(`secret_value_invalid_${s.name}`);
    if (/^SUPABASE_/.test(s.name)) fail('platform_reserved_secret_name');
    registerSecret(s.value);
  }
  const res = await transport({ pat, method: 'POST', reqPath: `/v1/projects/${ref}/secrets`, body: secrets.map((s) => ({ name: s.name, value: s.value })) });
  if (res.status !== 200 && res.status !== 201) fail(`set_secrets_status_${res.status}`);
  return { wrote: secrets.map((s) => s.name).sort() };
}

/** Import walker (relative .ts/.json imports) mirroring the CLI's WalkImportPaths for our trees. */
export function resolveFiles(root, entrypoint) {
  const rootAbs = fs.realpathSync(root);
  const seen = new Map();
  const walk = (rel) => {
    if (seen.has(rel)) return;
    const abs = path.resolve(rootAbs, rel);
    if (!abs.startsWith(rootAbs + path.sep)) fail(`import_escapes_root__${rel}__ABORT`);
    if (!/^[A-Za-z0-9._/-]+$/.test(rel)) fail(`unsafe_file_name__${rel}__ABORT`);
    const bytes = fs.readFileSync(abs);
    seen.set(rel, bytes);
    if (!rel.endsWith('.ts')) return;
    const src = bytes.toString('utf8');
    for (const m of src.matchAll(/from\s+["'](\.{1,2}\/[^"']+)["']/g)) walk(path.posix.normalize(path.posix.join(path.posix.dirname(rel), m[1])));
    for (const m of src.matchAll(/import\s+[\w$]+\s+from\s+["'](\.\/[^"']+\.json)["']\s+with/g)) walk(path.posix.normalize(path.posix.join(path.posix.dirname(rel), m[1])));
  };
  walk(entrypoint);
  return [...seen.entries()].map(([relPath, bytes]) => ({ relPath, bytes, sha256: crypto.createHash('sha256').update(bytes).digest('hex') })).sort((a, b) => a.relPath.localeCompare(b.relPath));
}
export function buildDeployBody(slug, entrypoint, verifyJwt, files) {
  const boundary = 'a2boundary' + crypto.randomBytes(24).toString('hex');
  const metadata = { name: slug, entrypoint_path: entrypoint, verify_jwt: verifyJwt };
  const parts = [Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="metadata"\r\n\r\n${JSON.stringify(metadata)}\n\r\n`, 'utf8')];
  for (const f of files) {
    parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${f.relPath}"\r\nContent-Type: application/octet-stream\r\n\r\n`, 'utf8'));
    parts.push(f.bytes);
    parts.push(Buffer.from('\r\n', 'utf8'));
  }
  parts.push(Buffer.from(`--${boundary}--\r\n`, 'utf8'));
  return { boundary, body: Buffer.concat(parts), metadata };
}
export const DEPLOYABLE = {
  // slug → { root (relative to the repo), entrypoint (relative to root), verify_jwt }
  'torneos-core-contract': { root: 'supabase', entrypoint: 'functions/torneos-core-contract/index.ts', verify_jwt: false, side: 'core' },
  'torneos-gateway': { root: 'backend/torneos/supabase', entrypoint: 'functions/torneos-gateway/index.ts', verify_jwt: false, side: 'torneos' },
};
export async function opDeployFunction(transport, pat, { ref, slug, repo, dryRun }) {
  assertNonProductionRef(ref);
  const spec = DEPLOYABLE[slug];
  if (!spec) fail('slug_not_deployable');
  if (typeof repo !== 'string' || !path.isAbsolute(repo)) fail('repo_must_be_absolute');
  const files = resolveFiles(path.join(repo, spec.root), spec.entrypoint);
  const { boundary, body, metadata } = buildDeployBody(slug, spec.entrypoint, spec.verify_jwt, files);
  const manifest = files.map((f) => ({ path: f.relPath, bytes: f.bytes.length, sha256: f.sha256 }));
  if (dryRun === true) return { dryRun: true, slug, metadata, files: manifest, body_bytes: body.length };
  const res = await transport({ pat, method: 'POST', reqPath: `/v1/projects/${ref}/functions/deploy?slug=${slug}`, body, contentType: `multipart/form-data; boundary=${boundary}` });
  if (res.status !== 200 && res.status !== 201) fail(`deploy_status_${res.status}_${(res.raw ?? '').slice(0, 200)}`);
  return { deployed: slug, fn: projectFunction(res.body), files: manifest };
}

export async function opThirdPartyAuth(transport, pat, { ref, jwks, issuer }) {
  assertNonProductionRef(ref);
  if (!jwks || !Array.isArray(jwks.keys) || jwks.keys.length === 0) fail('jwks_invalid');
  for (const k of jwks.keys) { if (k.kty !== 'RSA' || 'd' in k || 'p' in k || 'q' in k) fail('jwks_must_be_public_rsa'); }
  const body = { custom_jwks: jwks };
  if (issuer) body.oidc_issuer_url = issuer;
  const res = await transport({ pat, method: 'POST', reqPath: `/v1/projects/${ref}/config/auth/third-party-auth`, body });
  if (res.status !== 200 && res.status !== 201) fail(`third_party_auth_status_${res.status}_${(res.raw ?? '').slice(0, 200)}`);
  return { integration: { id: res.body?.id ?? null, type: res.body?.type ?? null } };
}

// The Core contract migrations, pinned by content hash (core-contract.mjs): the only SQL this
// file can send is the rendered apply document of each version (file bytes + ledger INSERT, one
// transaction) or the ledger INSERT alone (reconciliation). Target: Core staging only.
export const CORE_CONTRACT_MIGRATIONS = CONTRACT_MIGRATIONS;
async function readRows(transport, pat, ref, query, tag = {}) {
  assertReadOnlySql(query);
  let res;
  try { res = await transport({ pat, method: 'POST', reqPath: `/v1/projects/${ref}/database/query`, body: { query, read_only: true } }); } catch (error) { throw tagged(error, tag); }
  if (res.status !== 200 && res.status !== 201) fail(`probe_status_${res.status}_${(res.raw ?? '').slice(0, 120)}`, { ...tag, status: res.status, elapsed_ms: res.elapsed_ms ?? null });
  return Array.isArray(res.body) ? res.body : (res.body?.result ?? []);
}
/** absent | ours | foreign — what the ledger says about one version, by statements digest. */
export function ledgerState(rows, m) {
  const row = (rows ?? []).find((r) => r.version === m.version);
  if (!row) return 'absent';
  return row.statements_digest === m.ledger_digest && Number(row.statements_count) === m.statements_count && row.name === m.name ? 'ours' : 'foreign';
}
/** The decision table of the apply (pure, tested offline). */
export function applyDecision(installed, ledger) {
  if (!installed && ledger === 'absent') return 'apply';
  if (installed && ledger === 'ours') return 'skip';
  if (installed && ledger === 'absent') return 'reconcile-ledger';
  if (installed && ledger === 'foreign') return 'STOP:ledger_row_not_ours';
  return 'STOP:ledger_row_without_objects';
}
export async function opApplyCoreContract(transport, pat, { ref, repo, dryRun }) {
  assertNonProductionRef(ref);
  if (ref !== CORE_REF) fail('apply_core_contract_target_not_core_staging__ABORT');
  const rendered = renderAll(repo); // pins: migration bytes, ledger rows, apply SQL
  // Ledger shape gate (strategy A requires the hosted shape observed 2026-08-07).
  const shape = (await readRows(transport, pat, ref, LEDGER_SHAPE_SQL, { phase: 'ledger-shape' }))[0]?.shape ?? null;
  const shapeDiff = ledgerShapeDiff(shape);
  if (shapeDiff.length) fail(`ledger_shape_unexpected__${shapeDiff.join(' | ').slice(0, 300)}__ABORT`, { phase: 'ledger-shape' });
  const applied = [];
  for (const m of rendered) {
    const installedBefore = (await readRows(transport, pat, ref, m.probe, { phase: 'probe-before', version: m.version }))[0]?.installed === true;
    const ledgerBefore = ledgerState(await readRows(transport, pat, ref, ledgerRowsSql([m.version]), { phase: 'ledger-before', version: m.version }), m);
    const decision = applyDecision(installedBefore, ledgerBefore);
    const entry = { version: m.version, file: m.file, sha256: m.migration_sha256, apply_sql_sha256: m.apply_sql_sha256, apply_sql_bytes: m.apply_sql_bytes, ledger: { name: m.name, statements_count: m.row.statements_count, statements_digest: m.row.statements_digest, statements_bytes: m.row.statements_bytes }, installed_before: installedBefore, ledger_before: ledgerBefore, decision };
    if (decision.startsWith('STOP:')) fail(`${decision.slice(5)}_${m.version}__ABORT`, { phase: 'decision', version: m.version, installed_before: installedBefore, ledger_before: ledgerBefore });
    if (decision === 'skip') { applied.push({ ...entry, applied: false, installed_after: true, ledger_after: 'ours' }); continue; }
    if (dryRun === true) { applied.push({ ...entry, applied: false, dry_run: true }); continue; }
    const query = decision === 'apply' ? m.apply_sql : `begin;\n${ledgerInsertSql(m.row)}\ncommit;\n`;
    // The write itself. A transport failure here (idle_timeout, reset) is the ONE case where the server
    // may have committed without the client knowing: the detail says so, the caller must re-observe.
    const tag = { phase: decision === 'apply' ? 'apply' : 'reconcile-ledger', version: m.version, query_bytes: Buffer.byteLength(query), server_state_after_failure: 'UNKNOWN_reobserve_with_preflight_only' };
    let res;
    try { res = await transport({ pat, method: 'POST', reqPath: `/v1/projects/${ref}/database/query`, body: { query } }); } catch (error) { throw tagged(error, tag); }
    if (res.status !== 200 && res.status !== 201) fail(`apply_status_${res.status}_${path.basename(m.file)}_${(res.raw ?? '').slice(0, 200)}`, { ...tag, status: res.status, elapsed_ms: res.elapsed_ms ?? null });
    const applyElapsed = res.elapsed_ms ?? null;
    const after = { phase: 'post-apply', version: m.version, apply_status: res.status, apply_elapsed_ms: applyElapsed };
    const installedAfter = (await readRows(transport, pat, ref, m.probe, { ...after, phase: 'probe-after' }))[0]?.installed === true;
    const ledgerAfter = ledgerState(await readRows(transport, pat, ref, ledgerRowsSql([m.version]), { ...after, phase: 'ledger-after' }), m);
    if (!installedAfter) fail(`apply_not_effective_${path.basename(m.file)}__ABORT`, { ...after, installed_after: false, ledger_after: ledgerAfter });
    if (ledgerAfter !== 'ours') fail(`ledger_not_recorded_${m.version}_${ledgerAfter}__ABORT`, { ...after, installed_after: true, ledger_after: ledgerAfter });
    applied.push({ ...entry, applied: true, installed_after: true, ledger_after: 'ours', apply_status: res.status, apply_elapsed_ms: applyElapsed });
  }
  return { migrations: applied, ledger_shape_ok: true, ledger_strategy: 'A: INSERT INTO supabase_migrations.schema_migrations(version, name, statements) in the same transaction as the migration (CLI db push row shape; statements = parser.SplitAndTrim)' };
}

export async function run(request, transport = httpsRequest) {
  const { op, pat } = request ?? {};
  if (typeof pat !== 'string' || !PAT_PATTERN.test(pat)) fail('missing_or_malformed_pat');
  registerSecret(pat);
  assertNoProduction('token', pat);
  if (op === 'create-project') return opCreateProject(transport, pat, request);
  if (op === 'pooler') return opPooler(transport, pat, request);
  if (op === 'set-secrets') return opSetSecrets(transport, pat, request);
  if (op === 'deploy-function') return opDeployFunction(transport, pat, request);
  if (op === 'third-party-auth') return opThirdPartyAuth(transport, pat, request);
  if (op === 'apply-core-contract') return opApplyCoreContract(transport, pat, request);
  fail('unknown_op');
}

async function main() {
  const stdin = await new Promise((resolve) => { const chunks = []; process.stdin.on('data', (c) => chunks.push(c)); process.stdin.on('end', () => resolve(Buffer.concat(chunks).toString('utf8'))); });
  let request;
  try { request = JSON.parse(stdin); } catch { process.stdout.write('{"ok":false,"error":"stdin_not_json"}\n'); process.exit(1); }
  if (request?.pat) registerSecret(request.pat);
  if (request?.db_pass) registerSecret(request.db_pass);
  for (const s of request?.secrets ?? []) if (typeof s?.value === 'string') registerSecret(s.value);
  const startedAt = Date.now();
  const deadline = setTimeout(() => { process.stdout.write(JSON.stringify({ ok: false, op: request?.op ?? null, error: 'deadline_exceeded', detail: { deadline_ms: DEADLINE_MS, elapsed_ms: Date.now() - startedAt } }) + '\n'); process.exit(1); }, DEADLINE_MS);
  deadline.unref?.();
  try {
    const result = await run(request);
    clearTimeout(deadline);
    process.stdout.write(redact(JSON.stringify({ ok: true, op: request.op, ...result })) + '\n');
  } catch (error) {
    clearTimeout(deadline);
    // One line, always: the shell runner persists it verbatim (r3-failed-*.json) and exits with our status.
    process.stdout.write(redact(JSON.stringify({ ok: false, op: request?.op ?? null, error: error?.message ?? 'error', detail: error?.detail ?? null, elapsed_ms: Date.now() - startedAt })) + '\n');
    process.exit(1);
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
