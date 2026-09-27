// PAYMENTS TEST — the QA fixtures, executed INSIDE https://app.arma2.com.ar (the gateway's only allowed origin) with the
// Core Production session the signed-in operator already has. No Core user is created and no Core data is written:
//   1. POST /exchange (certified gateway)      → the operator's EXISTING Torneos shadow identity (bridge token, 120 s)
//   2. create_tournament_organization          through the gateway allowlist: "QA PAYMENTS TEST (Mercado Pago sandbox)",
//                                              slug qa-payments-test-<hex> (private: no tournament, no public page)
//   3. create_tournament_season × 2            through the gateway: S1 (real sandbox checkout) and S2 (rolled-back ordering)
//   4. create_tournament_season_checkout_purchase × 2   DIRECTLY on Torneos PostgREST with the bridge token (the gateway
//                                              keeps commerce OFF; the RPC is granted to authenticated by 0002, which fixes
//                                              product / provider MERCADO_PAGO / environment test / price server-side)
// Refuses to run if the operator already belongs to a QA PAYMENTS organization (no duplicates, no blind re-run).
// The Core access token and the bridge token never leave the page; the result carries ids, statuses and amounts only.
async function torneosPaymentsQaFixtures() {
  const GW = 'https://torneos-gateway.nicoavayu.deno.net/functions/v1/torneos-gateway';
  const TORNEOS_REF = 'onzpwnqxnvlgsevivngf'; // = TORNEOS_REF of torneos-gateway-auth/gateway-auth-contract.mjs (pinned by test)
  const REST = `https://${TORNEOS_REF}.supabase.co/rest/v1`;
  const QA = { orgName: 'QA PAYMENTS TEST (Mercado Pago sandbox)', orgSlugPrefix: 'qa-payments-test-',
    seasons: [{ key: 'S1', name: 'QA PAYMENTS TEST S1 checkout sandbox', slugPrefix: 'qa-pt-s1-' }, { key: 'S2', name: 'QA PAYMENTS TEST S2 ordering rollback', slugPrefix: 'qa-pt-s2-' }] };
  const hex = (n) => [...crypto.getRandomValues(new Uint8Array(n))].map((b) => b.toString(16).padStart(2, '0')).join('');
  const out = { at: new Date().toISOString(), steps: [] };
  const step = (name, status, extra = {}) => { out.steps.push({ name, status, ...extra }); };
  const session = JSON.parse(localStorage.getItem('sb-rcyuuoaqfwcembdajcss-auth-token') ?? 'null');
  if (!session?.access_token) { out.pass = false; out.error = 'NO_CORE_SESSION'; return out; }
  const cfg = await (await fetch(`${GW}/config`)).json();
  const ex = await fetch(`${GW}/exchange`, { method: 'POST', headers: { authorization: `Bearer ${session.access_token}`, 'content-type': 'application/json' }, body: '{}' });
  const tok = (await ex.json().catch(() => null))?.access_token;
  step('exchange', ex.status);
  if (ex.status !== 200 || !tok) { out.pass = false; return out; }
  const gw = async (name, args) => { const r = await fetch(`${GW}/torneos/rest/v1/rpc/${name}`, { method: 'POST', headers: { authorization: `Bearer ${tok}`, 'content-type': 'application/json' }, body: JSON.stringify(args) }); return { status: r.status, body: await r.json().catch(() => null) }; };
  const rest = async (name, args) => { const r = await fetch(`${REST}/rpc/${name}`, { method: 'POST', headers: { apikey: cfg.anonKey, authorization: `Bearer ${tok}`, 'content-type': 'application/json' }, body: JSON.stringify(args) }); return { status: r.status, body: await r.json().catch(() => null) }; };
  const idOf = (b, k) => b?.id ?? b?.[k]?.id ?? b?.[`${k}Id`] ?? null;

  const mine = await gw('get_my_tournament_memberships', { p_limit: 100, p_offset: 0 });
  const text = JSON.stringify(mine.body ?? null);
  step('memberships', mine.status);
  if (mine.status !== 200) { out.pass = false; return out; }
  if (text.includes(QA.orgSlugPrefix)) { out.pass = false; out.error = 'QA_ORG_ALREADY_PRESENT_REFUSE_DUPLICATE'; return out; }

  const slug = `${QA.orgSlugPrefix}${hex(4)}`;
  const org = await gw('create_tournament_organization', { p_name: QA.orgName, p_slug: slug, p_idempotency_key: crypto.randomUUID() });
  const orgId = idOf(org.body, 'organization');
  step('create_tournament_organization', org.status, { slug, org: orgId, code: org.body?.code ?? null, message: org.status === 200 ? null : org.body?.message ?? null });
  if (org.status !== 200 || !orgId) { out.pass = false; return out; }
  out.org = orgId; out.slug = slug; out.seasons = {}; out.purchases = {};
  for (const s of QA.seasons) {
    const r = await gw('create_tournament_season', { p_organization_id: orgId, p_name: s.name, p_slug: `${s.slugPrefix}${hex(3)}`, p_start_date: null, p_end_date: null, p_idempotency_key: crypto.randomUUID() });
    const sid = idOf(r.body, 'season');
    step(`create_tournament_season ${s.key}`, r.status, { season: sid, message: r.status === 200 ? null : r.body?.message ?? null });
    if (r.status !== 200 || !sid) { out.pass = false; return out; }
    out.seasons[s.key] = sid;
  }
  for (const s of QA.seasons) {
    const r = await rest('create_tournament_season_checkout_purchase', { p_organization_id: orgId, p_season_id: out.seasons[s.key], p_idempotency_key: crypto.randomUUID() });
    const b = r.body ?? {};
    const pid = idOf(b, 'purchase');
    step(`create_tournament_season_checkout_purchase ${s.key}`, r.status, { purchase: pid, status: b.status ?? null, amount: b.amount ?? null, currency: b.currency ?? null, provider: b.provider ?? null, environment: b.providerEnvironment ?? null, message: r.status === 200 ? null : b.message ?? null });
    if (r.status !== 200 || !pid) { out.pass = false; return out; }
    out.purchases[s.key] = { id: pid, status: b.status, amount: b.amount, currency: b.currency, provider: b.provider, environment: b.providerEnvironment };
  }
  out.pass = Object.values(out.purchases).every((p) => p.status === 'created' && p.amount === 39900 && p.currency === 'ARS' && p.provider === 'MERCADO_PAGO' && p.environment === 'test');
  return out;
}
