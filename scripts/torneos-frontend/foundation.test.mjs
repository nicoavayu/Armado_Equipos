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
  same(Object.keys(stagingV1Tables), ['tournament_organization_members']);
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
  const allowed = new Set(Object.values(scopeSource).flat());
  const blocked = new Set(legacy.calls.filter(c => c.kind === 'rpc').flatMap(c => c.targets).filter(n => !allowed.has(n)));
  assert.equal(blocked.size, 126);
  for (const name of [...blocked, 'get_core_profile', '__proto__', 'constructor', '../rpc/foo', '', null, {}]) {
    await assert.rejects(client.execute(name), {code:'TORNEOS_OUTSIDE_STAGING_V1'});
  }
  for (const table of ['tournament_venues', 'tournament_courts', 'sso_probe', 'usuarios', '__proto__']) {
    await assert.rejects(client.select(table), {code:'TORNEOS_OUTSIDE_STAGING_V1'});
  }
  assert.deepEqual(calls, []);
  for (const key of ['auth', 'storage', 'from', 'rpc', 'channel', 'functions']) assert.equal(client[key], undefined);
  await client.execute('get_tournament_workspace_context', {});
  await client.select('tournament_organization_members', {});
  assert.deepEqual(calls, ['get_tournament_workspace_context', 'tournament_organization_members']);
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
  assert.deepEqual(currentLegacyRpc, legacyRpc);
  assert.equal(legacyRpc.length, 160);
  assert.deepEqual(baseline.calls.filter((c) => c.kind !== 'rpc' && legacyFiles.has(c.file)).map(strip), legacy.calls.filter((c) => c.kind !== 'rpc').map(strip));
});

test('the only backend access B04 adds is the gateway transport (fetch) and the read-only Core session bridge', () => {
  const legacyFiles = new Set(legacy.calls.map((c) => c.file));
  const added = baseline.calls.filter((c) => !legacyFiles.has(c.file)).map(({ file, kind, callee }) => ({ file, kind, callee }));
  assert.deepEqual(added, [
    { file: 'src/features/torneos/foundation/torneosClient.js', kind: 'rpc', callee: 'transport.rpc' },
    { file: 'src/features/torneos/foundation/torneosTransport.js', kind: 'transport', callee: 'window.fetch' },
    { file: 'src/features/torneos/foundation/torneosTransport.js', kind: 'transport', callee: 'fetchImpl' },
    { file: 'src/features/torneos/foundation/torneosTransport.js', kind: 'transport', callee: 'fetchImpl' },
    { file: 'src/features/torneos/stagingV1/coreSessionBridge.js', kind: 'auth', callee: 'client.auth.getSession' },
    { file: 'src/features/torneos/stagingV1/coreSessionBridge.js', kind: 'auth', callee: 'client.auth.onAuthStateChange' },
  ]);
  const legacyEdges = new Set(legacy.coreDependencies.map((c) => `${c.file} -> ${c.source}`));
  const addedEdges = baseline.coreDependencies.map((c) => `${c.file} -> ${c.source}`).filter((edge) => !legacyEdges.has(edge));
  assert.deepEqual(addedEdges, [
    'src/features/torneos/TorneosFeatureGate.jsx -> ./stagingV1/StagingV1TorneosApp',
    'src/features/torneos/stagingV1/StagingV1TorneosApp.jsx -> ../context/TorneosWorkspaceContext',
    'src/features/torneos/stagingV1/StagingV1TorneosApp.jsx -> ../components/TorneosShell',
    'src/features/torneos/stagingV1/StagingV1TorneosApp.jsx -> ./coreSessionBridge',
    'src/features/torneos/stagingV1/coreSessionBridge.js -> ../../../lib/coreSupabaseClient',
  ]);
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
    'src/features/torneos/stagingV1/stagingV1WorkspaceService.js',
  ]);
  const rt = runtime({ modules: { uuid: uuidStub } });
  rt.load(prefix+'stagingV1Service.js').createStagingV1Service();
  assert.equal(rt.creations.length, 0); assert.equal(rt.networkCalls(), 0);
});

test('audit resolves every legacy RPC dispatch; the single unresolved dispatch is the foundation gateway boundary', () => {
  assert.equal(legacy.calls.filter(c => c.kind === 'rpc' && c.targets.length === 0).length, 0);
  const actual = audit(currentSources());
  const rpc = actual.calls.filter(c => c.kind === 'rpc');
  assert.equal(rpc.length, 161);
  assert.deepEqual(rpc.filter(c => c.targets.length === 0).map(c => c.file), ['src/features/torneos/foundation/torneosClient.js']);
});

test('the audited fixture is exactly the audit of the working tree (regenerate with report.mjs on purpose)', () => {
  const { generatedFrom, legacyBase, coreSingletonSha256, ...snapshot } = baseline;
  assert.equal(legacyBase, legacy.base);
  assert.deepEqual(audit(currentSources()), snapshot);
});

test('T13 — the feature map is data: its ON keys are the Phase 2D scope keys, every shell route and nav entry is classified', () => {
  const rt = runtime();
  const { stagingV1Features, legacyFeatures, stagingV1OnFeatures } = rt.load('src/features/torneos/stagingV1/stagingV1Features.js');
  same(stagingV1OnFeatures, Object.keys(scopeSource));
  for (const key of stagingV1OnFeatures) assert.equal(stagingV1Features[key], true, key);
  for (const [key, value] of Object.entries(stagingV1Features)) if (!stagingV1OnFeatures.includes(key)) assert.equal(value, false, key);
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
    'OrganizationMembersPage', 'MyTournamentsPage', 'TeamInvitationPage', 'Navigate']);
  for (const match of shell.matchAll(/element=\{(<([A-Za-z]+)[^}]*)\}/g)) {
    const component = match[2];
    assert.ok(onPages.has(component), `route element <${component}> is neither an ON surface nor gated`);
  }
  for (const match of shell.matchAll(/element=\{gate\('([a-z_]+)',\s*<([A-Za-z]+)/g)) {
    assert.equal(stagingV1Features[match[1]], false, `gate('${match[1]}') on <${match[2]}> must gate an OFF surface`);
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
