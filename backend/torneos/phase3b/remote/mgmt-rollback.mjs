#!/usr/bin/env node
// Phase 3B — R3 ROLLBACK operations (decision E, 2026-09-15). Kept apart from mgmt-write.mjs
// (which never sends DELETE) and from mgmt.mjs (read-only). Target HARDCODED to Core staging;
// Production denylisted in host/path/body/token; exactly three request shapes can leave here:
//
//   rollback-sql     POST   /v1/projects/hhyvmhgpapyuzjgxfnqv/database/query   (the pinned
//                    contracts/core-contract-rollback.sql, sha256 checked, ONE transaction with
//                    its own pre/post guards; never any other SQL)
//   delete-function  DELETE /v1/projects/hhyvmhgpapyuzjgxfnqv/functions/torneos-core-contract
//   delete-secret    DELETE /v1/projects/hhyvmhgpapyuzjgxfnqv/secrets  body ["TORNEOS_CONTRACT_SERVICE_SECRET"]
//
// Nothing here can drop schema app_private, touch Core tables, tournament_* history, cron,
// storage or auth users: the SQL is a pinned file with no such statement, and the two DELETEs
// name one function slug and one secret name. The Keychain entry is NOT deleted (keychain.py has
// no delete; a later re-apply reconciles the same value onto Core).
import https from 'node:https';
import process from 'node:process';
import { pathToFileURL } from 'node:url';
import { API_HOST, PAT_PATTERN, AbortError, assertNoProduction, redact, registerSecret, assertReadOnlySql } from './mgmt.mjs';
import { CORE_REF, FUNCTION_SLUG, SECRET_NAME, MIGRATIONS, loadRollbackSql, ledgerRowsSql, CONTRACT_ACL_SQL, rollbackResidue } from './core-contract.mjs';

const CONNECT_TIMEOUT_MS = 20000;
const DEADLINE_MS = 180000;
function fail(error) { throw new AbortError(redact(error)); }

export const ALLOWED = [
  { method: 'POST', reqPath: `/v1/projects/${CORE_REF}/database/query` },
  { method: 'DELETE', reqPath: `/v1/projects/${CORE_REF}/functions/${FUNCTION_SLUG}` },
  { method: 'DELETE', reqPath: `/v1/projects/${CORE_REF}/secrets` },
];
export function assertRollbackPath(method, reqPath) {
  assertNoProduction('path', reqPath);
  if (!ALLOWED.some((a) => a.method === method && a.reqPath === reqPath)) fail(`rollback_request_not_allowed_${method}_${reqPath}__ABORT`);
}

export function httpsRequest({ pat, method, reqPath, body }) {
  assertNoProduction('token', pat);
  assertRollbackPath(method, reqPath);
  const payload = body === undefined ? null : Buffer.from(JSON.stringify(body));
  if (payload !== null) assertNoProduction('body', payload.toString('latin1'));
  return new Promise((resolve, reject) => {
    const headers = { Authorization: `Bearer ${pat}`, Accept: 'application/json', 'User-Agent': 'arma2-torneos-phase3b-rollback/1' };
    if (payload !== null) { headers['Content-Type'] = 'application/json'; headers['Content-Length'] = payload.length; }
    const req = https.request({ host: API_HOST, servername: API_HOST, port: 443, method, path: reqPath, headers, rejectUnauthorized: true, minVersion: 'TLSv1.2' }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400) { res.resume(); reject(new AbortError(`redirect_refused_status_${res.statusCode}__ABORT`)); return; }
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let parsed = null; try { parsed = text ? JSON.parse(text) : null; } catch { parsed = null; }
        resolve({ status: res.statusCode, body: parsed, raw: text });
      });
    });
    req.setTimeout(CONNECT_TIMEOUT_MS, () => req.destroy(new Error('idle_timeout')));
    req.on('error', (err) => reject(new AbortError(`request_failed_${err.message}`)));
    if (payload !== null) req.write(payload);
    req.end();
  });
}

async function readRows(transport, pat, query) {
  assertReadOnlySql(query);
  const res = await transport({ pat, method: 'POST', reqPath: `/v1/projects/${CORE_REF}/database/query`, body: { query, read_only: true } });
  if (res.status !== 200 && res.status !== 201) fail(`probe_status_${res.status}`);
  return Array.isArray(res.body) ? res.body : (res.body?.result ?? []);
}

/** The pinned rollback SQL, one transaction. Before: ledger rows must be absent or ours (the SQL re-checks). After: no residue. */
export async function opRollbackSql(transport, pat, { ref, dryRun }) {
  if (ref !== CORE_REF) fail('rollback_target_not_core_staging__ABORT');
  const { text, sha256 } = loadRollbackSql();
  const rowsBefore = await readRows(transport, pat, ledgerRowsSql(MIGRATIONS.map((m) => m.version)));
  const foreign = rowsBefore.filter((r) => { const m = MIGRATIONS.find((x) => x.version === r.version); return !m || r.statements_digest !== m.ledger_digest; });
  if (foreign.length) fail(`ledger_rows_not_ours_${foreign.map((r) => r.version).join('_')}__ABORT`);
  const aclBefore = (await readRows(transport, pat, CONTRACT_ACL_SQL))[0]?.acl ?? null;
  if (dryRun === true) return { dryRun: true, rollback_sql_sha256: sha256, rollback_sql_bytes: Buffer.byteLength(text, 'utf8'), ledger_rows_before: rowsBefore.map((r) => r.version), acl_before: aclBefore };
  const res = await transport({ pat, method: 'POST', reqPath: `/v1/projects/${CORE_REF}/database/query`, body: { query: text, read_only: false } });
  if (res.status !== 200 && res.status !== 201) fail(`rollback_sql_status_${res.status}_${(res.raw ?? '').slice(0, 200)}`);
  const aclAfter = (await readRows(transport, pat, CONTRACT_ACL_SQL))[0]?.acl ?? null;
  const residue = rollbackResidue(aclAfter);
  if (residue.length) fail(`rollback_residue_${residue.join(' | ').slice(0, 200)}__ABORT`);
  const rowsAfter = await readRows(transport, pat, ledgerRowsSql(MIGRATIONS.map((m) => m.version)));
  if (rowsAfter.length) fail('rollback_ledger_rows_left__ABORT');
  return { rolled_back: true, rollback_sql_sha256: sha256, ledger_rows_before: rowsBefore.map((r) => r.version), ledger_rows_after: [], acl_after: aclAfter };
}
export async function opDeleteFunction(transport, pat, { ref, dryRun }) {
  if (ref !== CORE_REF) fail('rollback_target_not_core_staging__ABORT');
  if (dryRun === true) return { dryRun: true, would_delete: FUNCTION_SLUG };
  const res = await transport({ pat, method: 'DELETE', reqPath: `/v1/projects/${CORE_REF}/functions/${FUNCTION_SLUG}` });
  if (res.status === 404) return { deleted: false, absent: true, slug: FUNCTION_SLUG };
  if (res.status !== 200 && res.status !== 204) fail(`delete_function_status_${res.status}_${(res.raw ?? '').slice(0, 200)}`);
  return { deleted: true, slug: FUNCTION_SLUG };
}
export async function opDeleteSecret(transport, pat, { ref, dryRun }) {
  if (ref !== CORE_REF) fail('rollback_target_not_core_staging__ABORT');
  if (dryRun === true) return { dryRun: true, would_delete: SECRET_NAME };
  const res = await transport({ pat, method: 'DELETE', reqPath: `/v1/projects/${CORE_REF}/secrets`, body: [SECRET_NAME] });
  if (res.status !== 200 && res.status !== 204) fail(`delete_secret_status_${res.status}_${(res.raw ?? '').slice(0, 200)}`);
  return { deleted: true, name: SECRET_NAME };
}

export async function run(request, transport = httpsRequest) {
  const { op, pat } = request ?? {};
  if (typeof pat !== 'string' || !PAT_PATTERN.test(pat)) fail('missing_or_malformed_pat');
  registerSecret(pat);
  assertNoProduction('token', pat);
  if (op === 'rollback-sql') return opRollbackSql(transport, pat, request);
  if (op === 'delete-function') return opDeleteFunction(transport, pat, request);
  if (op === 'delete-secret') return opDeleteSecret(transport, pat, request);
  fail('unknown_op');
}

async function main() {
  const stdin = await new Promise((resolve) => { const chunks = []; process.stdin.on('data', (c) => chunks.push(c)); process.stdin.on('end', () => resolve(Buffer.concat(chunks).toString('utf8'))); });
  let request;
  try { request = JSON.parse(stdin); } catch { process.stdout.write('{"ok":false,"error":"stdin_not_json"}\n'); process.exit(1); }
  if (request?.pat) registerSecret(request.pat);
  const deadline = setTimeout(() => { process.stdout.write('{"ok":false,"error":"deadline_exceeded"}\n'); process.exit(1); }, DEADLINE_MS);
  deadline.unref?.();
  try {
    const result = await run(request);
    process.stdout.write(redact(JSON.stringify({ ok: true, op: request.op, ...result })) + '\n');
  } catch (error) {
    process.stdout.write(redact(JSON.stringify({ ok: false, error: error?.message ?? 'error' })) + '\n');
    process.exit(1);
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
