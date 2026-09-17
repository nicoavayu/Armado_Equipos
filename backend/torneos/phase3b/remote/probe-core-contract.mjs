#!/usr/bin/env node
// Phase 3B — R3 signed probe of the deployed `torneos-core-contract` Edge Function on Core
// staging (decision B.3, 2026-09-15): POSITIVE evidence, exact status + body per request, with
// the service secret from the Keychain (stdin only; never argv, env or disk; redacted from
// output). Reproducible: PROBE_EXPECT in core-contract.mjs is the contract; a run either matches
// every row exactly or classifies the failure:
//   SECRET_NOT_CONFIGURED  every request answers 503 CORE_UNAVAILABLE (function has no secret)
//   FUNCTION_NOT_FOUND     the platform answers 404 with a non-contract body (not deployed)
//   SECRET_MISMATCH        unsigned → 401 but a correctly signed request → 401 (Core holds
//                          another value than the Keychain)
//   FAIL                   any other exact mismatch
// `retries` re-runs the harness while the verdict is one of the first three (secret/deploy
// propagation), with a fresh nonce every time. No PAT here; no Core data is touched: the only
// writes the function performs are its own nonce rows, which expire in 61 s.
import process from 'node:process';
import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { PROD_REF, CORE_REF, FUNCTION_SLUG, PROBE_EXPECT, PROBE_HEADERS_EXPECTED } from './core-contract.mjs';

const SECRETS = [];
const redact = (t) => SECRETS.filter((s) => typeof s === 'string' && s.length >= 8).reduce((o, s) => o.split(s).join('«REDACTED»'), String(t));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function sign(secretHex, path, body, { time, nonce } = {}) {
  const t = String(time ?? Math.floor(Date.now() / 1000));
  const n = nonce ?? randomBytes(16).toString('hex');
  const signature = createHmac('sha256', Buffer.from(secretHex, 'hex')).update(`${path}\n${t}\n${n}\n`).update(body).digest('hex');
  return { 'x-time': t, 'x-nonce': n, 'x-signature': signature };
}

export function endpointFor(ref) {
  if (!/^[a-z]{20}$/.test(ref) || ref === PROD_REF) throw new Error('ref_invalid_or_production__ABORT');
  return `https://${ref}.supabase.co/functions/v1/${FUNCTION_SLUG}`;
}

/** Runs the 9 requests once. `fetchImpl` is injectable for the offline tests. */
export async function probeOnce({ ref, secret, fetchImpl = fetch, now = () => Math.floor(Date.now() / 1000) }) {
  const base = endpointFor(ref);
  const call = async (path, { method = 'POST', headers = {}, body } = {}) => {
    const payload = body === undefined ? undefined : Buffer.from(typeof body === 'string' ? body : JSON.stringify(body));
    let r;
    try {
      r = await fetchImpl(base + path, { method, headers: { ...(payload ? { 'content-type': 'application/json' } : {}), ...headers }, body: payload, redirect: 'manual', signal: AbortSignal.timeout(20000) });
    } catch (e) { return { status: 0, body: null, headers: {}, transport_error: String(e?.name ?? 'error') }; }
    const text = await r.text();
    let parsed = null; try { parsed = JSON.parse(text); } catch { parsed = null; }
    const h = {}; for (const k of Object.keys(PROBE_HEADERS_EXPECTED)) h[k] = r.headers.get(k);
    return { status: r.status, body: parsed, raw: parsed === null ? text.slice(0, 200) : undefined, headers: h };
  };
  const observed = [];
  const session = { core_user_id: randomUUID(), session_id: randomUUID() };
  const sessionBody = JSON.stringify(session);
  // 1. unsigned
  observed.push(await call('/v1/session', { body: sessionBody }));
  const signedOk = secret ? sign(secret, '/v1/session', Buffer.from(sessionBody)) : null;
  if (!secret) {
    return { checks: PROBE_EXPECT.map((e, i) => ({ name: e.name, expected: { status: e.status, body: e.body }, observed: observed[i] ?? { skipped: 'no secret' }, ok: false })), verdict: classify(observed, null) };
  }
  // 2. random key
  observed.push(await call('/v1/session', { body: sessionBody, headers: sign(randomBytes(32).toString('hex'), '/v1/session', Buffer.from(sessionBody)) }));
  // 3. stale time
  observed.push(await call('/v1/session', { body: sessionBody, headers: sign(secret, '/v1/session', Buffer.from(sessionBody), { time: now() - 120 }) }));
  // 4. signed, unknown session
  observed.push(await call('/v1/session', { body: sessionBody, headers: signedOk }));
  // 5. replay (identical headers + body)
  observed.push(await call('/v1/session', { body: sessionBody, headers: signedOk }));
  // 6. v1 route
  const emailBody = JSON.stringify({ ...session, expected_email: 'probe@example.invalid' });
  observed.push(await call('/v1/verified-email', { body: emailBody, headers: sign(secret, '/v1/verified-email', Buffer.from(emailBody)) }));
  // 7. malformed schema after auth
  const badBody = JSON.stringify({ core_user_id: session.core_user_id });
  observed.push(await call('/v1/session', { body: badBody, headers: sign(secret, '/v1/session', Buffer.from(badBody)) }));
  // 8. unknown route
  observed.push(await call('/v1/nope', { body: sessionBody, headers: sign(secret, '/v1/nope', Buffer.from(sessionBody)) }));
  // 9. GET
  observed.push(await call('/v1/session', { method: 'GET', headers: sign(secret, '/v1/session', Buffer.alloc(0)) }));
  const checks = PROBE_EXPECT.map((e, i) => {
    const o = observed[i];
    const bodyOk = JSON.stringify(o.body) === JSON.stringify(e.body);
    const headersOk = Object.entries(PROBE_HEADERS_EXPECTED).every(([k, v]) => typeof o.headers?.[k] === 'string' && o.headers[k].toLowerCase().startsWith(v));
    return { name: e.name, expected: { status: e.status, body: e.body }, observed: { status: o.status, body: o.body, raw: o.raw, headers: o.headers, transport_error: o.transport_error }, ok: o.status === e.status && bodyOk && headersOk };
  });
  return { checks, verdict: classify(observed, checks) };
}

export function classify(observed, checks) {
  const first = observed[0];
  if (!first || first.status === 0) return 'UNREACHABLE';
  if (first.status === 503 && first.body?.error === 'CORE_UNAVAILABLE') return 'SECRET_NOT_CONFIGURED';
  if (first.status === 404 && first.body?.error !== 'NOT_FOUND') return 'FUNCTION_NOT_FOUND';
  if (!checks) return 'NO_SECRET_GIVEN';
  if (checks.every((c) => c.ok)) return 'SIGNED_HARNESS_PASS';
  const signed = observed[3];
  if (first.status === 401 && signed?.status === 401 && signed?.body?.error === 'SERVICE_AUTH_REQUIRED') return 'SECRET_MISMATCH';
  if (signed?.status === 503) return 'CORE_UNAVAILABLE_ON_SIGNED_REQUEST';
  return 'FAIL';
}

export async function probe({ ref, secret, retries = 0, interval_ms = 10000, fetchImpl, now }) {
  const attempts = [];
  for (let i = 0; i <= retries; i += 1) {
    const r = await probeOnce({ ref, secret, fetchImpl, now });
    attempts.push({ attempt: i + 1, at: new Date().toISOString(), verdict: r.verdict, failed: r.checks.filter((c) => !c.ok).map((c) => c.name) });
    if (!['SECRET_NOT_CONFIGURED', 'SECRET_MISMATCH', 'FUNCTION_NOT_FOUND', 'CORE_UNAVAILABLE_ON_SIGNED_REQUEST'].includes(r.verdict) || i === retries) {
      return { ref, endpoint: endpointFor(ref), secret_given: Boolean(secret), verdict: r.verdict, pass: r.verdict === 'SIGNED_HARNESS_PASS', checks: r.checks, attempts };
    }
    await sleep(interval_ms);
  }
  throw new Error('unreachable');
}

async function main() {
  const stdin = await new Promise((resolve) => { const chunks = []; process.stdin.on('data', (c) => chunks.push(c)); process.stdin.on('end', () => resolve(Buffer.concat(chunks).toString('utf8'))); });
  let request;
  try { request = JSON.parse(stdin); } catch { process.stdout.write('{"ok":false,"error":"stdin_not_json"}\n'); process.exit(1); }
  if (typeof request.secret === 'string') { if (!/^[0-9a-f]{64,}$/.test(request.secret)) { process.stdout.write('{"ok":false,"error":"secret_malformed"}\n'); process.exit(1); } SECRETS.push(request.secret); }
  try {
    const result = await probe({ ref: request.ref ?? CORE_REF, secret: typeof request.secret === 'string' ? request.secret : null, retries: Number(request.retries ?? 0), interval_ms: Number(request.interval_ms ?? 10000) });
    process.stdout.write(redact(JSON.stringify({ ok: true, ...result })) + '\n');
    process.exit(result.pass ? 0 : 3);
  } catch (error) {
    process.stdout.write(redact(JSON.stringify({ ok: false, error: error?.message ?? 'error' })) + '\n');
    process.exit(1);
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
