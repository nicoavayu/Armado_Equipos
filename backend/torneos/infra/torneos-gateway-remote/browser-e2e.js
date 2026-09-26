// GATEWAY REMOTE — Phase C E2E, executed INSIDE https://app.arma2.com.ar (the only allowed origin) with the Core
// Production session the signed-in user already has. The Core access token and the bridge token never leave the page:
// the script returns statuses, header fields and claim SHAPES only (ids as 8-char prefixes, times as deltas).
// Writes: the one /exchange creates (or reuses) exactly the shadow identity of this Core user; nothing else.
//
//   phase 'now'   C2 exchange contract, C3 allowlisted 200 / not allowlisted 403 / tampered 401, direct PostgREST
//                 within the TTL (C5), re-exchange = same identity, new jti. Keeps the first bridge token in memory.
//   phase 'late'  (≥ 126 s after 'now') the same bridge token → gateway 401 and direct PostgREST 401 (TTL + tolerance).
async function torneosGatewayE2E(phase) {
  const GW = 'https://torneos-gateway.nicoavayu.deno.net/functions/v1/torneos-gateway';
  const REST = 'https://onzpwnqxnvlgsevivngf.supabase.co/rest/v1';
  const b64 = (s) => JSON.parse(decodeURIComponent(escape(atob(s.replace(/-/g, '+').replace(/_/g, '/')))));
  const parts = (t) => ({ h: b64(t.split('.')[0]), c: b64(t.split('.')[1]) });
  const pre = (v) => (typeof v === 'string' ? v.slice(0, 8) : null);
  const uuid = (v) => typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
  const st = window.__torneosE2E ?? (window.__torneosE2E = {});
  const rpc = (name, tok, body = '{}') => fetch(`${GW}/torneos/rest/v1/rpc/${name}`, { method: 'POST', headers: { authorization: `Bearer ${tok}`, 'content-type': 'application/json' }, body });
  const out = { phase, at: new Date().toISOString(), checks: [] };
  const add = (name, pass, extra = {}) => out.checks.push({ name, pass: !!pass, ...extra });

  if (phase === 'now') {
    const session = JSON.parse(localStorage.getItem('sb-rcyuuoaqfwcembdajcss-auth-token'));
    const core = session.access_token;
    const cc = parts(core).c;
    const cfg = await (await fetch(`${GW}/config`)).json();
    st.anon = cfg.anonKey;
    const ex = await fetch(`${GW}/exchange`, { method: 'POST', headers: { authorization: `Bearer ${core}`, 'content-type': 'application/json' }, body: '{}' });
    const j = await ex.json().catch(() => null);
    if (ex.status !== 200 || typeof j?.access_token !== 'string') { add('C2 POST /exchange with the Core session → 200', false, { status: ex.status, error: j?.error ?? null }); out.pass = false; return out; }
    const tok = j.access_token;
    const { h, c } = parts(tok);
    st.tok = tok; st.at = Date.now(); st.sub = c.sub;
    add('C2 POST /exchange with the Core session → 200', ex.status === 200, { status: ex.status });
    add('C2 response keys exactly access_token, token_type=Bearer, expires_in=120 (no refresh token)', Object.keys(j).sort().join(',') === 'access_token,expires_in,token_type' && j.token_type === 'Bearer' && j.expires_in === 120, { keys: Object.keys(j).sort() });
    add('C2 header RS256 / JWT / kid = Production k1', h.alg === 'RS256' && h.typ === 'JWT' && h.kid === 'arma2-torneos-prod-k1-svt92JOHlnVoXI35', { alg: h.alg, typ: h.typ, kid: h.kid });
    add('C2 iss/aud = certified constants', c.iss === 'urn:arma2:local:identity-bridge' && c.aud === 'arma2-torneos-local', { iss: c.iss, aud: c.aud });
    add('C2 TTL exactly 120 s, nbf = iat, role authenticated', c.exp - c.iat === 120 && c.nbf === c.iat && c.role === 'authenticated', { ttl: c.exp - c.iat, role: c.role });
    add('C2 bindings: core_user_id = this Core user, session_id = this Core session, sub = a Torneos identity uuid ≠ Core id, jti uuid',
      c.core_user_id === session.user.id && c.session_id === cc.session_id && uuid(c.sub) && c.sub !== c.core_user_id && uuid(c.jti),
      { core_user: pre(c.core_user_id), session: pre(c.session_id), sub: pre(c.sub) });
    add('C2 claims carry no email / phone / profile data', ['email', 'phone', 'user_metadata', 'app_metadata'].every((k) => !(k in c)), { claims: Object.keys(c).sort() });

    const ok = await rpc('get_my_tournament_memberships', tok);
    const okBody = await ok.json().catch(() => null);
    add('C3 allowlisted RPC get_my_tournament_memberships through the gateway → 200', ok.status === 200, { status: ok.status, body: Array.isArray(okBody) ? `array(${okBody.length})` : (okBody && typeof okBody === 'object' ? Object.keys(okBody).slice(0, 6) : typeof okBody), code: okBody?.code ?? null });
    const off = await rpc('get_tournament_purchase', tok);
    add('C3 commerce RPC (OFF) → 403 rpc not enabled', off.status === 403 && (await off.json()).error === 'rpc not enabled', { status: off.status });
    const off2 = await rpc('admin_torneos_not_a_function', tok);
    add('C3 unknown RPC name → 403 rpc not enabled', off2.status === 403, { status: off2.status });
    const [hh, pp, ss] = tok.split('.');
    const forged = JSON.parse(atob(pp.replace(/-/g, '+').replace(/_/g, '/'))); forged.sub = crypto.randomUUID();
    const tampered = `${hh}.${btoa(JSON.stringify(forged)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')}.${ss}`;
    const tp = await rpc('get_my_tournament_memberships', tampered);
    add('C3 tampered identity (sub rewritten, original signature) → 401', tp.status === 401, { status: tp.status });
    const coreAsBridge = await rpc('get_my_tournament_memberships', core);
    add('C3 the Core access token itself used as a Torneos bearer → 401', coreAsBridge.status === 401, { status: coreAsBridge.status });

    const direct = await fetch(`${REST}/rpc/get_my_tournament_memberships`, { method: 'POST', headers: { apikey: st.anon, authorization: `Bearer ${tok}`, 'content-type': 'application/json' }, body: '{}' });
    const dBody = await direct.json().catch(() => null);
    add('C5 bridge token directly on Torneos PostgREST within the TTL → 200 (host trusts k1 via B03; identity gate passes)', direct.status === 200, { status: direct.status, code: dBody?.code ?? null });

    const ex2 = await fetch(`${GW}/exchange`, { method: 'POST', headers: { authorization: `Bearer ${core}`, 'content-type': 'application/json' }, body: '{}' });
    const t2 = parts((await ex2.json()).access_token).c;
    add('C2 re-exchange → 200, SAME identity (sub), new jti', ex2.status === 200 && t2.sub === c.sub && t2.jti !== c.jti, { status: ex2.status });
    out.issued_iat = c.iat;
  } else if (phase === 'late') {
    const age = Math.round((Date.now() - st.at) / 1000);
    out.age_s = age;
    const g = await rpc('get_my_tournament_memberships', st.tok);
    add('C3/C5 same bridge token after TTL + tolerance through the gateway → 401', age >= 126 && g.status === 401, { status: g.status, age });
    const d = await fetch(`${REST}/rpc/get_my_tournament_memberships`, { method: 'POST', headers: { apikey: st.anon, authorization: `Bearer ${st.tok}`, 'content-type': 'application/json' }, body: '{}' });
    add('C5 same bridge token directly on PostgREST after TTL + tolerance → 401', age >= 126 && d.status === 401, { status: d.status, age });
    delete st.tok;
  }
  out.pass = out.checks.every((x) => x.pass);
  return out;
}
