#!/usr/bin/env node
// INFRA-0.5 — the certified signed harness (9 exact answers) against the Core PRODUCTION
// torneos-core-contract endpoint. The 9 requests are those of phase3b/remote/probe-core-contract.mjs
// (the harness that certified Staging on 2026-09-17: SIGNED_HARNESS_PASS 9/9); that module refuses
// Production by construction and is not modified, so the sequence is reproduced here with the endpoint
// fixed to Production and `sign` / `classify` / PROBE_EXPECT imported from the certified code. The tests
// prove request-for-request equality with the certified probe.
//
// Coverage (INFRA-0.5 mapping): auth required (1 unsigned), wrong HMAC (2 random key), stale time (3),
// correct HMAC reaching Core authority (4 → Core verdict 403 FORBIDDEN for a synthetic unknown session),
// replay (5), v1 route authority (6), malformed request after auth (7), unknown route (8), wrong method (9),
// fail-closed classification (503 CORE_UNAVAILABLE / 404 platform / SECRET_MISMATCH), and no sensitive
// material in any answer. Fixtures are random UUIDs and example.invalid — never a real user. The only rows
// the function writes are its own nonces (expire in 61 s). A 200 needs a live Core session of a real user,
// which Production does not get: the 200 path is certified by Staging D1 positive + the local E2E.
import { randomBytes, randomUUID } from 'node:crypto';
import { sign, classify } from '../../phase3b/remote/probe-core-contract.mjs';
import { PROBE_EXPECT, PROBE_HEADERS_EXPECTED, FUNCTION_SLUG } from '../../phase3b/remote/core-contract.mjs';
import { PROD_REF, SECRET_PATTERN } from './prod-contract.mjs';

export const PROD_ENDPOINT = `https://${PROD_REF}.supabase.co/functions/v1/${FUNCTION_SLUG}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const RETRY_VERDICTS = ['SECRET_NOT_CONFIGURED', 'SECRET_MISMATCH', 'FUNCTION_NOT_FOUND', 'CORE_UNAVAILABLE_ON_SIGNED_REQUEST'];

/** The 9 requests once — same order, paths, headers and bodies as the certified probeOnce. */
export async function probeOnceProd({ secret, fetchImpl = fetch, now = () => Math.floor(Date.now() / 1000) }) {
  const base = PROD_ENDPOINT;
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
  observed.push(await call('/v1/session', { body: sessionBody }));
  const signedOk = sign(secret, '/v1/session', Buffer.from(sessionBody));
  observed.push(await call('/v1/session', { body: sessionBody, headers: sign(randomBytes(32).toString('hex'), '/v1/session', Buffer.from(sessionBody)) }));
  observed.push(await call('/v1/session', { body: sessionBody, headers: sign(secret, '/v1/session', Buffer.from(sessionBody), { time: now() - 120 }) }));
  observed.push(await call('/v1/session', { body: sessionBody, headers: signedOk }));
  observed.push(await call('/v1/session', { body: sessionBody, headers: signedOk }));
  const emailBody = JSON.stringify({ ...session, expected_email: 'probe@example.invalid' });
  observed.push(await call('/v1/verified-email', { body: emailBody, headers: sign(secret, '/v1/verified-email', Buffer.from(emailBody)) }));
  const badBody = JSON.stringify({ core_user_id: session.core_user_id });
  observed.push(await call('/v1/session', { body: badBody, headers: sign(secret, '/v1/session', Buffer.from(badBody)) }));
  observed.push(await call('/v1/nope', { body: sessionBody, headers: sign(secret, '/v1/nope', Buffer.from(sessionBody)) }));
  observed.push(await call('/v1/session', { method: 'GET', headers: sign(secret, '/v1/session', Buffer.alloc(0)) }));
  const checks = PROBE_EXPECT.map((e, i) => {
    const o = observed[i];
    const bodyOk = JSON.stringify(o.body) === JSON.stringify(e.body);
    const headersOk = Object.entries(PROBE_HEADERS_EXPECTED).every(([k, v]) => typeof o.headers?.[k] === 'string' && o.headers[k].toLowerCase().startsWith(v));
    return { name: e.name, expected: { status: e.status, body: e.body }, observed: { status: o.status, body: o.body, raw: o.raw, headers: o.headers, transport_error: o.transport_error }, ok: o.status === e.status && bodyOk && headersOk };
  });
  return { checks, verdict: classify(observed, checks) };
}

export async function probeProd({ secret, retries = 0, interval_ms = 10000, fetchImpl, now }) {
  if (typeof secret !== 'string' || !SECRET_PATTERN.test(secret)) throw new Error('secret_malformed');
  const attempts = [];
  for (let i = 0; i <= retries; i += 1) {
    const r = await probeOnceProd({ secret, fetchImpl, now });
    attempts.push({ attempt: i + 1, at: new Date().toISOString(), verdict: r.verdict, failed: r.checks.filter((c) => !c.ok).map((c) => c.name) });
    if (!RETRY_VERDICTS.includes(r.verdict) || i === retries) return { endpoint: PROD_ENDPOINT, verdict: r.verdict, pass: r.verdict === 'SIGNED_HARNESS_PASS', checks: r.checks, attempts };
    await sleep(interval_ms);
  }
  throw new Error('unreachable');
}

/** An answer may carry exactly {error: <code>} and nothing that the request or the secret contained. */
export function responseSensitiveFindings(checks, { secret }) {
  const out = [];
  for (const c of checks ?? []) {
    const o = c.observed ?? {};
    const text = JSON.stringify({ body: o.body ?? null, raw: o.raw ?? null });
    if (typeof secret === 'string' && secret.length >= 8 && text.includes(secret)) out.push(`${c.name}: echoes the service secret`);
    if (o.body && (typeof o.body !== 'object' || Array.isArray(o.body) || Object.keys(o.body).join(',') !== 'error')) out.push(`${c.name}: body keys ${JSON.stringify(o.body && typeof o.body === 'object' ? Object.keys(o.body) : typeof o.body)}`);
    if (/x-signature|x-nonce|core_user_id|session_id|@|eyJ/i.test(text)) out.push(`${c.name}: echoes request material`);
  }
  return out;
}
