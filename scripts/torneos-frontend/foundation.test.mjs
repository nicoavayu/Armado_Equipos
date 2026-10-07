import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { test } from 'node:test';
import { root, read, currentSources, audit, inspect } from './audit.mjs';
import { boundaryViolations, frontendLiteralViolations } from './guards.mjs';
import { runtime } from './sandbox.mjs';

// Two fixtures, no git revision (F1): the frozen legacy inventory and the audited
// integrated tree. See report.mjs.
const legacy = JSON.parse(read('docs/torneos/b04/legacy-audit.json'));
const baseline = JSON.parse(read('docs/torneos/b04/b04-audit.json'));
const scopeSource = JSON.parse(read('backend/torneos/phase2d/staging-v1-rpc-allowlist.json')).features;
// COMPETITION-V1: the full-competition contract of the gateway (authenticated `features` + anonymous `public`).
const competitionSource = JSON.parse(read('backend/torneos/supabase/functions/torneos-gateway/competition-v1-rpc-allowlist.json'));
// CONNECTED-V1: the only RPC names the connected product may add to the LOCAL single-project service.
const connectedSource = JSON.parse(read('backend/torneos/supabase/functions/torneos-gateway/connected-v1-rpc-allowlist.json'));
const CONNECTED_AUTHENTICATED = Object.values(connectedSource.features).flat();
const CONNECTED_PUBLIC = Object.values(connectedSource.public).flat();
const CONNECTED = new Set([...CONNECTED_AUTHENTICATED, ...CONNECTED_PUBLIC]);
const prefix = 'src/features/torneos/foundation/';
const uuidStub = { v4: () => 'placeholder' };
// Objects built inside the sandbox realm have another Object.prototype: compare by value.
const same = (actual, expected) => assert.deepEqual(JSON.parse(JSON.stringify(actual)), expected);

test('explicit Core export shares the exact legacy singleton and Auth options; the singleton is the audited one', () => {
  const rt = runtime({ env: { REACT_APP_SUPABASE_URL: 'https://core.example.test', REACT_APP_SUPABASE_ANON_KEY: 'public-placeholder' } });
  const explicit = rt.load('src/lib/coreSupabaseClient.js');
  const legacyClient = rt.load('src/lib/supabaseClient.js');
  assert.equal(explicit.coreSupabase, legacyClient.supabase);
  assert.equal(explicit.default, legacyClient.default);
  assert.equal(explicit.coreSupabase, legacyClient.supabaseCore);
  assert.equal(rt.creations.length, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(rt.creations[0][2].auth)), {
    persistSession: true, autoRefreshToken: true, detectSessionInUrl: false,
  });
  assert.equal(rt.networkCalls(), 0);
  assert.equal(createHash('sha256').update(read('src/lib/supabaseClient.js')).digest('hex'), baseline.coreSingletonSha256);
});

test('scope equals the existing Phase 2D allowlist exactly, including review', () => {
  const { stagingV1Scope } = runtime().load(prefix + 'stagingV1Scope.js');
  assert.deepEqual(JSON.parse(JSON.stringify(stagingV1Scope)), scopeSource);
  assert(Object.values(stagingV1Scope).flat().includes('review_tournament_team_entry'));
  assert(Object.isFrozen(stagingV1Scope));
  Object.values(stagingV1Scope).forEach((operations) => assert(Object.isFrozen(operations)));
  const { stagingV1Tables } = runtime().load(prefix + 'stagingV1Tables.js');
  same(Object.keys(stagingV1Tables), ['tournament_organization_members', 'tournament_venues', 'tournament_courts']);
});

test('COMPETITION-V1 scope equals the gateway competition allowlist exactly (authenticated features and the public route); disjoint from staging v1', () => {
  const { competitionV1Scope, competitionV1PublicScope } = runtime().load(prefix + 'competitionV1Scope.js');
  assert.deepEqual(JSON.parse(JSON.stringify(competitionV1Scope)), competitionSource.features);
  assert.deepEqual(JSON.parse(JSON.stringify(competitionV1PublicScope)), competitionSource.public);
  for (const map of [competitionV1Scope, competitionV1PublicScope]) {
    assert(Object.isFrozen(map));
    Object.values(map).forEach((operations) => assert(Object.isFrozen(operations)));
  }
  const staging = new Set(Object.values(scopeSource).flat());
  assert.deepEqual(Object.values(competitionSource.features).flat().filter((n) => staging.has(n)), []);
  assert.equal(Object.values(competitionSource.features).flat().length, 74);
  assert.deepEqual(Object.values(competitionSource.public).flat(), ['get_public_tournament_page']);
  const contract = JSON.parse(read('backend/torneos/competition-v1/contract.json'));
  const fromContract = Object.values(contract.features).flatMap((f) => Object.keys(f.rpcs).filter((n) => f.rpcs[n].route === 'authenticated'));
  assert.deepEqual(fromContract.sort(), Object.values(competitionSource.features).flat().sort());
});

test('without a transport every permitted service method is disconnected, even with enable/core arguments', async () => {
  const rt = runtime({ env: { REACT_APP_TORNEOS_ENABLED: 'true' } });
  let fallbackCalls = 0;
  const service = rt.load(prefix + 'stagingV1Service.js').createStagingV1Service({
    enabled: true, transport: () => { fallbackCalls += 1; }, core: { rpc: () => { fallbackCalls += 1; } },
  });
  assert.deepEqual(Object.keys(service), Object.keys(scopeSource));
  for (const [feature, operations] of Object.entries(scopeSource)) {
    assert.deepEqual(Object.keys(service[feature]), operations);
    assert(Object.isFrozen(service[feature]));
    for (const operation of operations) {
      await assert.rejects(service[feature][operation]({ p_organization_id: 'placeholder' }), {code:'TORNEOS_TRANSPORT_NOT_CONNECTED'});
    }
  }
  assert.equal(rt.creations.length, 0);
  assert.equal(rt.networkCalls(), 0);
  assert.equal(fallbackCalls, 0);
});

test('all legacy out-of-scope RPCs and arbitrary names fail closed before the transport; tables outside the contract too', async () => {
  const rt = runtime();
  const calls = [];
  const transport = { rpc: async (name) => { calls.push(name); return null; }, select: async (table) => { calls.push(table); return []; } };
  const client = rt.load(prefix + 'torneosClient.js').createTorneosClient({ transport });
  const allowed = new Set([...Object.values(scopeSource).flat(), ...Object.values(competitionSource.features).flat()]);
  const blocked = new Set(legacy.calls.filter(c => c.kind === 'rpc').flatMap(c => c.targets).filter(n => !allowed.has(n)));
  // 126 outside staging v1; COMPETITION-V1 routes 74 of them — 52 legacy names stay out, including the public-page
  // RPC on the authenticated client (it has its own anonymous client) and the service-only fixture/match actions.
  assert.equal(blocked.size, 52);
  for (const name of ['get_public_tournament_page', 'archive_tournament_fixture', 'postpone_tournament_match', 'lock_tournament_roster', 'create_tournament_points_adjustment']) assert.ok(blocked.has(name), name);
  for (const name of [...blocked, 'get_core_profile', '__proto__', 'constructor', '../rpc/foo', '', null, {}]) {
    await assert.rejects(client.execute(name), {code:'TORNEOS_OUTSIDE_STAGING_V1'});
  }
  for (const table of ['tournament_matches', 'tournament_match_scores', 'sso_probe', 'usuarios', '__proto__']) {
    await assert.rejects(client.select(table), {code:'TORNEOS_OUTSIDE_STAGING_V1'});
  }
  assert.deepEqual(calls, []);
  for (const key of ['auth', 'storage', 'from', 'rpc', 'channel', 'functions']) assert.equal(client[key], undefined);
  await client.execute('get_tournament_workspace_context', {});
  await client.execute('make_tournament_match_official', {});
  await client.select('tournament_organization_members', {});
  await client.select('tournament_venues', {});
  assert.deepEqual(calls, ['get_tournament_workspace_context', 'make_tournament_match_official', 'tournament_organization_members', 'tournament_venues']);
  // The anonymous public client permits exactly the public scope.
  const publicCalls = [];
  const publicClient = rt.load(prefix + 'torneosClient.js').createTorneosPublicClient({ transport: { publicRpc: async (name) => { publicCalls.push(name); return null; } } });
  for (const name of ['get_tournament_workspace_context', 'get_published_tournament_matches', 'make_tournament_match_official', '', null]) {
    await assert.rejects(publicClient.execute(name), {code:'TORNEOS_OUTSIDE_STAGING_V1'});
  }
  await publicClient.execute('get_public_tournament_page', { p_public_slug: 'x' });
  assert.deepEqual(publicCalls, ['get_public_tournament_page']);
  assert.equal(rt.networkCalls(), 0);
});

test('configuration: one gateway target, https (loopback http only for labs), never inherited from Core', () => {
  const { readDualBackendConfig, resolveTorneosBackendMode } = runtime().load(prefix + 'config.js');
  const empty = readDualBackendConfig({});
  assert.equal(empty.torneos.gatewayUrl, ''); assert.equal(empty.torneos.enabled, false);
  const config = readDualBackendConfig({REACT_APP_SUPABASE_URL:'https://core.example.test', REACT_APP_SUPABASE_ANON_KEY:'public'});
  assert.equal(config.core.url, 'https://core.example.test');
  assert.equal(config.torneos.gatewayUrl, ''); assert.equal(config.torneos.enabled, false);
  const explicit = readDualBackendConfig({ REACT_APP_CORE_SUPABASE_URL:'https://core.example.test', REACT_APP_CORE_SUPABASE_ANON_KEY:'public', REACT_APP_TORNEOS_GATEWAY_URL:'https://gateway.example.test/functions/v1/torneos-gateway/' });
  assert.equal(explicit.torneos.enabled, true);
  assert.equal(explicit.torneos.gatewayUrl, 'https://gateway.example.test/functions/v1/torneos-gateway');
  assert.equal(explicit.core.anonKey, 'public');
  const lab = readDualBackendConfig({ REACT_APP_SUPABASE_URL:'http://127.0.0.1:58421', REACT_APP_SUPABASE_ANON_KEY:'public', REACT_APP_TORNEOS_GATEWAY_URL:'http://127.0.0.1:58423' });
  assert.equal(lab.torneos.gatewayUrl, 'http://127.0.0.1:58423');
  same(resolveTorneosBackendMode({ REACT_APP_SUPABASE_URL:'https://core.example.test', REACT_APP_TORNEOS_GATEWAY_URL:'https://gateway.example.test' }), { mode: 'hybrid', reason: null, gatewayUrl: 'https://gateway.example.test' });
  same(resolveTorneosBackendMode({ REACT_APP_SUPABASE_URL:'http://127.0.0.1:57321', REACT_APP_TORNEOS_DATA_ENV: 'local' }), { mode: 'legacy-local', reason: null, gatewayUrl: '' });
  same(resolveTorneosBackendMode({ REACT_APP_SUPABASE_URL:'https://core.example.test', REACT_APP_TORNEOS_DATA_ENV: 'staging' }), { mode: 'disabled', reason: 'TORNEOS_GATEWAY_NOT_CONFIGURED', gatewayUrl: '' });
  assert.equal(resolveTorneosBackendMode({ REACT_APP_SUPABASE_URL:'https://core.example.test', REACT_APP_TORNEOS_GATEWAY_URL:'https://core.example.test/torneos' }).mode, 'disabled');
});

test('configuration rejects partial/conflicting Core aliases, Core/Torneos collisions, non-https remote targets and the Production ref', () => {
  const { readDualBackendConfig } = runtime().load(prefix + 'config.js');
  assert.throws(() => readDualBackendConfig({ REACT_APP_CORE_SUPABASE_URL:'https://core.example.test' }), /CORE_CONFIG_INCOMPLETE/);
  assert.throws(() => readDualBackendConfig({ REACT_APP_CORE_SUPABASE_URL:'https://other.example.test', REACT_APP_CORE_SUPABASE_ANON_KEY:'public', REACT_APP_SUPABASE_URL:'https://core.example.test' }), /CORE_CONFIG_CONFLICT/);
  assert.throws(() => readDualBackendConfig({ REACT_APP_SUPABASE_URL:'https://core.example.test', REACT_APP_TORNEOS_GATEWAY_URL:'https://core.example.test/torneos' }), /TORNEOS_CORE_TARGET_COLLISION/);
  assert.throws(() => readDualBackendConfig({ REACT_APP_SUPABASE_URL:'not a url', REACT_APP_TORNEOS_GATEWAY_URL:'https://gateway.example.test' }), /CORE_CONFIG_INVALID/);
  for (const invalid of ['http://gateway.example.test', 'https://user:password@gateway.example.test', 'https://gateway.example.test?key=secret', 'https://gateway.example.test#fragment', 'ftp://127.0.0.1', 'nonsense']) {
    assert.throws(() => readDualBackendConfig({ REACT_APP_TORNEOS_GATEWAY_URL: invalid }), /TORNEOS_CONFIG_INVALID/, invalid);
  }
  const productionRef = 'abcdefghijklmnopqrst';
  for (const target of [`https://${productionRef}.supabase.co/functions/v1/torneos-gateway`, `https://${productionRef}.functions.supabase.co`]) {
    assert.throws(() => readDualBackendConfig({ REACT_APP_PRODUCTION_PROJECT_REF: productionRef, REACT_APP_TORNEOS_GATEWAY_URL: target }), /TORNEOS_CONFIG_PRODUCTION_TARGET/, target);
  }
});

test('backend access reachable from Torneos matches the audited fixture exactly; the legacy RPC inventory did not grow or move', () => {
  assert.deepEqual(boundaryViolations(currentSources(), baseline), []);
  const strip = (c) => { const { line, ...rest } = c; return rest; };
  const legacyFiles = new Set(legacy.calls.map((c) => c.file));
  const legacyRpc = legacy.calls.filter((c) => c.kind === 'rpc').map(strip);
  const currentLegacyRpc = baseline.calls.filter((c) => c.kind === 'rpc' && legacyFiles.has(c.file)).map(strip);
  // CONNECTED-V1 adds the connected product to the LOCAL single-project service: exactly the authenticated names of
  // its gateway contract (the hybrid adapter serves the same aliases through the gateway), nothing else. Every
  // earlier legacy call stays where it was.
  const isConnected = (c) => c.targets.length > 0 && c.targets.every((target) => CONNECTED.has(target));
  assert.deepEqual(currentLegacyRpc.filter((c) => !isConnected(c)), legacyRpc);
  assert.deepEqual(currentLegacyRpc.filter(isConnected).flatMap((c) => c.targets).sort(), [...CONNECTED_AUTHENTICATED].sort());
  assert.equal(legacyRpc.length, 160);
  assert.deepEqual(baseline.calls.filter((c) => c.kind !== 'rpc' && legacyFiles.has(c.file)).map(strip), legacy.calls.filter((c) => c.kind !== 'rpc').map(strip));
});

test('the only backend access B04 adds is the gateway transport (fetch) and the read-only Core session bridge', () => {
  const legacyFiles = new Set(legacy.calls.map((c) => c.file));
  const added = baseline.calls.filter((c) => !legacyFiles.has(c.file)).map(({ file, kind, callee }) => ({ file, kind, callee }));
  assert.deepEqual(added, [
    { file: 'src/features/torneos/foundation/torneosClient.js', kind: 'rpc', callee: 'transport.rpc' },
    // MEDIA-V1: the photo upload to the gateway's media route with real byte progress (XMLHttpRequest; fetch where it
    // does not exist). Same gateway, same bearer and failure mapping as every other route of the transport.
    { file: 'src/features/torneos/foundation/torneosTransport.js', kind: 'transport', callee: 'fetchImpl' },
    { file: 'src/features/torneos/foundation/torneosTransport.js', kind: 'transport', callee: 'XMLHttpRequest' },
    { file: 'src/features/torneos/foundation/torneosTransport.js', kind: 'transport', callee: 'window.fetch' },
    { file: 'src/features/torneos/foundation/torneosTransport.js', kind: 'transport', callee: 'fetchImpl' },
    { file: 'src/features/torneos/foundation/torneosTransport.js', kind: 'transport', callee: 'fetchImpl' },
    // COMPETITION-V1: the anonymous public read-only route of the gateway (no credential).
    { file: 'src/features/torneos/foundation/torneosTransport.js', kind: 'transport', callee: 'window.fetch' },
    { file: 'src/features/torneos/foundation/torneosTransport.js', kind: 'transport', callee: 'fetchImpl' },
    { file: 'src/features/torneos/stagingV1/coreSessionBridge.js', kind: 'auth', callee: 'client.auth.getSession' },
    { file: 'src/features/torneos/stagingV1/coreSessionBridge.js', kind: 'auth', callee: 'client.auth.onAuthStateChange' },
  ].concat([
    // CONNECTED-V1: Explorar torneos on the LOCAL single-project stack (the hybrid composition reaches the same three
    // public RPCs through the gateway's public route) and the home's visual preference (never an authorization).
    { file: 'src/features/torneos/api/publicCatalogService.js', kind: 'rpc', callee: 'supabase.rpc' },
    { file: 'src/features/torneos/api/publicCatalogService.js', kind: 'rpc', callee: 'supabase.rpc' },
    { file: 'src/features/torneos/api/publicCatalogService.js', kind: 'rpc', callee: 'supabase.rpc' },
    { file: 'src/features/torneos/components/TorneosLanding.jsx', kind: 'persistence', callee: 'window.localStorage.getItem' },
    { file: 'src/features/torneos/components/TorneosLanding.jsx', kind: 'persistence', callee: 'window.localStorage.setItem' },
  ]).sort((a, b) => `${a.file}\u0000${a.kind}`.localeCompare(`${b.file}\u0000${b.kind}`)));
  for (const call of baseline.calls.filter((c) => c.file === 'src/features/torneos/api/publicCatalogService.js')) {
    assert.ok(call.targets.length === 1 && CONNECTED_PUBLIC.includes(call.targets[0]), `public catalog call ${call.targets}`);
  }
  const legacyEdges = new Set(legacy.coreDependencies.map((c) => `${c.file} -> ${c.source}`));
  const addedEdges = baseline.coreDependencies.map((c) => `${c.file} -> ${c.source}`).filter((edge) => !legacyEdges.has(edge));
  // MP-A5 adds the commerce context: Plan/PurchaseStatus read commerce from it, its default is the
  // legacy adapter (the only path from those pages to the legacy service) and the hybrid composition
  // always overrides it (torneosMpA5HybridCommerce.test.jsx traps both the singleton and the adapter).
  // Compared as a set: the edges are what matters, not the order the audit lists them in.
  assert.deepEqual([...addedEdges].sort(), [
    'src/features/torneos/TorneosFeatureGate.jsx -> ./stagingV1/StagingV1TorneosApp',
    'src/features/torneos/api/legacyCommerceAdapter.js -> ./tournamentWorkspaceService',
    // OFFICIALIZATION-V1: the organization invitation page accepts through the MOUNTED composition's service
    // (hybrid: the gateway's Core-attested route; legacy LOCAL: no alias, the button stays disabled).
    'src/features/torneos/components/OrganizationInvitationPage.jsx -> ../context/TorneosWorkspaceContext',
    // COMPETITION-V1: the public-page route composes the page; the legacy public service (the page's old
    // default) is handed only to the LOCAL single-project composition — hybrid/closed never call it.
    'src/features/torneos/components/PublicTournamentRoute.jsx -> ./PublicTournamentPage',
    'src/features/torneos/components/PublicTournamentRoute.jsx -> ../api/publicTournamentService',
    'src/features/torneos/components/PurchaseStatusPage.jsx -> ../context/TorneosCommerceContext',
    // COMMERCE-PRODUCTION: Mi plan's purchase panel reads the MOUNTED composition's commerce (hybrid: the gateway's commerce
    // routes; the context's legacy default is the same one PurchaseStatusPage already reaches and is never used in hybrid).
    'src/features/torneos/components/PlanExperiencePage.jsx -> ../context/TorneosCommerceContext',
    'src/features/torneos/components/PlanExperiencePage.jsx -> ./PremiumPurchasePanel',
    'src/features/torneos/components/PremiumPurchasePanel.jsx -> ../context/TorneosCommerceContext',
    // COMPETITION-V1: the wizard hands its settings panels the MOUNTED composition's service (their own
    // default is the legacy Core service, which a hybrid wizard must never reach).
    'src/features/torneos/components/TorneosShell.jsx -> ./OrganizationInvitationPage',
    'src/features/torneos/components/TournamentWizardPage.jsx -> ../context/TorneosWorkspaceContext',
    'src/features/torneos/context/TorneosCommerceContext.jsx -> ../api/legacyCommerceAdapter',
    'src/features/torneos/stagingV1/StagingV1TorneosApp.jsx -> ../context/TorneosWorkspaceContext',
    'src/features/torneos/stagingV1/StagingV1TorneosApp.jsx -> ../context/TorneosCommerceContext',
    'src/features/torneos/stagingV1/StagingV1TorneosApp.jsx -> ../components/TorneosShell',
    'src/features/torneos/stagingV1/StagingV1TorneosApp.jsx -> ./coreSessionBridge',
    'src/features/torneos/stagingV1/coreSessionBridge.js -> ../../../lib/coreSupabaseClient',
  ].concat([
    // CONNECTED-V1 — the connected product. Pages read the MOUNTED composition's service from the workspace context
    // (never a default Core service); the catalog reaches the legacy public service only on the LOCAL stack, through
    // the same composition rule as the public page. The shared identity is only READ, from the session context alone
    // (components/AuthContext: no backend access, so not an edge here). One edge leaves the feature on purpose: the
    // Torneos profile's «Cerrar sesión» is the common account's own sign-out, loaded only when the person asks for it.
    'src/features/torneos/api/publicCatalogService.js -> ../../../services/api/supabase',
    'src/features/torneos/components/MyTournamentsPage.jsx -> ./connected/MyRegistrationsSection',
    'src/features/torneos/components/PublicTournamentRoute.jsx -> ../stagingV1/publicTournamentComposition',
    'src/features/torneos/components/PublicTournamentRoute.jsx -> ../api/publicCatalogService',
    'src/features/torneos/components/TeamsPage.jsx -> ./connected/CatalogEntryStrip',
    'src/features/torneos/components/TorneosLanding.jsx -> ./connected/MyRegistrationsSection',
    'src/features/torneos/components/TorneosLanding.jsx -> ./connected/useTorneosProfile',
    'src/features/torneos/components/TorneosShell.jsx -> ./connected/TorneosAccountMenu',
    'src/features/torneos/components/TorneosShell.jsx -> ./connected/TorneosInboxBell',
    'src/features/torneos/components/TorneosShell.jsx -> ./connected/useTorneosInboxSummary',
    'src/features/torneos/components/TorneosShell.jsx -> ./connected/PersonalNavigation',
    'src/features/torneos/components/TorneosShell.jsx -> ./connected/ExplorePage',
    'src/features/torneos/components/TorneosShell.jsx -> ./connected/CatalogCallPage',
    'src/features/torneos/components/TorneosShell.jsx -> ./connected/TournamentApplicationPage',
    'src/features/torneos/components/TorneosShell.jsx -> ./connected/TorneosInboxPage',
    'src/features/torneos/components/TorneosShell.jsx -> ./connected/TorneosProfilePage',
    'src/features/torneos/components/TorneosShell.jsx -> ./connected/ParticipantTeamRoute',
    'src/features/torneos/components/TorneosShell.jsx -> ./connected/CatalogListingPage',
    'src/features/torneos/components/TorneosShell.jsx -> ./connected/ApplicationInboxPage',
    'src/features/torneos/components/connected/ApplicationInboxPage.jsx -> ../../context/TorneosWorkspaceContext',
    'src/features/torneos/components/connected/CatalogCallPage.jsx -> ./useCatalogService',
    'src/features/torneos/components/connected/CatalogEntryStrip.jsx -> ../../context/TorneosWorkspaceContext',
    'src/features/torneos/components/connected/CatalogListingPage.jsx -> ../../context/TorneosWorkspaceContext',
    'src/features/torneos/components/connected/CatalogListingPage.jsx -> ../TournamentPublicPageSettings',
    'src/features/torneos/components/connected/ExplorePage.jsx -> ./useCatalogService',
    'src/features/torneos/components/connected/MyRegistrationsSection.jsx -> ../../context/TorneosWorkspaceContext',
    'src/features/torneos/components/connected/ParticipantTeamRoute.jsx -> ../../context/TorneosWorkspaceContext',
    'src/features/torneos/components/connected/PersonalNavigation.jsx -> ./useTorneosInboxSummary',
    'src/features/torneos/components/connected/PublicCatalogRoute.jsx -> ./useCatalogService',
    'src/features/torneos/components/connected/TorneosAccountMenu.jsx -> ./useTorneosProfile',
    'src/features/torneos/components/connected/TorneosInboxBell.jsx -> ./useTorneosInboxSummary',
    'src/features/torneos/components/connected/TorneosInboxPage.jsx -> ../../context/TorneosWorkspaceContext',
    'src/features/torneos/components/connected/TorneosInboxPage.jsx -> ../MyCommunicationsPage',
    'src/features/torneos/components/connected/TorneosInboxPage.jsx -> ./useTorneosInboxSummary',
    'src/features/torneos/components/connected/TorneosProfilePage.jsx -> ../../context/TorneosWorkspaceContext',
    'src/features/torneos/components/connected/TorneosProfilePage.jsx -> ./useTorneosProfile',
    'src/features/torneos/components/connected/TorneosProfilePage.jsx -> ../../../../services/authLogoutService',
    'src/features/torneos/components/connected/TournamentApplicationPage.jsx -> ../../context/TorneosWorkspaceContext',
    'src/features/torneos/components/connected/TournamentApplicationPage.jsx -> ./CatalogCallPage',
    'src/features/torneos/components/connected/TournamentApplicationPage.jsx -> ./useCatalogService',
    'src/features/torneos/components/connected/TournamentApplicationPage.jsx -> ./useTorneosProfile',
    'src/features/torneos/components/connected/useCatalogService.js -> ../../api/publicCatalogService',
    'src/features/torneos/components/connected/useCatalogService.js -> ../../stagingV1/publicTournamentComposition',
    'src/features/torneos/components/connected/useTorneosInboxSummary.jsx -> ../../context/TorneosWorkspaceContext',
    // PR #182 closure. Explorar shows each call with the public page's own branding (BrandingImage: the tournament's
    // logo, else the organization's, else initials; the hybrid composition strips storage paths, so only initials).
    'src/features/torneos/components/connected/TournamentCatalog.jsx -> ../BrandingImage',
    'src/features/torneos/components/connected/ExplorePage.jsx -> ./TournamentCatalog',
    'src/features/torneos/components/connected/PublicCatalogRoute.jsx -> ./TournamentCatalog',
    // The space selector's «Torneos has unread notices» dot, read while the person is in Core: one aggregated RPC
    // through the composition's rule (LOCAL service on the QA stack; the gateway with the read-only session bridge).
    'src/features/torneos/stagingV1/torneosInboxProbe.js -> ../api/tournamentWorkspaceService',
    'src/features/torneos/stagingV1/torneosInboxProbe.js -> ./coreSessionBridge',
    // BRANDING-V1: the upload field stores the asset through the MOUNTED composition's service (hybrid: the gateway's
    // object route; LOCAL: its storage service, the field's previous default, still the fallback).
    'src/features/torneos/components/BrandingAssetField.jsx -> ../context/TorneosWorkspaceContext',
    // The call and the request show the tournament's logo with the same branding rule as the card and the public page.
    'src/features/torneos/components/connected/CatalogCallPage.jsx -> ../BrandingImage',
    'src/features/torneos/components/connected/TournamentApplicationPage.jsx -> ../BrandingImage',
    // Arma2's external notices are a preference of the common account (Core's own RPC, auth.uid() only), changed from
    // the Torneos profile like the account's sign-out: loaded only on that page (read, then change).
    'src/features/torneos/components/connected/TorneosProfilePage.jsx -> ../../../../services/corePushPreferenceService',
    'src/features/torneos/components/connected/TorneosProfilePage.jsx -> ../../../../services/corePushPreferenceService',
    'src/features/torneos/components/connected/useTorneosProfile.js -> ../../context/TorneosWorkspaceContext',
    'src/features/torneos/stagingV1/publicTournamentComposition.js -> ../api/publicCatalogService',
  ]).sort());
  // The bridge reads the session; it never signs in/out, sets a session or touches data.
  const bridge = inspect('src/features/torneos/stagingV1/coreSessionBridge.js', read('src/features/torneos/stagingV1/coreSessionBridge.js'));
  assert.deepEqual(bridge.calls.map((c) => c.callee), ['client.auth.getSession', 'client.auth.onAuthStateChange']);
});

test('guard catches direct, aliased and transitive Core imports plus second login and RPC bypasses', () => {
  const mutations = [
    "import { coreSupabase as client } from '../../../lib/coreSupabaseClient'; client.rpc('new_rpc');",
    "import { supabase as client } from '../../../services/api/supabase'; client.auth.signInWithPassword({});",
    "import { loadTournamentWorkspaceContext } from '../api/tournamentWorkspaceService';",
    "import { createClient } from '@supabase/supabase-js'; createClient(url,key);",
    "client['rpc']('lock_tournament_roster');",
    "const rpc = 'new_rpc'; client.rpc(rpc);",
    "client.auth.setSession(session);",
    "fetch('/torneos/rest/v1/rpc/new_rpc');",
    "localStorage.setItem('session',token);",
    "const x = require(modulePath);",
  ];
  for (const source of mutations) {
    const sources = currentSources(); sources.set(prefix+'accidental.js',source);
    assert(boundaryViolations(sources, baseline).length > 0, source);
  }
  for (const source of mutations.slice(0, 2)) {
    const sources = currentSources(); sources.set('src/features/torneos/stagingV1/accidental.js', source);
    assert(boundaryViolations(sources, baseline).length > 0, `stagingV1: ${source}`);
  }
  const sources = currentSources();
  sources.set('src/utils/accidental.js', "export { supabase as other } from '../lib/supabaseClient';");
  sources.set('src/features/torneos/components/Accidental.jsx', "import { other } from '../../../utils/accidental';");
  assert(boundaryViolations(sources, baseline).some(v => v.includes('Core dependency')));
});

test('T1 — no second login anywhere in the frontend: createClient/signIn/setSession/persistSession only in the Core singleton and the Phase 1.5 lab', () => {
  const allowed = new Set(['src/lib/supabaseClient.js', 'src/features/torneos/isolated/createTorneosClient.js']);
  const offenders = [];
  for (const [file, source] of currentSources()) {
    if (allowed.has(file) || !file.startsWith('src/features/torneos/')) continue;
    const module = inspect(file, source);
    for (const call of module.calls) {
      if (/(^|\.)createClient$/.test(call.callee) || /\.auth\.(signIn\w*|signUp|setSession|refreshSession|startAutoRefresh|signOut)$/.test(call.callee)) {
        offenders.push(`${file}:${call.line} ${call.callee}`);
      }
    }
    if (/persistSession\s*:\s*true/.test(source)) offenders.push(`${file} persistSession`);
  }
  assert.deepEqual(offenders, []);
});

test('guard detects secrets, privileged JWTs, hardcoded endpoints and production ref', () => {
  const jwt = ['eyJhbGciOiJIUzI1NiJ9', Buffer.from(JSON.stringify({role:'service_role'})).toString('base64url'), 'fake'].join('.');
  for (const source of ['const key = "sb_secret_fake";', 'process.env.REACT_APP_SUPABASE_SERVICE_ROLE_KEY', jwt, 'https://backend.example.test', 'rcyuuoaqfwcembdajcss', 'abcdefghijklmnopqrst']) {
    assert(frontendLiteralViolations(source).length > 0, source);
  }
});

// CONNECTED-V1: the organizer's optional WhatsApp contact opens WhatsApp's public click-to-chat link (the same one
// Core's share button uses). It is a link the person follows, not a backend target; no other URL is allowed.
const EXTERNAL_LINKS = new Map([['src/features/torneos/domain/connectedProduct.js', ['https://wa.me/']]]);

test('new/changed frontend and config lines contain no secrets or hardcoded targets', () => {
  const tracked = execFileSync('git', ['diff','--name-only','HEAD','--','src','config'], {cwd:root,encoding:'utf8'}).trim().split('\n');
  const untracked = execFileSync('git', ['ls-files','--others','--exclude-standard','--','src','config'], {cwd:root,encoding:'utf8'}).trim().split('\n');
  for (const file of new Set([...tracked,...untracked].filter(Boolean))) {
    if (!fs.existsSync(path.join(root,file))) continue;
    let added = read(file);
    if (!untracked.includes(file)) {
      added = execFileSync('git', ['diff','--unified=0','HEAD','--',file], {cwd:root,encoding:'utf8'})
        .split('\n').filter(l => l.startsWith('+') && !l.startsWith('+++')).join('\n');
    }
    // Tests may name example endpoints (gateway.example.test); they still may not carry credentials.
    const isTest = /(__tests__|\.test\.)/.test(file);
    for (const link of EXTERNAL_LINKS.get(file) || []) {
      assert.ok(added.includes(link), `${file}: the allowed link ${link} is no longer used; drop the exception`);
      added = added.split(link).join('');
    }
    assert.deepEqual(frontendLiteralViolations(added).filter((v) => !(isTest && v === 'Hardcoded endpoint/ref')), [], file);
  }
  // Wherever the tree ends up, the foundation and the composition carry no target at all.
  for (const dir of ['src/features/torneos/foundation', 'src/features/torneos/stagingV1']) {
    for (const entry of fs.readdirSync(path.join(root, dir))) assert.deepEqual(frontendLiteralViolations(read(`${dir}/${entry}`)), [], entry);
  }
});

test('foundation is consumed only by the staging-v1 composition and the feature gate; never by the legacy service, providers or pages', () => {
  const consumers = [];
  for (const [file, source] of currentSources()) {
    if (file.includes('/foundation/')) continue;
    if (/from\s+['"][^'"]*foundation\//.test(source)) consumers.push(file);
  }
  assert.deepEqual(consumers.sort(), [
    'src/features/torneos/TorneosFeatureGate.jsx',
    'src/features/torneos/stagingV1/StagingV1TorneosApp.jsx',
    'src/features/torneos/stagingV1/coreSessionBridge.js',
    'src/features/torneos/stagingV1/publicTournamentComposition.js',
    'src/features/torneos/stagingV1/stagingV1WorkspaceService.js',
    'src/features/torneos/stagingV1/torneosInboxProbe.js',
  ]);
  const rt = runtime({ modules: { uuid: uuidStub } });
  rt.load(prefix+'stagingV1Service.js').createStagingV1Service();
  assert.equal(rt.creations.length, 0); assert.equal(rt.networkCalls(), 0);
});

test('audit resolves every legacy RPC dispatch; the single unresolved dispatch is the foundation gateway boundary', () => {
  assert.equal(legacy.calls.filter(c => c.kind === 'rpc' && c.targets.length === 0).length, 0);
  const actual = audit(currentSources());
  const rpc = actual.calls.filter(c => c.kind === 'rpc');
  // 161 audited dispatches + CONNECTED-V1: the 14 authenticated aliases of the LOCAL service and the 3 public catalog reads.
  assert.equal(rpc.length, 161 + CONNECTED_AUTHENTICATED.length + CONNECTED_PUBLIC.length);
  assert.deepEqual(rpc.filter(c => c.targets.length === 0).map(c => c.file), ['src/features/torneos/foundation/torneosClient.js']);
});

test('the audited fixture is exactly the audit of the working tree (regenerate with report.mjs on purpose)', () => {
  const { generatedFrom, legacyBase, coreSingletonSha256, ...snapshot } = baseline;
  assert.equal(legacyBase, legacy.base);
  assert.deepEqual(audit(currentSources()), snapshot);
});

test('T13 — the feature map is data: its ON keys are the Phase 2D + COMPETITION-V1 + OFFICIALIZATION-V1 scope keys, every shell route and nav entry is classified', () => {
  const rt = runtime();
  const { stagingV1Features, legacyFeatures, stagingV1OnFeatures, competitionV1OnFeatures, officializationV1OnFeatures } = rt.load('src/features/torneos/stagingV1/stagingV1Features.js');
  same(stagingV1OnFeatures, Object.keys(scopeSource));
  same(competitionV1OnFeatures, Object.keys(competitionSource.features));
  same(officializationV1OnFeatures, Object.keys(JSON.parse(read('backend/torneos/supabase/functions/torneos-gateway/officialization-v1-rpc-allowlist.json')).features));
  const on = [...stagingV1OnFeatures, ...competitionV1OnFeatures, ...officializationV1OnFeatures];
  for (const key of on) assert.equal(stagingV1Features[key], true, key);
  for (const [key, value] of Object.entries(stagingV1Features)) if (!on.includes(key)) assert.equal(value, false, key);
  // Never on in hybrid without its own certification: media, social studio, billing, branding uploads.
  for (const key of ['media', 'social_studio', 'billing', 'plan', 'entitlements', 'branding_assets', 'player_portraits', 'team_photos', 'team_visual_policy', 'roster_lock']) {
    assert.equal(stagingV1Features[key], false, key);
  }
  assert.ok(Object.values(legacyFeatures).every((v) => v === true));
  same(Object.keys(legacyFeatures), Object.keys(stagingV1Features));
  const shell = read('src/features/torneos/components/TorneosShell.jsx');
  for (const feature of [...shell.matchAll(/gate\('([a-z_]+)'/g)].map((m) => m[1])) {
    assert.ok(feature in stagingV1Features, `gate('${feature}') names an unknown feature`);
  }
  for (const feature of [...shell.matchAll(/feature: '([a-z_]+)'/g)].map((m) => m[1])) {
    assert.ok(feature in stagingV1Features, `nav feature '${feature}' is unknown`);
  }
  // Every routed page element is either an ON surface or wrapped by gate().
  const onPages = new Set(['TorneosLanding', 'CreateOrganizationPage', 'OrganizationRouteGuard', 'TorneosDashboard', 'SeasonFormPage',
    'CompetitionOverviewPage', 'TournamentWizardPage', 'TeamEntryRedirect', 'TeamRegistrationPage', 'TournamentConfigurationRedirect',
    'TournamentRouteGuard', 'CanonicalIndexRedirect', 'TeamsPage', 'NewTeamEntryPage', 'LegacyTournamentRoute', 'OrganizationSettingsPage',
    'OrganizationMembersPage', 'MyTournamentsPage', 'TeamInvitationPage', 'Navigate',
    // CONNECTED-V1: surfaces every composition serves (degrading without the connected product): the Torneos inbox
    // falls back to the official communications, the profile to the shared identity read-only, and the team route
    // only uses the staging v1 registration context.
    'TorneosInboxPage', 'TorneosProfilePage', 'ParticipantTeamRoute']);
  for (const match of shell.matchAll(/element=\{(<([A-Za-z]+)[^}]*)\}/g)) {
    const component = match[2];
    assert.ok(onPages.has(component), `route element <${component}> is neither an ON surface nor gated`);
  }
  for (const match of shell.matchAll(/element=\{gate\('([a-z_]+)',\s*<([A-Za-z]+)/g)) {
    assert.ok(stagingV1Features[match[1]] === false || competitionV1OnFeatures.includes(match[1]) || officializationV1OnFeatures.includes(match[1]),
      `gate('${match[1]}') on <${match[2]}> must gate an OFF surface, a COMPETITION-V1 or an OFFICIALIZATION-V1 surface`);
  }
});

test('the prebuild validation applies the same gateway-target rule as the runtime config', async () => {
  const { validateTorneosGatewayTarget } = await import('../validate-build-env.mjs');
  const { readDualBackendConfig } = runtime().load(prefix + 'config.js');
  const productionRef = 'abcdefghijklmnopqrst';
  const cases = [
    { REACT_APP_SUPABASE_URL: 'https://core.example.test', REACT_APP_TORNEOS_GATEWAY_URL: 'https://gateway.example.test/functions/v1/torneos-gateway' },
    { REACT_APP_SUPABASE_URL: 'http://127.0.0.1:58421', REACT_APP_TORNEOS_GATEWAY_URL: 'http://127.0.0.1:58423' },
    { REACT_APP_SUPABASE_URL: 'https://core.example.test' },
    { REACT_APP_SUPABASE_URL: 'https://core.example.test', REACT_APP_TORNEOS_GATEWAY_URL: 'http://gateway.example.test' },
    { REACT_APP_SUPABASE_URL: 'https://core.example.test', REACT_APP_TORNEOS_GATEWAY_URL: 'https://gateway.example.test?k=v' },
    { REACT_APP_SUPABASE_URL: 'https://core.example.test', REACT_APP_TORNEOS_GATEWAY_URL: 'https://core.example.test/torneos' },
    { REACT_APP_SUPABASE_URL: 'https://core.example.test', REACT_APP_PRODUCTION_PROJECT_REF: productionRef, REACT_APP_TORNEOS_GATEWAY_URL: `https://${productionRef}.supabase.co/functions/v1/torneos-gateway` },
    { REACT_APP_SUPABASE_URL: 'https://core.example.test', REACT_APP_TORNEOS_GATEWAY_URL: 'nonsense' },
  ];
  for (const env of cases) {
    let runtimeRejects = false;
    try { readDualBackendConfig(env); } catch { runtimeRejects = true; }
    assert.equal(Boolean(validateTorneosGatewayTarget(env)), runtimeRejects, JSON.stringify(env));
  }
});
