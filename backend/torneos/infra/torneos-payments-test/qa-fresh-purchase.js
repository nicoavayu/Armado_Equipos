// PAYMENTS TEST — a FRESH S1 checkout purchase in the EXISTING QA organization, executed INSIDE https://app.arma2.com.ar
// (the gateway's only allowed origin) with the Core Production session the signed-in operator already has.
// For a new real sandbox operation when the S1 purchase's Preference has expired (the payments app answers 409
// preference_expired and never refreshes one). No org, season or Core row is created:
//   1. POST /exchange (certified gateway)      → the operator's EXISTING Torneos shadow identity (bridge token, 120 s)
//   2. create_tournament_season_checkout_purchase   DIRECTLY on Torneos PostgREST with the bridge token, on S1 only
//      (the certified RPC of 0002: its own stale sweep turns the expired preference_created purchase into `expired`
//      with a purchase.expired service event — no grant, watermark or provider call — then creates the new purchase;
//      product / provider MERCADO_PAGO / environment test / price are fixed server-side)
// The ids are the ones the session's `fixtures` pinned (QA_FIXTURES_ISOLATED); the RPC itself refuses (42501) unless the
// season belongs to the org and the caller holds billing.manage on both. (get_my_tournament_memberships lists only
// tournament-scoped relations — the QA org has none — so it cannot identify the org.)
// Passes only if exactly ONE stale purchase was swept and the new one is a created MP TEST ARS 39.900 purchase.
// The Core access token and the bridge token never leave the page; the result carries ids, statuses and amounts only.
async function torneosPaymentsQaFreshPurchase({ organizationId, seasonId }) {
  const GW = 'https://torneos-gateway.nicoavayu.deno.net/functions/v1/torneos-gateway';
  const REST = 'https://onzpwnqxnvlgsevivngf.supabase.co/rest/v1';
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
  const out = { at: new Date().toISOString(), organization: organizationId, season: seasonId, steps: [] };
  const step = (name, status, extra = {}) => { out.steps.push({ name, status, ...extra }); };
  if (!UUID.test(String(organizationId)) || !UUID.test(String(seasonId))) { out.pass = false; out.error = 'IDS_MALFORMED'; return out; }
  const session = JSON.parse(localStorage.getItem('sb-rcyuuoaqfwcembdajcss-auth-token') ?? 'null');
  if (!session?.access_token) { out.pass = false; out.error = 'NO_CORE_SESSION'; return out; }
  const cfg = await (await fetch(`${GW}/config`)).json();
  const ex = await fetch(`${GW}/exchange`, { method: 'POST', headers: { authorization: `Bearer ${session.access_token}`, 'content-type': 'application/json' }, body: '{}' });
  const tok = (await ex.json().catch(() => null))?.access_token;
  step('exchange', ex.status);
  if (ex.status !== 200 || !tok) { out.pass = false; return out; }
  const rest = async (name, args) => { const r = await fetch(`${REST}/rpc/${name}`, { method: 'POST', headers: { apikey: cfg.anonKey, authorization: `Bearer ${tok}`, 'content-type': 'application/json' }, body: JSON.stringify(args) }); return { status: r.status, body: await r.json().catch(() => null) }; };

  const r = await rest('create_tournament_season_checkout_purchase', { p_organization_id: organizationId, p_season_id: seasonId, p_idempotency_key: crypto.randomUUID() });
  const b = r.body ?? {};
  const pid = b.id ?? b.purchase?.id ?? b.purchaseId ?? null;
  step('create_tournament_season_checkout_purchase S1', r.status, { purchase: pid, status: b.status ?? null, amount: b.amount ?? null, currency: b.currency ?? null, provider: b.provider ?? null,
    environment: b.providerEnvironment ?? null, expired_stale: b.expiredStalePurchases ?? null, message: r.status === 200 ? null : b.message ?? null });
  if (r.status !== 200 || !pid) { out.pass = false; return out; }
  out.purchase = { id: pid, status: b.status, amount: b.amount, currency: b.currency, provider: b.provider, environment: b.providerEnvironment, expired_stale: b.expiredStalePurchases };
  out.pass = b.status === 'created' && b.amount === 39900 && b.currency === 'ARS' && b.provider === 'MERCADO_PAGO' && b.providerEnvironment === 'test' && b.expiredStalePurchases === 1;
  return out;
}
