#!/usr/bin/env node
// INFRA-0.5 — the ONLY transport the Core PRODUCTION contract tooling uses. The mirror image of
// phase3b/remote/mgmt.mjs + mgmt-write.mjs (which refuse Production by construction and stay
// untouched): here the project is fixed to rcyuuoaqfwcembdajcss and everything else is refused.
//
// The request surface is closed. Reads:
//   GET  /v1/projects/{prod}                                   project identity + status
//   GET  /v1/projects/{prod}/secrets                           secret NAMES (values are never projected)
//   GET  /v1/projects/{prod}/functions/torneos-core-contract    function metadata
//   POST /v1/projects/{prod}/database/query  {read_only:true}  one SELECT (certified read-only guard)
// Writes — only after the client was armed by the runner (post confirmation phrase), and only:
//   POST …/database/query {read_only:false}  WRITER_CONTEXT_SQL (a SELECT) or one of the TWO pinned
//        apply documents (sha256 ∈ AUTHORIZED_APPLY_SQL_SHA256). No ledger-only INSERT, no other SQL.
//   POST …/secrets                           exactly [{name: TORNEOS_CONTRACT_SERVICE_SECRET, value: 64 hex}]
//   POST …/functions/deploy?slug=torneos-core-contract   the multipart body of the pinned artifact
// Staging (or any other ref) in the path, body or token is refused. Redirects are refused. The PAT and
// the contract secret never reach argv, env, disk or output; errors are redacted.
import https from 'node:https';
import crypto from 'node:crypto';
import { assertReadOnlySql, API_HOST, PAT_PATTERN, projectFunction } from '../../phase3b/remote/mgmt.mjs';
import { WRITER_CONTEXT_SQL, buildDeployBody } from '../../phase3b/remote/mgmt-write.mjs';
import { LEDGER_SHAPE_SQL, WRITER_PRIVILEGES_SQL, CONTRACT_ACL_SQL } from '../../phase3b/remote/core-contract.mjs';
import * as P from './prod-contract.mjs';

export class ProdRequestError extends Error {
  constructor(code, detail) { super(code); this.code = code; if (detail !== undefined) this.detail = detail; }
}
const REDACT = [];
const redact = (t) => REDACT.filter((s) => typeof s === 'string' && s.length >= 8).reduce((o, s) => o.split(s).join('«REDACTED»'), String(t));
function fail(code, detail) { throw new ProdRequestError(redact(code), detail); }
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');

const BASE = `/v1/projects/${P.PROD_REF}`;
export const PATHS = Object.freeze({
  project: BASE,
  secrets: `${BASE}/secrets`,
  fn: `${BASE}/functions/${P.FUNCTION_ARTIFACT.slug}`,
  query: `${BASE}/database/query`,
  deploy: `${BASE}/functions/deploy?slug=${P.FUNCTION_ARTIFACT.slug}`,
});
const READ_GETS = new Set([PATHS.project, PATHS.secrets, PATHS.fn]);

/** Classifies one request as read | write-* or throws. `armed` is the runner's post-confirmation state. */
export function assertProdRequest({ method, path, body, armed = false }) {
  if (typeof path !== 'string') fail('path_missing__ABORT');
  if (path.includes(P.STAGING_REF)) fail('staging_ref_in_path__ABORT');
  const m = /^\/v1\/projects\/([^/?]+)(?:[/?]|$)/.exec(path);
  if (!m) fail('path_not_a_production_project_path__ABORT');
  try { P.assertProductionRef(m[1]); } catch (e) { fail(`path_${e.message}`); }
  const bodyText = body === undefined ? '' : (Buffer.isBuffer(body) ? body.toString('latin1') : JSON.stringify(body));
  if (bodyText.includes(P.STAGING_REF)) fail('staging_ref_in_body__ABORT');
  if (method === 'GET') {
    if (!READ_GETS.has(path)) fail('get_path_not_allowed__ABORT');
    if (body !== undefined) fail('get_with_body__ABORT');
    return 'read';
  }
  if (method !== 'POST') fail(`method_not_allowed_${method}__ABORT`);
  if (path === PATHS.query) {
    if (!body || typeof body.query !== 'string' || Object.keys(body).sort().join(',') !== 'query,read_only') fail('query_body_malformed__ABORT');
    if (body.read_only === true) {
      try { assertReadOnlySql(body.query); } catch (e) { fail(`read_only_guard_${e.message}`); }
      return 'read';
    }
    if (body.read_only !== false) fail('read_only_flag_required__ABORT');
    if (armed !== true) fail('write_not_armed__ABORT');
    if (body.query === WRITER_CONTEXT_SQL) return 'write-context';
    if (!P.AUTHORIZED_APPLY_SQL_SHA256.has(sha(body.query))) fail('write_sql_not_pinned__ABORT');
    return 'write-sql';
  }
  if (path === PATHS.secrets) {
    if (armed !== true) fail('write_not_armed__ABORT');
    if (!Array.isArray(body) || body.length !== 1) fail('secrets_body_must_be_one_entry__ABORT');
    const [s] = body;
    if (!s || typeof s !== 'object' || Object.keys(s).sort().join(',') !== 'name,value' || s.name !== P.SECRET_NAME || !P.SECRET_PATTERN.test(s.value)) fail('secrets_body_not_the_contract_secret__ABORT');
    return 'write-secret';
  }
  if (path === PATHS.deploy) {
    if (armed !== true) fail('write_not_armed__ABORT');
    if (!Buffer.isBuffer(body)) fail('deploy_body_must_be_multipart__ABORT');
    return 'write-deploy';
  }
  fail('path_not_allowed__ABORT');
}

/** node:https to api.supabase.com, re-checking the envelope; no redirects; idle timeout. */
export function httpsTransport({ pat, method, path, body, contentType = 'application/json', armed = false }) {
  assertProdRequest({ method, path, body, armed });
  const payload = body === undefined ? null : (Buffer.isBuffer(body) ? body : Buffer.from(JSON.stringify(body)));
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const headers = { Authorization: `Bearer ${pat}`, Accept: 'application/json', 'User-Agent': 'arma2-torneos-core-prod-contract/1' };
    if (payload !== null) { headers['Content-Type'] = contentType; headers['Content-Length'] = payload.length; }
    const req = https.request({ host: API_HOST, servername: API_HOST, port: 443, method, path, headers, rejectUnauthorized: true, minVersion: 'TLSv1.2' }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400) { res.resume(); reject(new ProdRequestError(`redirect_refused_status_${res.statusCode}__ABORT`)); return; }
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let parsed = null; try { parsed = text ? JSON.parse(text) : null; } catch { parsed = null; }
        resolve({ status: res.statusCode, body: parsed, raw: redact(text).slice(0, 300), elapsed_ms: Date.now() - started });
      });
    });
    req.setTimeout(20000, () => req.destroy(new Error('idle_timeout')));
    req.on('error', (err) => reject(new ProdRequestError(redact(`request_failed_${err.message}`), { method, path, code: err.code ?? null, elapsed_ms: Date.now() - started })));
    if (payload !== null) req.write(payload);
    req.end();
  });
}

function projectProject(b) {
  if (!b || typeof b !== 'object') return null;
  return { ref: b.ref ?? b.id ?? null, name: b.name ?? null, organization_slug: b.organization_slug ?? b.organization_id ?? null, region: b.region ?? null, status: b.status ?? null, created_at: b.created_at ?? null, database_version: b.database?.version ?? null };
}

/** The Production client. Read ops are always available; write ops only after arm(). */
export function prodClient({ pat, transport = httpsTransport }) {
  if (typeof pat !== 'string' || !PAT_PATTERN.test(pat)) fail('pat_missing_or_malformed__ABORT');
  if (pat.includes(P.STAGING_REF) || pat.includes(P.PROD_REF)) fail('pat_carries_a_project_ref_staging_or_production__ABORT');
  REDACT.push(pat);
  const state = { armed: false, writes: [] };
  const send = async (req) => {
    const kind = assertProdRequest({ ...req, armed: state.armed });
    if (kind !== 'read') {
      const bytes = Buffer.isBuffer(req.body) ? req.body : Buffer.from(JSON.stringify(req.body));
      state.writes.push({ kind, method: req.method, path: req.path, bytes: bytes.length, body_sha256: kind === 'write-secret' ? 'withheld (secret)' : sha(bytes) });
    }
    return transport({ pat, armed: state.armed, ...req });
  };
  const rows = async (query) => {
    const res = await send({ method: 'POST', path: PATHS.query, body: { query, read_only: true } });
    if (res.status !== 200 && res.status !== 201) fail(`query_status_${res.status}`, { status: res.status, message: typeof res.body?.message === 'string' ? redact(res.body.message).slice(0, 200) : null });
    // Same two answer shapes the certified Staging reader accepts (mgmt.mjs readSql); anything else is ambiguous.
    const list = Array.isArray(res.body) ? res.body : (Array.isArray(res.body?.result) ? res.body.result : null);
    if (!list) fail('query_answer_ambiguous__not_rows');
    return list;
  };
  const one = async (query, key) => {
    const r = await rows(query);
    if (r.length !== 1 || !r[0] || typeof r[0] !== 'object' || !(key in r[0])) fail(`query_answer_ambiguous__${key}`);
    return r[0][key];
  };
  return {
    get armed() { return state.armed; },
    get writes() { return state.writes.slice(); },
    arm() { state.armed = true; },
    registerSecret(v) { if (typeof v === 'string') REDACT.push(v); },
    async project() {
      const res = await send({ method: 'GET', path: PATHS.project });
      if (res.status !== 200) fail(`project_status_${res.status}`);
      return projectProject(res.body);
    },
    async ledger() {
      const shape = await one(LEDGER_SHAPE_SQL, 'shape');
      const all = await rows(P.LEDGER_ALL_ROWS_SQL);
      const writer = await one(WRITER_PRIVILEGES_SQL, 'writer');
      return { shape, rows: all, writer };
    },
    async installed() {
      const out = {};
      for (const m of P.AUTHORIZED_MIGRATIONS) {
        const v = await one(m.probe, 'installed');
        if (typeof v !== 'boolean') fail(`query_answer_ambiguous__installed_${m.version}`);
        out[m.version] = v;
      }
      return out;
    },
    prerequisites: () => one(P.PREREQUISITES_SQL, 'prerequisites'),
    appPrivate: () => one(P.APP_PRIVATE_SQL, 'app_private'),
    catalog: () => one(P.CATALOG_DIGEST_SQL, 'catalog'),
    acl: () => one(CONTRACT_ACL_SQL, 'acl'),
    async secretNames() {
      const res = await send({ method: 'GET', path: PATHS.secrets });
      if (res.status !== 200 || !Array.isArray(res.body)) fail(`secrets_status_${res.status}`);
      return res.body.map((s) => (typeof s?.name === 'string' ? s.name : null)).filter(Boolean).sort(); // names only, values dropped here
    },
    async fn() {
      const res = await send({ method: 'GET', path: PATHS.fn });
      if (res.status === 404) return null;
      if (res.status !== 200 || !res.body || typeof res.body !== 'object') fail(`function_status_${res.status}`);
      return projectFunction(res.body);
    },
    // ── writes (armed only) ──
    async writerContext() {
      const res = await send({ method: 'POST', path: PATHS.query, body: { query: WRITER_CONTEXT_SQL, read_only: false } });
      const o = (Array.isArray(res.body) ? res.body : (Array.isArray(res.body?.result) ? res.body.result : []))[0] ?? null;
      if (![200, 201].includes(res.status) || o?.api_role !== 'postgres' || o?.transaction_read_only !== 'off' || o?.in_recovery !== false) fail('effective_writer_unavailable__check_PAT_database_write_permission__ABORT', { status: res.status, observed: o ?? null });
      return o;
    },
    async applyMigration(m) {
      const res = await send({ method: 'POST', path: PATHS.query, body: { query: m.apply_sql, read_only: false } });
      if (res.status !== 200 && res.status !== 201) fail(`apply_status_${res.status}_${m.version}`, { version: m.version, status: res.status, raw: typeof res.raw === 'string' ? redact(res.raw).slice(0, 200) : null, elapsed_ms: res.elapsed_ms ?? null, server_state_after_failure: 'UNKNOWN_reobserve_with_preflight_only' });
      return { status: res.status, elapsed_ms: res.elapsed_ms ?? null };
    },
    async setSecret(value) {
      REDACT.push(value);
      const res = await send({ method: 'POST', path: PATHS.secrets, body: [{ name: P.SECRET_NAME, value }] });
      if (res.status !== 200 && res.status !== 201) fail(`set_secrets_status_${res.status}`);
      return { wrote: [P.SECRET_NAME] };
    },
    async deploy(files) {
      const { boundary, body, metadata } = buildDeployBody(P.FUNCTION_ARTIFACT.slug, P.FUNCTION_ARTIFACT.entrypoint, P.FUNCTION_ARTIFACT.verify_jwt, files);
      const res = await send({ method: 'POST', path: PATHS.deploy, body, contentType: `multipart/form-data; boundary=${boundary}` });
      if (res.status !== 200 && res.status !== 201) fail(`deploy_status_${res.status}`, { raw: typeof res.raw === 'string' ? redact(res.raw).slice(0, 200) : null });
      return { fn: projectFunction(res.body), metadata, body_bytes: body.length };
    },
  };
}
