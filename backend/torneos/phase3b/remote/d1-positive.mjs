#!/usr/bin/env node
// Phase 3B — D1 POSITIVE test on Core staging (decision C, 2026-09-15): a DEDICATED QA user
// logs in through GoTrue, the deployed contract answers `/v1/session` 200 {active:true} for that
// live session, the user logs out (scope=local: only this session), and the same request now
// answers 403 FORBIDDEN. The shell runner then verifies through a read-only probe that the
// session row is gone and the user's session count is back to the pre-test value.
//
// Input (stdin JSON, never argv/env/disk): { ref, anon_key, email, password, secret }.
// The anon key is a public key but is still typed on /dev/tty and validated here: its JWT payload
// must carry ref == Core staging and role == anon (Production refused). Output: one sanitized
// JSON document — no password, no token, no refresh token; the session id (of a session that
// no longer exists) is emitted in full ONLY so the runner can prove its deletion, and the runner
// masks it in the evidence. No profile/team/business data is read or written: the calls are
// GoTrue token + logout and the contract `session` operation (which writes only its own
// 61-second nonce rows).
import process from 'node:process';
import { pathToFileURL } from 'node:url';
import { PROD_REF, CORE_REF } from './core-contract.mjs';
import { sign, endpointFor } from './probe-core-contract.mjs';

const SECRETS = [];
const redact = (t) => SECRETS.filter((s) => typeof s === 'string' && s.length >= 8).reduce((o, s) => o.split(s).join('«REDACTED»'), String(t));
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export const decodeJwt = (jwt) => { try { return JSON.parse(Buffer.from(String(jwt).split('.')[1], 'base64url').toString('utf8')); } catch { return null; } };

export function assertAnonKey(anonKey, ref) {
  const claims = decodeJwt(anonKey);
  if (!claims || claims.role !== 'anon') throw new Error('anon_key_role_not_anon__ABORT');
  if (claims.ref !== ref) throw new Error('anon_key_ref_mismatch__ABORT');
  if (claims.ref === PROD_REF || String(anonKey).includes(PROD_REF)) throw new Error('anon_key_is_production__ABORT');
  return claims;
}

export async function runD1Positive({ ref = CORE_REF, anon_key, email, password, secret, fetchImpl = fetch }) {
  if (!/^[a-z]{20}$/.test(ref) || ref === PROD_REF) throw new Error('ref_invalid_or_production__ABORT');
  if (typeof secret !== 'string' || !/^[0-9a-f]{64,}$/.test(secret)) throw new Error('secret_malformed__ABORT');
  if (typeof email !== 'string' || !/^[^\s@]+@[^\s@]+$/.test(email)) throw new Error('email_malformed__ABORT');
  if (typeof password !== 'string' || password.length < 8) throw new Error('password_malformed__ABORT');
  assertAnonKey(anon_key, ref);
  const CORE = `https://${ref}.supabase.co`;
  const contract = endpointFor(ref);
  const steps = [];
  const call = async (url, { method = 'POST', headers = {}, body } = {}) => {
    const payload = body === undefined ? undefined : Buffer.from(typeof body === 'string' ? body : JSON.stringify(body));
    const r = await fetchImpl(url, { method, headers: { ...(payload ? { 'content-type': 'application/json' } : {}), ...headers }, body: payload, redirect: 'manual', signal: AbortSignal.timeout(20000) });
    const text = await r.text();
    let parsed = null; try { parsed = JSON.parse(text); } catch { parsed = null; }
    return { status: r.status, body: parsed };
  };
  // 1. GoTrue password grant (the QA user's own credentials, typed by the operator).
  const tok = await call(`${CORE}/auth/v1/token?grant_type=password`, { headers: { apikey: anon_key }, body: { email, password } });
  if (tok.status !== 200 || typeof tok.body?.access_token !== 'string') {
    steps.push({ step: 'gotrue login', status: tok.status, ok: false, error: tok.body?.error_code ?? tok.body?.error ?? tok.body?.msg ?? null });
    return { ref, steps, pass: false, verdict: 'LOGIN_FAILED' };
  }
  const accessToken = tok.body.access_token; SECRETS.push(accessToken); if (tok.body.refresh_token) SECRETS.push(tok.body.refresh_token);
  const claims = decodeJwt(accessToken) ?? {};
  const coreUserId = claims.sub; const sessionId = claims.session_id;
  if (!UUID.test(coreUserId ?? '') || !UUID.test(sessionId ?? '')) throw new Error('login_claims_unexpected__ABORT');
  if (claims.is_anonymous === true) throw new Error('qa_user_is_anonymous__ABORT');
  steps.push({ step: 'gotrue login', status: 200, ok: true, role: claims.role, aud: claims.aud, session_id_claim: true, user_id_prefix: coreUserId.slice(0, 8) });
  // 2. Contract verdict for the live session.
  const body = JSON.stringify({ core_user_id: coreUserId, session_id: sessionId });
  const live = await call(`${contract}/v1/session`, { body, headers: sign(secret, '/v1/session', Buffer.from(body)) });
  const liveOk = live.status === 200 && live.body?.active === true && Number.isInteger(live.body?.checked_at) && Object.keys(live.body).sort().join(',') === 'active,checked_at';
  steps.push({ step: 'contract /v1/session (live session)', status: live.status, body: live.body, ok: liveOk });
  // 3. Logout THIS session only.
  const lo = await call(`${CORE}/auth/v1/logout?scope=local`, { headers: { apikey: anon_key, authorization: `Bearer ${accessToken}` } });
  steps.push({ step: 'gotrue logout (scope=local)', status: lo.status, ok: lo.status === 204 });
  // 4. Same request after logout: the Core verdict must be FORBIDDEN (fresh nonce, same session).
  const after = await call(`${contract}/v1/session`, { body, headers: sign(secret, '/v1/session', Buffer.from(body)) });
  const afterOk = after.status === 403 && JSON.stringify(after.body) === JSON.stringify({ error: 'FORBIDDEN' });
  steps.push({ step: 'contract /v1/session (after logout)', status: after.status, body: after.body, ok: afterOk });
  const pass = steps.every((s) => s.ok);
  return { ref, steps, pass, verdict: pass ? 'D1_POSITIVE_PASS' : 'D1_POSITIVE_FAIL', core_user_id: coreUserId, session_id: sessionId };
}

async function main() {
  const stdin = await new Promise((resolve) => { const chunks = []; process.stdin.on('data', (c) => chunks.push(c)); process.stdin.on('end', () => resolve(Buffer.concat(chunks).toString('utf8'))); });
  let request;
  try { request = JSON.parse(stdin); } catch { process.stdout.write('{"ok":false,"error":"stdin_not_json"}\n'); process.exit(1); }
  for (const k of ['password', 'secret', 'anon_key']) if (typeof request?.[k] === 'string') SECRETS.push(request[k]);
  try {
    const result = await runD1Positive(request);
    process.stdout.write(redact(JSON.stringify({ ok: true, ...result })) + '\n');
    process.exit(result.pass ? 0 : 3);
  } catch (error) {
    process.stdout.write(redact(JSON.stringify({ ok: false, error: error?.message ?? 'error' })) + '\n');
    process.exit(1);
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
