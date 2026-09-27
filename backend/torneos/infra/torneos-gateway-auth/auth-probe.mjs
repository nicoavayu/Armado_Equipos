// GATEWAY/AUTH W1 — GoTrue refusal probes of the locked Torneos Auth. Run by --auth-lockdown ONLY after the Management
// API shows the lockdown applied and nothing else failed.
//
// Host: exactly https://<torneos ref>.supabase.co/auth/v1/{settings,signup,otp}. The anon-level key is the project's
// publishable (or legacy anon) key: public by design, never written to evidence. The addresses are an `.invalid` email
// and a non-assignable number, so even an unexpected acceptance cannot reach a person; the first 2xx stops the probes.
//   GET  /settings                          → 200, disable_signup true, external email/phone/anonymous false
//   POST /signup {email, password}          → refused (4xx, not 429)
//   POST /signup {}  (anonymous)            → refused
//   POST /otp {email, create_user: true}    → refused
//   POST /otp {phone, create_user: true}    → refused
import https from 'node:https';
import crypto from 'node:crypto';
import { TORNEOS_REF } from './gateway-auth-contract.mjs';

export const REFUSAL_CODES = Object.freeze(['signup_disabled', 'email_provider_disabled', 'phone_provider_disabled', 'anonymous_provider_disabled', 'otp_disabled', 'provider_disabled']);

export function assertAuthProbeTarget(ref, method, reqPath) {
  if (ref !== TORNEOS_REF) throw new Error('auth_probe_ref_invalid');
  const ok = (method === 'GET' && reqPath === '/auth/v1/settings') || (method === 'POST' && ['/auth/v1/signup', '/auth/v1/otp'].includes(reqPath));
  if (!ok) throw new Error(`auth_probe_target_refused ${method} ${reqPath}`);
}

export function httpsAuthProbeTransport({ ref, method, path: reqPath, headers, body }) {
  assertAuthProbeTarget(ref, method, reqPath);
  const host = `${ref}.supabase.co`;
  const payload = body === undefined ? null : Buffer.from(JSON.stringify(body));
  return new Promise((resolve, reject) => {
    const h = { Accept: 'application/json', 'User-Agent': 'arma2-torneos-gateway-auth-probe/1', ...headers };
    if (payload) { h['Content-Type'] = 'application/json'; h['Content-Length'] = payload.length; }
    const req = https.request({ host, servername: host, port: 443, method, path: reqPath, headers: h, rejectUnauthorized: true, minVersion: 'TLSv1.2' }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400) { res.resume(); resolve({ status: res.statusCode, body: null, redirect: true }); return; }
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => { const raw = Buffer.concat(chunks).toString('utf8'); let parsed = null; try { parsed = raw ? JSON.parse(raw) : null; } catch { parsed = null; } resolve({ status: res.statusCode, body: parsed }); });
    });
    req.setTimeout(20000, () => req.destroy(new Error('idle_timeout')));
    req.on('error', (e) => reject(new Error(`auth_probe_request_failed_${e.code ?? e.message}`)));
    if (payload) req.write(payload);
    req.end();
  });
}

/** `known` receives the throwaway password (so the evidence scan refuses it). Returns { settings, probes, failures, pass }. */
export async function probeAuthRefusals({ ref = TORNEOS_REF, apikey, transport, stamp, known = [] }) {
  if (typeof apikey !== 'string' || apikey.length < 20) throw new Error('auth_probe_apikey_missing');
  if (typeof transport !== 'function') throw new Error('auth_probe_transport_missing');
  const headers = { apikey, ...(apikey.startsWith('eyJ') ? { Authorization: `Bearer ${apikey}` } : {}) };
  const call = async (method, p, body) => { assertAuthProbeTarget(ref, method, `/auth/v1${p}`); return transport({ ref, method, path: `/auth/v1${p}`, headers, body }); };
  const failures = [];
  const s = await call('GET', '/settings');
  const settings = { status: s.status, disable_signup: s.body?.disable_signup ?? null, email: s.body?.external?.email ?? null, phone: s.body?.external?.phone ?? null, anonymous_users: s.body?.external?.anonymous_users ?? null };
  if (!(s.status === 200 && settings.disable_signup === true && settings.email === false && settings.phone === false && settings.anonymous_users === false)) failures.push('GOTRUE_SETTINGS_NOT_LOCKED');
  const probes = [];
  if (!failures.length) {
    const email = `w1-probe-${String(stamp).toLowerCase()}@example.invalid`;
    const password = crypto.randomBytes(18).toString('base64url'); known.push(password);
    for (const [id, p, body] of [
      ['signup_email_password', '/signup', { email, password }],
      ['signup_anonymous', '/signup', {}],
      ['otp_email_create_user', '/otp', { email, create_user: true }],
      ['otp_phone_create_user', '/otp', { phone: '+10000000000', create_user: true }],
    ]) {
      const r = await call('POST', p, body);
      const code = r.body?.error_code ?? r.body?.code ?? null;
      const refused = r.status >= 400 && r.status < 500 && r.status !== 429;
      probes.push({ id, status: r.status, error_code: code === null ? null : String(code), refused, refusal_code_known: REFUSAL_CODES.includes(code) });
      if (r.status >= 200 && r.status < 300) { failures.push(`GOTRUE_ACCEPTED_${id}`); break; }
      if (!refused) failures.push(`GOTRUE_PROBE_INCONCLUSIVE_${id}`);
    }
  }
  return { settings, probes, failures, pass: failures.length === 0 };
}
