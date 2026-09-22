#!/usr/bin/env node
// Phase 3B — Fase 4/6: remote certification of the deployed gateway (Torneos non-prod) against
// the real Core non-prod (Staging) session, from the operator's machine. No PAT, no CLI, no
// service role of Torneos. Input (stdin JSON): { core_ref, torneos_ref, core_anon, torneos_anon,
//   login: { mode: "password", email, password } | { mode: "admin", email, service_key } }
// `admin` creates (or reuses) a confirmed synthetic Core user with the CORE service key, then
// logs in with a password it generates; the key never leaves this process. Output: one JSON
// document on stdout with every check (status/body sanitized) and the D1/B03 signals.
import process from 'node:process';
import { randomBytes, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const PROD_REF = 'rcyuuoaqfwcembdajcss';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const GATE = JSON.parse(readFileSync(path.join(HERE, '../../phase2d/staging-v1-rpc-gate.json'), 'utf8'));
const ALLOW = JSON.parse(readFileSync(path.join(HERE, '../../phase2d/staging-v1-rpc-allowlist.json'), 'utf8'));
const OFF = [...new Set(GATE.functions.map((f) => f.name))];
const ALLOWED = Object.values(ALLOW.features).flat();
const SECRETS = [];
const redact = (t) => SECRETS.filter((s) => typeof s === 'string' && s.length >= 8).reduce((o, s) => o.split(s).join('«REDACTED»'), String(t));
const decode = (jwt) => { try { return JSON.parse(Buffer.from(jwt.split('.')[1], 'base64url').toString()); } catch { return null; } };

async function main() {
  const input = JSON.parse(await new Promise((r) => { let s = ''; process.stdin.on('data', (c) => s += c).on('end', () => r(s)); }));
  const { core_ref, torneos_ref, core_anon, torneos_anon, login } = input;
  for (const [k, v] of Object.entries({ core_ref, torneos_ref })) if (!/^[a-z]{20}$/.test(v) || v === PROD_REF) throw new Error(`${k} invalid or Production`);
  if (core_ref === torneos_ref) throw new Error('core and torneos must differ');
  for (const v of [login?.password, login?.service_key]) if (v) SECRETS.push(v);
  const CORE = `https://${core_ref}.supabase.co`;
  const TORNEOS = `https://${torneos_ref}.supabase.co`;
  const GW = `${TORNEOS}/functions/v1/torneos-gateway`;
  const out = { generated_at: new Date().toISOString(), core_ref, torneos_ref, gateway: GW, checks: [] };
  const check = (name, status, body, extra = {}) => { const row = { name, status, body: typeof body === 'string' ? body.slice(0, 200) : body, ...extra }; out.checks.push(row); return row; };
  const call = async (url, { method = 'GET', headers = {}, body } = {}) => {
    const r = await fetch(url, { method, headers, body: body === undefined ? undefined : (typeof body === 'string' ? body : JSON.stringify(body)), redirect: 'manual', signal: AbortSignal.timeout(20000) });
    const text = await r.text(); let parsed; try { parsed = JSON.parse(text); } catch { parsed = text; }
    return { status: r.status, body: parsed };
  };
  const coreHeaders = (token) => ({ apikey: core_anon, ...(token ? { authorization: `Bearer ${token}` } : {}), 'content-type': 'application/json' });

  // ── Core session (Staging GoTrue) ──
  let email = login.email, password = login.password;
  if (login.mode === 'admin') {
    password = randomBytes(24).toString('base64url') + 'Aa1!';
    SECRETS.push(password);
    const created = await call(`${CORE}/auth/v1/admin/users`, { method: 'POST', headers: { apikey: core_anon, authorization: `Bearer ${login.service_key}`, 'content-type': 'application/json' },
      body: { email, password, email_confirm: true, user_metadata: { full_name: 'Phase3B Synthetic' } } });
    check('core admin: synthetic user created/exists', created.status, created.status === 200 ? { id: created.body?.id ? 'uuid' : null } : created.body);
    if (created.status === 422) { // already exists → set password
      const list = await call(`${CORE}/auth/v1/admin/users?page=1&per_page=1000`, { headers: { apikey: core_anon, authorization: `Bearer ${login.service_key}` } });
      const u = (list.body?.users ?? []).find((x) => x.email === email);
      if (!u) throw new Error('synthetic user not found');
      const upd = await call(`${CORE}/auth/v1/admin/users/${u.id}`, { method: 'PUT', headers: { apikey: core_anon, authorization: `Bearer ${login.service_key}`, 'content-type': 'application/json' }, body: { password, email_confirm: true } });
      check('core admin: password reset on existing synthetic user', upd.status, null);
    }
  }
  const tok = await call(`${CORE}/auth/v1/token?grant_type=password`, { method: 'POST', headers: coreHeaders(), body: { email, password } });
  if (tok.status !== 200) { check('core login', tok.status, tok.body); return finish(out, 'B) BLOCKED — no Core session'); }
  const coreToken = tok.body.access_token; SECRETS.push(coreToken, tok.body.refresh_token);
  const coreClaims = decode(coreToken);
  check('core login (password grant)', 200, { iss: coreClaims?.iss, aud: coreClaims?.aud, role: coreClaims?.role, session_id: coreClaims?.session_id ? 'uuid' : null });

  // ── Gateway public endpoints ──
  const health = await call(`${GW}/health`); check('gateway /health', health.status, health.body);
  const jwks = await call(`${GW}/.well-known/jwks.json`); check('gateway /.well-known/jwks.json', jwks.status, { kids: jwks.body?.keys?.map((k) => k.kid) ?? null, private_material: JSON.stringify(jwks.body).includes('"d":') });
  const cfg = await call(`${GW}/config`); check('gateway /config keys', cfg.status, Object.keys(cfg.body ?? {}).sort());

  // ── Exchange ──
  const ex = await call(`${GW}/exchange`, { method: 'POST', headers: { authorization: `Bearer ${coreToken}` } });
  const tclaims = ex.status === 200 ? decode(ex.body.access_token) : null;
  if (ex.status === 200) SECRETS.push(ex.body.access_token);
  check('exchange (Core session → Torneos token)', ex.status, ex.status === 200 ? { token_type: ex.body.token_type, expires_in: ex.body.expires_in, iss: tclaims?.iss, aud: tclaims?.aud, ttl: tclaims ? tclaims.exp - tclaims.iat : null, core_user_id_bound: tclaims?.core_user_id === coreClaims?.sub, session_bound: tclaims?.session_id === coreClaims?.session_id, kid: JSON.parse(Buffer.from(ex.body.access_token.split('.')[0], 'base64url').toString()).kid } : ex.body);
  const t = ex.status === 200 ? ex.body.access_token : null;
  const bad = await call(`${GW}/exchange`, { method: 'POST', headers: { authorization: 'Bearer not-a-token' } }); check('exchange: garbage bearer → 401', bad.status, bad.body);
  const roleIn = await call(`${GW}/exchange`, { method: 'POST', headers: { authorization: `Bearer ${coreToken}`, 'content-type': 'application/json' }, body: { role: 'service_role' } }); check('exchange: identity/role input → 400', roleIn.status, roleIn.body);

  if (t) {
    // ── Allowlisted RPC through the gateway (B03 signal: PostgREST must accept the RS256 bearer) ──
    const rpc = await call(`${GW}/torneos/rest/v1/rpc/get_my_tournament_memberships`, { method: 'POST', headers: { authorization: `Bearer ${t}`, 'content-type': 'application/json' }, body: {} });
    check('allowlisted RPC via gateway: get_my_tournament_memberships', rpc.status, rpc.body, { b03: rpc.status === 200 ? 'PostgREST accepted the bridge RS256 bearer' : 'PostgREST/gateway rejected the bridge bearer — B03 OPEN' });
    const slug = await call(`${GW}/torneos/rest/v1/rpc/is_tournament_organization_slug_available`, { method: 'POST', headers: { authorization: `Bearer ${t}`, 'content-type': 'application/json' }, body: { p_slug: `phase3b-${randomUUID().slice(0, 8)}` } });
    check('allowlisted RPC via gateway: is_tournament_organization_slug_available', slug.status, slug.body);
    const read = await call(`${GW}/torneos/rest/v1/torneos_identity?select=core_user_id`, { headers: { authorization: `Bearer ${t}` } });
    check('table read via gateway (RLS own identity)', read.status, Array.isArray(read.body) ? { rows: read.body.length, own: read.body.every((r) => r.core_user_id === coreClaims.sub) } : read.body);
    // ── 33 OFF via gateway: 403 rpc not enabled, POST and GET ──
    const sweep = [];
    for (const name of OFF) {
      const p = await call(`${GW}/torneos/rest/v1/rpc/${name}`, { method: 'POST', headers: { authorization: `Bearer ${t}`, 'content-type': 'application/json' }, body: {} });
      const g = await call(`${GW}/torneos/rest/v1/rpc/${name}`, { headers: { authorization: `Bearer ${t}` } });
      sweep.push({ name, post: [p.status, p.body?.error ?? p.body], get: [g.status, g.body?.error ?? g.body] });
    }
    check('gateway sweep: 32 OFF + parent', sweep.every((r) => r.post[0] === 403 && r.get[0] === 403 && r.post[1] === 'rpc not enabled') ? 200 : 500, { rows: sweep.length, all_403_rpc_not_enabled: sweep.every((r) => r.post[0] === 403 && r.get[0] === 403 && r.post[1] === 'rpc not enabled') }, { sweep });
    // ── Direct Data API attempts (bypassing the gateway) ──
    const direct = [];
    for (const name of [...OFF.slice(0, 5), 'get_my_tournament_memberships', 'review_tournament_team_entry']) {
      const anon = await call(`${TORNEOS}/rest/v1/rpc/${name}`, { method: 'POST', headers: { apikey: torneos_anon, 'content-type': 'application/json' }, body: {} });
      const bearer = await call(`${TORNEOS}/rest/v1/rpc/${name}`, { method: 'POST', headers: { apikey: torneos_anon, authorization: `Bearer ${t}`, 'content-type': 'application/json' }, body: {} });
      direct.push({ name, gated: OFF.includes(name), anon: [anon.status, anon.body?.code ?? anon.body?.message ?? anon.body], bridge_bearer: [bearer.status, bearer.body?.code ?? bearer.body?.message ?? bearer.body] });
    }
    check('direct PostgREST: anon key only (must deny every RPC); bridge bearer (gated must deny; allowlisted = B03 trust signal)',
      direct.every((d) => d.anon[0] >= 400 && (!d.gated || d.bridge_bearer[0] >= 400)) ? 200 : 500, { rows: direct.length }, { direct });
    const anonTable = await call(`${TORNEOS}/rest/v1/torneos_identity?select=id`, { headers: { apikey: torneos_anon } });
    check('direct PostgREST: anon read of torneos_identity denied/empty', anonTable.status, Array.isArray(anonTable.body) ? { rows: anonTable.body.length } : anonTable.body);
    // ── Forged bearer ──
    const forged = t.split('.').slice(0, 2).join('.') + '.' + Buffer.from(randomBytes(256)).toString('base64url');
    const f = await call(`${GW}/torneos/rest/v1/rpc/get_my_tournament_memberships`, { method: 'POST', headers: { authorization: `Bearer ${forged}`, 'content-type': 'application/json' }, body: {} });
    check('forged signature via gateway → 401', f.status, f.body);
    // ── Logout: exchange + RPC must deny with the still-unexpired Torneos bearer ──
    const lo = await call(`${CORE}/auth/v1/logout`, { method: 'POST', headers: coreHeaders(coreToken) });
    check('core logout', lo.status, null);
    const ex2 = await call(`${GW}/exchange`, { method: 'POST', headers: { authorization: `Bearer ${coreToken}` } }); check('after logout: exchange → 401', ex2.status, ex2.body);
    const rpc2 = await call(`${GW}/torneos/rest/v1/rpc/get_my_tournament_memberships`, { method: 'POST', headers: { authorization: `Bearer ${t}`, 'content-type': 'application/json' }, body: {} }); check('after logout: RPC with unexpired Torneos bearer → 401', rpc2.status, rpc2.body);
    const off2 = await call(`${GW}/torneos/rest/v1/rpc/publish_tournament_fixture`, { method: 'POST', headers: { authorization: `Bearer ${t}`, 'content-type': 'application/json' }, body: {} }); check('after logout: OFF → 403 (allowlist before session)', off2.status, off2.body);
  }
  return finish(out, null);
}
function finish(out, blocked) {
  const failed = out.checks.filter((c) => c.status >= 500 || c.status === 0);
  out.summary = { checks: out.checks.length, blocked: blocked ?? null };
  process.stdout.write(redact(JSON.stringify(out, null, 2)) + '\n');
}
main().catch((e) => { process.stdout.write(redact(JSON.stringify({ ok: false, error: e?.message ?? 'error' })) + '\n'); process.exit(1); });
