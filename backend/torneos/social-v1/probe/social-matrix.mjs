// SOCIAL-V1 authenticated certification matrix (gate B+C), with ONE /exchange. Two forms of the same cases:
//   • runSocialMatrix(): injectable (fetch, bearer), exercised offline against the real gateway source
//     (social-matrix.test.mjs);
//   • browserProbe(): the console script for the app's /login document with the QA session (same guards as the
//     PLAN READ probe: one exchange, every non-GET outside the listed gateway paths refused, tokens never printed).
// Every case is read-only at the database: the three Social RPCs and the plan read are STABLE; the refused ones
// never reach PostgREST.
export const COMMERCIAL_RPCS = Object.freeze(['get_tournament_purchase', 'create_tournament_season_checkout_purchase',
  'create_tournament_season_purchase', 'create_fake_tournament_season_purchase', 'grant_tournament_season_premium',
  'record_tournament_purchase_preference', 'activate_verified_tournament_purchase', 'activate_verified_fake_tournament_purchase',
  'apply_fake_tournament_payment_status', 'apply_tournament_purchase_reversal', 'apply_verified_tournament_payment_status',
  'apply_verified_tournament_payment_reversal', 'cancel_tournament_purchase', 'grant_tournament_premium']);
export const SOCIAL_RPCS = Object.freeze(['get_tournament_social_studio_context', 'get_tournament_social_snapshot', 'authorize_tournament_social_export']);
const GHOST = '00000000-0000-4000-8000-0000000008a1';

/** The fixed expectations for a FREE season owned by the probing identity (Production QA today). */
export function socialMatrixCases({ organizationId: O, seasonId: S, tournamentId: T, foreignOrganizationId: FO }) {
  const authorize = (piece, theme, branding, extra = {}) => ({ p_organization_id: O, p_tournament_id: T, p_piece: piece, p_theme: theme, p_include_arma2_branding: branding, ...extra });
  const ok = (name, rpc, body, check) => ({ name, rpc, body, status: [200], check });
  const refused = (name, rpc, body, status, message) => ({ name, rpc, body, status: [status], message });
  return [
    ok('context_own_organization', 'get_tournament_social_studio_context', { p_organization_id: O },
      (b) => Array.isArray(b?.capabilities) && b.capabilities.includes('social.read') && JSON.stringify(b.freeBaseFamilies) === '["round_results","standings","next_fixture"]'
        && Array.isArray(b.tournaments)),
    refused('context_foreign_organization', 'get_tournament_social_studio_context', { p_organization_id: FO }, 403, 'TORNEOS_SOCIAL_FORBIDDEN'),
    refused('context_ghost_organization', 'get_tournament_social_studio_context', { p_organization_id: GHOST }, 403, 'TORNEOS_SOCIAL_FORBIDDEN'),
    refused('snapshot_foreign_organization', 'get_tournament_social_snapshot', { p_organization_id: FO, p_tournament_id: T, p_category_id: GHOST, p_phase_id: GHOST, p_piece: 'standings', p_round_id: null, p_group_id: null }, 403, 'TORNEOS_SOCIAL_FORBIDDEN'),
    ok('free_round_results_base_signed', 'authorize_tournament_social_export', authorize('round_results', 'base', true),
      (b) => b?.authorized === true && b.plan === 'FREE' && b.includeArma2Branding === true && b.seasonId === S && b.tournamentId === T),
    ok('free_standings_base_signed', 'authorize_tournament_social_export', authorize('standings', 'base', true), (b) => b?.includeArma2Branding === true),
    ok('free_next_fixture_base_signed', 'authorize_tournament_social_export', authorize('next_fixture', 'base', true), (b) => b?.includeArma2Branding === true),
    refused('free_premium_piece', 'authorize_tournament_social_export', authorize('mvp', 'base', true), 403, 'TORNEOS_SOCIAL_PREMIUM_REQUIRED'),
    refused('free_premium_style', 'authorize_tournament_social_export', authorize('round_results', 'heritage', true), 403, 'TORNEOS_SOCIAL_PREMIUM_REQUIRED'),
    refused('free_base_without_signature', 'authorize_tournament_social_export', authorize('round_results', 'base', false), 403, 'TORNEOS_BRANDING_PREMIUM_REQUIRED'),
    refused('null_theme', 'authorize_tournament_social_export', authorize('round_results', null, true), 400, 'TORNEOS_SOCIAL_THEME_UNKNOWN'),
    refused('null_piece', 'authorize_tournament_social_export', authorize(null, 'base', true), 400, 'TORNEOS_SOCIAL_PIECE_UNKNOWN'),
    refused('null_branding', 'authorize_tournament_social_export', authorize('round_results', 'base', null), 400, 'TORNEOS_SOCIAL_BRANDING_INVALID'),
    refused('unknown_theme', 'authorize_tournament_social_export', authorize('round_results', 'BASE', true), 400, 'TORNEOS_SOCIAL_THEME_UNKNOWN'),
    refused('cross_organization', 'authorize_tournament_social_export', authorize('round_results', 'base', true, { p_organization_id: FO }), 403, 'TORNEOS_SOCIAL_EXPORT_FORBIDDEN'),
    refused('ghost_tournament', 'authorize_tournament_social_export', authorize('round_results', 'base', true, { p_tournament_id: GHOST }), 403, 'TORNEOS_SOCIAL_EXPORT_FORBIDDEN'),
    ok('plan_read_coexists', 'get_effective_tournament_season_entitlements', { p_organization_id: O, p_season_id: S }, (b) => b?.plan === 'FREE'),
    { name: 'permission_rpc_not_enabled', rpc: 'set_tournament_social_permission', body: {}, status: [403], error: 'rpc not enabled' },
    ...COMMERCIAL_RPCS.map((rpc) => ({ name: `commercial_${rpc}`, rpc, body: {}, status: [403], error: 'rpc not enabled' })),
  ];
}

/** Runs the matrix with an already exchanged bridge bearer. Never prints the bearer. */
export async function runSocialMatrix({ gatewayUrl, fetch: doFetch = globalThis.fetch, bearer, ids }) {
  const call = async (path, token, body) => {
    const response = await doFetch(`${gatewayUrl}${path}`, { method: 'POST', headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), 'content-type': 'application/json' }, body: JSON.stringify(body ?? {}) });
    let json = null;
    try { json = await response.json(); } catch { json = null; }
    return { status: response.status, body: json };
  };
  const checks = [];
  for (const c of socialMatrixCases(ids)) {
    const r = await call(`/torneos/rest/v1/rpc/${c.rpc}`, bearer, c.body);
    const pass = c.status.includes(r.status)
      && (!c.message || r.body?.message === c.message)
      && (!c.error || r.body?.error === c.error)
      && (!c.check || c.check(r.body));
    checks.push({ name: c.name, pass, status: r.status, message: r.body?.message ?? r.body?.error ?? null });
  }
  for (const [name, token] of [['no_bearer', null], ['invalid_bearer', 'invalid.qa.bearer']]) {
    for (const rpc of SOCIAL_RPCS) {
      const r = await call(`/torneos/rest/v1/rpc/${rpc}`, token, { p_organization_id: ids.organizationId });
      checks.push({ name: `${name}_${rpc}`, pass: r.status === 401, status: r.status });
    }
  }
  for (const rpc of SOCIAL_RPCS) {
    const r = await call(`/torneos/public/v1/rpc/${rpc}`, null, { p_organization_id: ids.organizationId });
    checks.push({ name: `public_route_${rpc}`, pass: r.status === 403, status: r.status });
  }
  for (const path of ['/commerce/v1/season-checkout', '/internal/v1/season-checkout-preference']) {
    const r = await call(path, bearer, {});
    checks.push({ name: `checkout_${path}`, pass: r.status === 404, status: r.status });
  }
  return { checks, pass: checks.every((c) => c.pass), count: checks.length };
}

/** The console script for the /login document of app.arma2.com.ar (QA session), same guards as PLAN READ. */
export function browserProbe({ gatewayUrl, coreSessionKey, coreUserId, identityId, ids }) {
  const source = `${socialMatrixCases.toString()}\n${runSocialMatrix.toString()}`;
  return `(async()=>{
 const GW=${JSON.stringify(gatewayUrl)};const COMMERCIAL_RPCS=${JSON.stringify(COMMERCIAL_RPCS)};const SOCIAL_RPCS=${JSON.stringify(SOCIAL_RPCS)};const GHOST=${JSON.stringify(GHOST)};
 ${source}
 if(window.__socialOneShot)throw Error('EXCHANGE_ALREADY_ATTEMPTED_NO_RETRY');
 // The /login?returnTo=%2Fterms document (no web-access gate CSP) lands on /terms without reloading; never a Torneos page.
 if(!['/login','/terms'].includes(location.pathname))throw Error('WRONG_PAGE_STOP');
 if(performance.getEntriesByType('resource').some(e=>e.name.startsWith(GW)))throw Error('APP_ALREADY_HIT_GATEWAY_STOP');
 const session=JSON.parse(localStorage.getItem(${JSON.stringify(coreSessionKey)}));
 if(session?.user?.id!==${JSON.stringify(coreUserId)}||!session?.access_token||session.expires_at<Date.now()/1000+180)throw Error('QA_SESSION_NOT_MATCHED_OR_EXPIRING_STOP');
 const state=window.__socialOneShot={started:new Date().toISOString(),exchangeCount:0,blocked:[]};
 const original=window.fetch.bind(window);
 const allowed=p=>p.endsWith('/exchange')||p.includes('/torneos/rest/v1/rpc/')||p.includes('/torneos/public/v1/rpc/')||p.endsWith('/commerce/v1/season-checkout')||p.endsWith('/internal/v1/season-checkout-preference');
 window.fetch=async(input,init={})=>{const u=new URL(typeof input==='string'?input:input.url,location.href);const m=(init.method||'GET').toUpperCase();
  if(u.href.startsWith(GW)&&u.pathname.endsWith('/exchange')){if(state.exchangeCount!==0){state.blocked.push(u.pathname);throw Error('SECOND_EXCHANGE_PROHIBITED');}state.exchangeCount++;}
  else if(!['GET','HEAD','OPTIONS'].includes(m)&&!(u.href.startsWith(GW)&&allowed(u.pathname))){state.blocked.push(u.pathname);throw Error('WRITE_PROHIBITED');}
  return original(input,init);};
 const result={at:state.started};
 try{
  const ex=await fetch(GW+'/exchange',{method:'POST',headers:{authorization:'Bearer '+session.access_token,'content-type':'application/json'},body:'{}'});const ej=await ex.json();
  if(ex.status!==200||!ej.access_token)throw Error('EXCHANGE_FAILED_STOP '+ex.status);
  const claims=JSON.parse(atob(ej.access_token.split('.')[1].replace(/-/g,'+').replace(/_/g,'/')));
  if(claims.sub!==${JSON.stringify(identityId)}||claims.core_user_id!==session.user.id)throw Error('IDENTITY_MISMATCH_STOP');
  Object.assign(result,await runSocialMatrix({gatewayUrl:GW,fetch:window.fetch,bearer:ej.access_token,ids:${JSON.stringify(ids)}}));
  ej.access_token=null;result.exchangeCount=state.exchangeCount;result.blocked=state.blocked;
  result.finished=new Date().toISOString();result.pass=result.pass&&state.exchangeCount===1&&!state.blocked.length;
 }catch(e){result.error=e.message;result.pass=false;result.exchangeCount=state.exchangeCount;}
 window.__socialResult=result;console.log('SOCIAL_V1_PROBE_RESULT',JSON.stringify(result));
})()`;
}

// Production QA (FREE), same identities as the PLAN READ certification (OPERATOR-RUNBOOK §6/§8).
export const PRODUCTION_QA = Object.freeze({
  gatewayUrl: 'https://torneos-gateway-476836389730.southamerica-east1.run.app/functions/v1/torneos-gateway',
  coreSessionKey: 'sb-rcyuuoaqfwcembdajcss-auth-token',
  coreUserId: '44106956-4db3-4087-b721-a9463233dca5',
  identityId: '67671b64-2d14-4cfe-8c32-f13c3d9008e7',
  ids: Object.freeze({
    organizationId: 'ff425559-b729-4212-a915-2eeb0321b825',
    seasonId: '8b82d3ab-b944-4f52-b52c-5c5930409766',
    tournamentId: 'f45575dc-ddb2-4415-8d58-8950339f7ca1',
    foreignOrganizationId: 'abedfe15-c7a2-4e8e-978f-6130eef70b53',
  }),
});
