// COMPETITION-V1 REMOTE — authenticated route probes with a REAL user, executed INSIDE https://app.arma2.com.ar (the only
// allowed origin) with the Core Production session the signed-in operator already has. Tokens never leave the page:
// the result carries statuses and error codes only.
// Writes: /exchange reuses the operator's existing shadow identity (created by the certified Phase C E2E); every RPC
// below is a read, or a write RPC called with RANDOM ids so that its own guard refuses it before touching any row.
//
//   phase 'previous'  gateway on bea307a3 (before W2): competition RPCs → 403 rpc not enabled; public route → 404.
//   phase 'candidate' gateway on COMPETITION-V1 (after W1 + W2): self-scoped reads → 200; a 0004-granted write with
//                     random ids → 403 42501 from the FUNCTION guard (not "permission denied for function": the DB grant
//                     is live); the guard-order fix answers 42501 for a random version; service-only / OFF → 403.
async function torneosCompetitionProbe(phase) {
  const GW = 'https://torneos-gateway.nicoavayu.deno.net/functions/v1/torneos-gateway';
  const session = JSON.parse(localStorage.getItem('sb-rcyuuoaqfwcembdajcss-auth-token'));
  const out = { phase, at: new Date().toISOString(), checks: [] };
  const add = (name, pass, extra = {}) => out.checks.push({ name, pass: !!pass, ...extra });
  const ex = await fetch(`${GW}/exchange`, { method: 'POST', headers: { authorization: `Bearer ${session.access_token}`, 'content-type': 'application/json' }, body: '{}' });
  const tok = (await ex.json().catch(() => ({}))).access_token;
  add('POST /exchange with the Core session → 200', ex.status === 200 && typeof tok === 'string', { status: ex.status });
  if (typeof tok !== 'string') { out.pass = false; return out; }
  const rpc = async (name, body) => {
    const r = await fetch(`${GW}/torneos/rest/v1/rpc/${name}`, { method: 'POST', headers: { authorization: `Bearer ${tok}`, 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const j = await r.json().catch(() => null);
    return { status: r.status, error: j?.error ?? null, code: j?.code ?? null, message: typeof j?.message === 'string' ? j.message.slice(0, 60) : null, shape: Array.isArray(j) ? `array(${j.length})` : typeof j };
  };
  const u = () => crypto.randomUUID();
  const notEnabled = (r) => r.status === 403 && r.error === 'rpc not enabled';
  const guard = (r) => r.status === 403 && r.code === '42501' && !/permission denied for function/.test(r.message ?? '');
  const mine = await rpc('get_player_tournament_matches', {});
  const managed = await rpc('get_managed_tournament_matches', {});
  const granted = await rpc('publish_tournament_fixture', { p_organization_id: u(), p_fixture_version_id: u() });
  const fixed = await rpc('publish_tournament_document_version', { p_version_id: u() });
  const service = await rpc('archive_tournament_fixture', { p_organization_id: u(), p_fixture_version_id: u(), p_reason: 'probe' });
  const off = await rpc('lock_tournament_roster', { p_organization_id: u(), p_tournament_id: u(), p_team_entry_id: u() });
  const staging = await rpc('get_my_tournament_memberships', {});
  add('staging v1 RPC get_my_tournament_memberships → 200 (unchanged)', staging.status === 200, staging);
  add('service-only archive_tournament_fixture → 403 rpc not enabled', notEnabled(service), service);
  add('OFF feature lock_tournament_roster → 403 rpc not enabled', notEnabled(off), off);
  const pub = await fetch(`${GW}/torneos/public/v1/rpc/get_public_tournament_page`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ p_public_slug: `probe-${u().slice(0, 8)}`, p_category_slug: null }) });
  const pubBody = await pub.text();
  if (phase === 'previous') {
    for (const [n, r] of [['get_player_tournament_matches', mine], ['get_managed_tournament_matches', managed], ['publish_tournament_fixture', granted], ['publish_tournament_document_version', fixed]]) add(`${n} → 403 rpc not enabled (not deployed yet)`, notEnabled(r), r);
    add('public route → 404 (not deployed yet)', pub.status === 404, { status: pub.status });
  } else {
    add('get_player_tournament_matches → 200 array (self-scoped)', mine.status === 200 && mine.shape.startsWith('array'), mine);
    add('get_managed_tournament_matches → 200 array (self-scoped)', managed.status === 200 && managed.shape.startsWith('array'), managed);
    add('publish_tournament_fixture (granted by 0004), random ids → 403 42501 from the function guard (grant live, no write)', guard(granted), granted);
    add('publish_tournament_document_version (guard-order fix), random version → 403 42501 before any lookup', guard(fixed), fixed);
    add('public route, unknown slug, no credential → 200 null', pub.status === 200 && pubBody === 'null', { status: pub.status });
  }
  out.pass = out.checks.every((c) => c.pass);
  return out;
}
