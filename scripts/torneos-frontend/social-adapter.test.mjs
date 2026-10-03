// SOCIAL-V1 — the Estudio Social half of the hybrid composition.
//   • each Social alias sends the same RPC name and p_* payload as the legacy service (the REAL legacy module
//     against a recording Core stub, the adapter against a recording transport)
//   • the client scope equals the gateway allowlist and the contract; without `social: true` it fails closed
//   • setSocialPermission, the Multimedia signer and the crest/logo resolvers never exist in the hybrid adapter
//   • invalid input fails before the network; the export branding is never coerced
//   • the composition: Social exists only with hybrid + PLAN READ + the production-eligible flag, together
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runtime } from './sandbox.mjs';
import { read } from './audit.mjs';

const ADAPTER = 'src/features/torneos/stagingV1/stagingV1WorkspaceService.js';
const LEGACY = 'src/features/torneos/api/tournamentWorkspaceService.js';
const ALLOWLIST = JSON.parse(read('backend/torneos/supabase/functions/torneos-gateway/social-v1-rpc-allowlist.json'));
const CONTRACT = JSON.parse(read('backend/torneos/social-v1/contract.json'));
const ORG = '10000000-0000-4000-8000-000000000001';
const TOURNAMENT = '30000000-0000-4000-8000-000000000001';
const CATEGORY = '40000000-0000-4000-8000-000000000001';
const PHASE = '50000000-0000-4000-8000-000000000001';
const ROUND = '60000000-0000-4000-8000-000000000001';
const uuidStub = { v4: () => 'idempotency-placeholder' };
const same = (actual, expected) => assert.deepEqual(JSON.parse(JSON.stringify(actual)), JSON.parse(JSON.stringify(expected)));
const explicitNulls = (params) => Object.fromEntries(Object.entries(params ?? {}).map(([k, v]) => [k, v === undefined ? null : v]));

function recordingTransport() {
  const calls = [];
  return { calls, transport: { rpc: async (name, params) => { calls.push({ name, params }); return { ok: true }; }, clear() {}, dispose() {} } };
}
const loadAdapter = (transport, options = {}) => runtime({ modules: { uuid: uuidStub } }).load(ADAPTER)
  .createStagingV1WorkspaceService({ transport, ...options });
function loadLegacy() {
  const calls = [];
  const supabase = {
    rpc: async (name, params) => { calls.push({ name, params }); return { data: { ok: true }, error: null }; },
    from: () => { throw new Error('no table access expected'); },
    storage: { from: () => ({ getPublicUrl: () => ({ data: { publicUrl: null } }) }) },
    functions: { invoke: async () => ({ data: null, error: null }) },
    auth: { getSession: async () => ({ data: { session: null } }) },
  };
  const rt = runtime({ modules: {
    uuid: uuidStub,
    'src/services/api/supabase.js': { supabase, default: supabase },
    'src/lib/supabaseClient.js': { supabase, supabaseCore: supabase, default: supabase },
  } });
  return { calls, service: rt.load(LEGACY).tournamentWorkspaceService };
}

const SAMPLES = {
  loadSocialStudioContext: [[ORG]],
  loadSocialSnapshot: [
    [{ organizationId: ORG, tournamentId: TOURNAMENT, categoryId: CATEGORY, phaseId: PHASE, piece: 'standings' }],
    [{ organizationId: ORG, tournamentId: TOURNAMENT, categoryId: CATEGORY, phaseId: PHASE, piece: 'round_results', roundId: ROUND }],
  ],
  authorizeSocialExport: [
    [{ organizationId: ORG, tournamentId: TOURNAMENT, piece: 'round_results', theme: 'base', includeArma2Branding: true }],
    [{ organizationId: ORG, tournamentId: TOURNAMENT, piece: 'mvp', theme: 'heritage', includeArma2Branding: false }],
  ],
};

test('each Social alias sends the same RPC name and p_* payload as the legacy service', async () => {
  const legacy = loadLegacy();
  const recorder = recordingTransport();
  const service = loadAdapter(recorder.transport, { planRead: true, social: true });
  const reached = new Set();
  for (const [alias, samples] of Object.entries(SAMPLES)) {
    for (const args of samples) {
      legacy.calls.length = 0; recorder.calls.length = 0;
      await legacy.service[alias](...args);
      await service[alias](...args);
      assert.equal(legacy.calls.length, 1, `${alias}: legacy makes one RPC`);
      assert.equal(recorder.calls.length, 1, `${alias}: adapter makes one call`);
      assert.equal(recorder.calls[0].name, legacy.calls[0].name, alias);
      same(recorder.calls[0].params, explicitNulls(legacy.calls[0].params));
      reached.add(recorder.calls[0].name);
    }
  }
  assert.deepEqual([...reached], CONTRACT.rpcs);
});

test('the client scope is the gateway allowlist and the contract, and stays closed without social: true', async () => {
  const rt = runtime({ modules: { uuid: uuidStub } });
  const { socialV1Scope, isSocialV1Operation } = rt.load('src/features/torneos/foundation/socialV1Scope.js');
  same(socialV1Scope, ALLOWLIST.features);
  assert.deepEqual(ALLOWLIST.features.social_studio, CONTRACT.rpcs);
  for (const name of CONTRACT.rpcs) assert.equal(isSocialV1Operation(name), true, name);
  for (const name of ['set_tournament_social_permission', 'get_tournament_social_snapshot_plan_legacy', 'has_tournament_social_capability', '', null]) {
    assert.equal(isSocialV1Operation(name), false, String(name));
  }
  const { createTorneosClient } = rt.load('src/features/torneos/foundation/torneosClient.js');
  const recorder = recordingTransport();
  for (const options of [{}, { planRead: true }, { social: 'true' }, { social: 1 }, { commerce: true }]) {
    const client = createTorneosClient({ transport: recorder.transport, ...options });
    for (const name of CONTRACT.rpcs) await assert.rejects(client.execute(name, {}), (e) => e.code === 'TORNEOS_OUTSIDE_STAGING_V1', `${name} ${JSON.stringify(options)}`);
  }
  const open = createTorneosClient({ transport: recorder.transport, social: true });
  await assert.rejects(open.execute('set_tournament_social_permission', {}), (e) => e.code === 'TORNEOS_OUTSIDE_STAGING_V1');
  await assert.rejects(open.execute('get_tournament_purchase', {}), (e) => e.code === 'TORNEOS_OUTSIDE_STAGING_V1');
  await assert.rejects(open.checkout({}), (e) => e.code === 'TORNEOS_OUTSIDE_STAGING_V1');
  assert.equal(recorder.calls.length, 0);
  for (const name of CONTRACT.rpcs) await open.execute(name, {});
  assert.deepEqual(recorder.calls.map((c) => c.name), CONTRACT.rpcs);
});

test('without social the adapter has no Social alias; with it, never the permission, signer or resolvers', () => {
  const recorder = recordingTransport();
  const { SOCIAL_METHODS } = runtime({ modules: { uuid: uuidStub } }).load(ADAPTER);
  assert.deepEqual([...SOCIAL_METHODS], ['loadSocialStudioContext', 'loadSocialSnapshot', 'authorizeSocialExport']);
  for (const options of [{}, { planRead: true }, { commerce: true }, { social: 'true' }]) {
    const service = loadAdapter(recorder.transport, options);
    for (const name of SOCIAL_METHODS) assert.equal(service[name], undefined, `${name} ${JSON.stringify(options)}`);
  }
  const service = loadAdapter(recorder.transport, { planRead: true, social: true });
  for (const name of SOCIAL_METHODS) assert.equal(typeof service[name], 'function', name);
  for (const name of ['setSocialPermission', 'signMediaReadUrls', 'resolveTeamShieldUrl', 'resolveTournamentLogoUrl', 'loadPurchase', 'createCheckout']) {
    assert.equal(service[name], undefined, name);
  }
  const { withoutCommerce } = runtime({ modules: { uuid: uuidStub } }).load(ADAPTER);
  const stripped = withoutCommerce(service, { planRead: true });
  for (const name of SOCIAL_METHODS) assert.equal(typeof stripped[name], 'function', `${name} survives the commerce strip`);
});

test('invalid input fails before the network and the export branding is never coerced', async () => {
  const recorder = recordingTransport();
  const service = loadAdapter(recorder.transport, { planRead: true, social: true });
  const good = { organizationId: ORG, tournamentId: TOURNAMENT, piece: 'round_results', theme: 'base', includeArma2Branding: true };
  const cases = [
    () => service.loadSocialStudioContext('not-a-uuid'),
    () => service.loadSocialStudioContext(undefined),
    () => service.loadSocialSnapshot({ organizationId: ORG, tournamentId: TOURNAMENT, categoryId: CATEGORY, phaseId: null, piece: 'standings' }),
    () => service.loadSocialSnapshot({ organizationId: ORG, tournamentId: TOURNAMENT, categoryId: CATEGORY, phaseId: PHASE, piece: null }),
    () => service.loadSocialSnapshot({ organizationId: ORG, tournamentId: TOURNAMENT, categoryId: CATEGORY, phaseId: PHASE, piece: 'standings', roundId: 'x' }),
    () => service.authorizeSocialExport({ ...good, theme: null }),
    () => service.authorizeSocialExport({ ...good, theme: undefined }),
    () => service.authorizeSocialExport({ ...good, theme: 'Base' }),
    () => service.authorizeSocialExport({ ...good, piece: null }),
    () => service.authorizeSocialExport({ ...good, piece: 'round results' }),
    () => service.authorizeSocialExport({ ...good, includeArma2Branding: null }),
    () => service.authorizeSocialExport({ ...good, includeArma2Branding: undefined }),
    () => service.authorizeSocialExport({ ...good, includeArma2Branding: 'false' }),
    () => service.authorizeSocialExport({ ...good, includeArma2Branding: 0 }),
    () => service.authorizeSocialExport({ ...good, tournamentId: 'other' }),
  ];
  for (const run of cases) await assert.rejects(run(), (e) => e.code === 'TORNEOS_INVALID_REQUEST');
  assert.equal(recorder.calls.length, 0);
});

test('Social database refusals reach the page as human copy, never as an internal code', async () => {
  const rt = runtime({ modules: { uuid: uuidStub } });
  const { TorneosBoundaryError } = rt.load('src/features/torneos/foundation/errors.js');
  const answers = {
    TORNEOS_SOCIAL_PREMIUM_REQUIRED: /Premium/, TORNEOS_BRANDING_PREMIUM_REQUIRED: /firma Arma2/,
    TORNEOS_SOCIAL_EXPORT_FORBIDDEN: /rol/, TORNEOS_SOCIAL_FORBIDDEN: /acceso/, TORNEOS_SOCIAL_SCOPE_UNAVAILABLE: /publicad/,
    TORNEOS_SOCIAL_THEME_UNKNOWN: /estilo/, TORNEOS_SOCIAL_PIECE_UNKNOWN: /placa/, TORNEOS_SOCIAL_BRANDING_INVALID: /firma/,
  };
  for (const [code, copy] of Object.entries(answers)) {
    const service = rt.load(ADAPTER).createStagingV1WorkspaceService({ planRead: true, social: true, transport: {
      rpc: async () => { const e = new TorneosBoundaryError('TORNEOS_RPC_ERROR'); e.rpcError = { code: '42501', message: code }; throw e; },
    } });
    await assert.rejects(
      service.authorizeSocialExport({ organizationId: ORG, tournamentId: TOURNAMENT, piece: 'mvp', theme: 'base', includeArma2Branding: true }),
      (e) => e.code === code && copy.test(e.message) && !/TORNEOS_|familia|family|capabilit/i.test(e.message),
      code,
    );
  }
});

test('composition: Social only with hybrid + PLAN READ + the production-eligible flag', () => {
  const rt = runtime({ modules: { uuid: uuidStub } });
  const { resolveTorneosSocialStudio } = rt.load('src/features/torneos/foundation/config.js');
  const { resolveTorneosFeatureFlags } = rt.load('src/features/torneos/config/featureFlags.js');
  const hybrid = { mode: 'hybrid', gatewayUrl: 'https://gateway.example.test/functions/v1/torneos-gateway' };
  const production = {
    NODE_ENV: 'production', REACT_APP_DEPLOY_ENV: 'production', REACT_APP_TORNEOS_DATA_ENV: 'production',
    REACT_APP_SUPABASE_URL: 'https://prodref12.supabase.co', REACT_APP_PRODUCTION_PROJECT_REF: 'prodref12',
    REACT_APP_TORNEOS_PRODUCTION_ENABLED: 'true', REACT_APP_TORNEOS_ENABLED: 'true', REACT_APP_TORNEOS_WORKSPACES_ENABLED: 'true',
    REACT_APP_TORNEOS_PLAN_READ_MODE: 'on', REACT_APP_TORNEOS_SOCIAL_GENERATOR_ENABLED: 'true',
  };
  const on = (env, backendMode = hybrid) => resolveTorneosSocialStudio(env, { backendMode, flags: resolveTorneosFeatureFlags(env) });
  assert.equal(resolveTorneosFeatureFlags(production).socialContentGenerator, true, 'eligible in certified Production');
  assert.equal(on(production), true);
  for (const value of [undefined, '', 'TRUE', 'True', '1', 'yes', 'on', ' true']) {
    assert.equal(on({ ...production, REACT_APP_TORNEOS_SOCIAL_GENERATOR_ENABLED: value }), false, `flag ${value}`);
  }
  for (const value of [undefined, 'off', 'ON', 'true']) assert.equal(on({ ...production, REACT_APP_TORNEOS_PLAN_READ_MODE: value }), false, `plan read ${value}`);
  assert.equal(on(production, { mode: 'legacy-local' }), false);
  assert.equal(on(production, { mode: 'disabled' }), false);
  assert.equal(resolveTorneosSocialStudio(production, { backendMode: hybrid }), false, 'no resolved flags: closed');
  assert.equal(on({ ...production, REACT_APP_TORNEOS_PRODUCTION_ENABLED: undefined }), false, 'Torneos closed in Production');
  assert.equal(on({ ...production, REACT_APP_SUPABASE_URL: 'https://otherref1.supabase.co' }), false, 'not the certified backend');
  const { stagingV1FeaturesFor, stagingV1Features } = rt.load('src/features/torneos/stagingV1/stagingV1Features.js');
  assert.equal(stagingV1Features.social_studio, false, 'static map: off');
  assert.equal(stagingV1FeaturesFor('off', { planRead: true }).social_studio, false);
  assert.equal(stagingV1FeaturesFor('off', { social: true }).social_studio, false, 'never without the plan read');
  const both = stagingV1FeaturesFor('off', { planRead: true, social: true });
  assert.equal(both.social_studio, true); assert.equal(both.plan, true); assert.equal(both.billing, false);
  assert.equal(both.media, false); assert.equal(both.branding_assets, false);
});
