// The SOCIAL-V1 certification matrix run offline against the real gateway source with TORNEOS_SOCIAL_MODE=on and an
// emulated PostgREST that applies the 00000000000008 rules for a FREE season. Proves the probe's expectations are the
// contract (before anyone spends a Production /exchange on it) and that the browser form is valid and guarded.
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadGatewayTree } from '../../infra/torneos-gateway-auth/gateway-loader.mjs';
import { fixtureEnv, BASE } from '../../infra/torneos-competition-v1/test-support.mjs';
import * as G from '../../infra/torneos-gateway-auth/gateway-auth-contract.mjs';
import { mintBridgeToken } from '../../infra/torneos-gateway-auth/bridge-probe.mjs';
import { runtime } from '../../../../scripts/torneos-frontend/sandbox.mjs';
import { runSocialMatrix, browserProbe, socialMatrixCases, PRODUCTION_QA, COMMERCIAL_RPCS } from './social-matrix.mjs';

const ids = { organizationId: '10000000-0000-4000-8000-000000000001', seasonId: '20000000-0000-4000-8000-000000000001', tournamentId: '30000000-0000-4000-8000-000000000001', foreignOrganizationId: '10000000-0000-4000-8000-000000000009' };
// A PEM-shaped placeholder: the in-process gateway only decodes TORNEOS_DB_SSL_CA (Postgres is stubbed), and CI has no CA file.
const TEST_CA = '-----BEGIN CERTIFICATE-----\nU09DSUFMLVYxLXRlc3QtY2E=\n-----END CERTIFICATE-----\n';
const THEMES = ['base', 'heritage', 'street', 'scoreboard', 'editorial'];
const PIECES = ['round_results', 'next_fixture', 'standings', 'mvp', 'final', 'champion', 'scorers', 'discipline', 'best_eleven', 'round_summary', 'semifinals'];
const fixture = runtime({ modules: { uuid: { v4: () => ids.tournamentId } } }).load('src/testUtils/tournamentEntitlementsFixture.js').tournamentEntitlementsFixture;
const world = { rest: [] };
globalThis.__socialProbeWorld = world;
const stub = `export default function postgres() { return { begin: async (fn) => fn({ unsafe: async (q, params) => {
  if (q.startsWith('SELECT id FROM public.torneos_identity')) return [{ id: params[0] }];
  if (q.startsWith('SET LOCAL ')) return [];
  throw new Error('Unexpected SQL (writes forbidden)');
} }), end: async () => {} }; }`;
const refuse = (status, code, message) => [status, { code, message }];
// The database, as 0008 leaves it, for a FREE season owned by the caller.
function database(name, b) {
  const own = b.p_organization_id === ids.organizationId;
  if (name === 'get_tournament_social_studio_context') return own ? [200, { capabilities: ['social.read', 'social.create', 'social.export'], tournaments: [], freeBaseFamilies: ['round_results', 'standings', 'next_fixture'] }] : refuse(403, '42501', 'TORNEOS_SOCIAL_FORBIDDEN');
  if (name === 'get_tournament_social_snapshot') return own ? refuse(403, '42501', 'TORNEOS_SOCIAL_SCOPE_UNAVAILABLE') : refuse(403, '42501', 'TORNEOS_SOCIAL_FORBIDDEN');
  if (name === 'get_effective_tournament_season_entitlements') return [200, fixture({ organizationId: ids.organizationId, seasonId: ids.seasonId, plan: 'FREE' })];
  if (name === 'authorize_tournament_social_export') {
    if (!own || b.p_tournament_id !== ids.tournamentId) return refuse(403, '42501', 'TORNEOS_SOCIAL_EXPORT_FORBIDDEN');
    if (!THEMES.includes(b.p_theme)) return refuse(400, '22023', 'TORNEOS_SOCIAL_THEME_UNKNOWN');
    if (!PIECES.includes(b.p_piece)) return refuse(400, '22023', 'TORNEOS_SOCIAL_PIECE_UNKNOWN');
    if (typeof b.p_include_arma2_branding !== 'boolean') return refuse(400, '22023', 'TORNEOS_SOCIAL_BRANDING_INVALID');
    if (b.p_theme !== 'base' || !['round_results', 'standings', 'next_fixture'].includes(b.p_piece)) return refuse(403, '42501', 'TORNEOS_SOCIAL_PREMIUM_REQUIRED');
    if (!b.p_include_arma2_branding) return refuse(403, '42501', 'TORNEOS_BRANDING_PREMIUM_REQUIRED');
    return [200, { authorized: true, organizationId: ids.organizationId, seasonId: ids.seasonId, tournamentId: ids.tournamentId, piece: b.p_piece, theme: b.p_theme, plan: 'FREE', includeArma2Branding: true }];
  }
  throw new Error(`unexpected REST ${name}`);
}
let fx, tree, gateway, originalFetch;
test.before(async () => {
  fx = fixtureEnv({ caPem: TEST_CA });
  originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    const u = String(url);
    if (u === G.GATEWAY_TOPOLOGY.coreAuthUrl + '/health') return new Response('{}', { status: 200 });
    if (u === G.GATEWAY_TOPOLOGY.coreContractUrl + '/v1/session') return new Response(JSON.stringify({ active: true, checked_at: Math.floor(Date.now() / 1000) }), { status: 200 });
    if (u.startsWith(G.GATEWAY_TOPOLOGY.torneosRestUrl + '/rpc/')) {
      const name = u.slice((G.GATEWAY_TOPOLOGY.torneosRestUrl + '/rpc/').length);
      const body = JSON.parse(typeof init.body === 'string' ? init.body : new TextDecoder().decode(init.body));
      world.rest.push(name);
      const [status, payload] = database(name, body);
      return new Response(JSON.stringify(payload), { status, headers: { 'content-type': 'application/json' } });
    }
    throw new Error('Unexpected network destination');
  };
  globalThis.Deno = { env: { toObject: () => ({ ...fx.env, TORNEOS_PLAN_READ_MODE: 'on', TORNEOS_SOCIAL_MODE: 'on' }) } };
  tree = await loadGatewayTree({ postgresModule: stub });
  gateway = await tree.import('torneos-gateway/index.ts');
});
test.after(async () => { globalThis.fetch = originalFetch; delete globalThis.Deno; delete globalThis.__socialProbeWorld; await tree.cleanup(); });

const viaGateway = async (url, init) => gateway.handle(new Request(url, { ...init, headers: { ...init.headers, host: new URL(BASE).host, origin: G.WEB_ORIGIN } }));

test('the whole matrix passes against the real gateway with SOCIAL on and the 0008 rules', async () => {
  world.rest = [];
  const result = await runSocialMatrix({ gatewayUrl: BASE, fetch: viaGateway, bearer: mintBridgeToken({ pkcs8: fx.k1.pkcs8, kid: fx.k1.kid }), ids });
  assert.deepEqual(result.checks.filter((c) => !c.pass), []);
  assert.equal(result.count, socialMatrixCases(ids).length + 6 + 3 + 2);
  // Refused RPCs never reach PostgREST.
  for (const name of ['set_tournament_social_permission', ...COMMERCIAL_RPCS]) assert.ok(!world.rest.includes(name), name);
});

test('the matrix fails if the database regressed to F1 (NULL theme authorized white-label)', async () => {
  const regressed = async (url, init) => {
    const body = JSON.parse(init.body);
    if (url.endsWith('/authorize_tournament_social_export') && body.p_theme === null) {
      return new Response(JSON.stringify({ authorized: true, plan: 'FREE', includeArma2Branding: false }), { status: 200 });
    }
    return viaGateway(url, init);
  };
  const result = await runSocialMatrix({ gatewayUrl: BASE, fetch: regressed, bearer: mintBridgeToken({ pkcs8: fx.k1.pkcs8, kid: fx.k1.kid }), ids });
  assert.equal(result.pass, false);
  assert.deepEqual(result.checks.filter((c) => !c.pass).map((c) => c.name), ['null_theme']);
});

test('the matrix fails if the gateway lets the permission RPC or a commercial RPC through', async () => {
  const leaky = async (url, init) => (url.endsWith('/set_tournament_social_permission') ? new Response('{}', { status: 200 }) : viaGateway(url, init));
  const result = await runSocialMatrix({ gatewayUrl: BASE, fetch: leaky, bearer: mintBridgeToken({ pkcs8: fx.k1.pkcs8, kid: fx.k1.kid }), ids });
  assert.deepEqual(result.checks.filter((c) => !c.pass).map((c) => c.name), ['permission_rpc_not_enabled']);
});

test('browser form: valid script, one exchange, writes refused, right page only, no token printed', () => {
  const script = browserProbe(PRODUCTION_QA);
  assert.doesNotThrow(() => new Function(script));
  for (const guard of ['EXCHANGE_ALREADY_ATTEMPTED_NO_RETRY', 'SECOND_EXCHANGE_PROHIBITED', 'WRITE_PROHIBITED', 'WRONG_PAGE_STOP', 'APP_ALREADY_HIT_GATEWAY_STOP', 'QA_SESSION_NOT_MATCHED_OR_EXPIRING_STOP', 'IDENTITY_MISMATCH_STOP']) {
    assert.ok(script.includes(guard), guard);
  }
  assert.ok(script.includes('ej.access_token=null'));
  assert.ok(script.includes("['/login','/terms'].includes(location.pathname)"), 'only the gate-free /login document (landing on /terms)');
  assert.doesNotMatch(script, /console\.log\([^)]*access_token/);
  assert.equal(PRODUCTION_QA.gatewayUrl, 'https://torneos-gateway-476836389730.southamerica-east1.run.app/functions/v1/torneos-gateway');
});
