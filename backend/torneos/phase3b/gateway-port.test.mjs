// Phase 3B — offline unit certification of the Edge gateway port (no Docker, no network).
// The real TypeScript of backend/torneos/supabase/functions/torneos-gateway is transpiled the
// same way scripts/edge-functions/*.test.mjs do for Core functions; `npm:` specifiers are
// mapped to the lab's node_modules (jose is the very same library the Node gateway uses), the
// database driver is replaced by a recording stub. What is proven here:
//   • token.ts ≡ integration/torneos-sso/token.mjs: tokens cross-verify both ways, the same
//     contract violations are rejected, constants are identical;
//   • core-client.ts validate() ≡ core-client.mjs validate() on the Phase 2A schemas;
//   • adapter.ts CONTRACTS/mapSqlError ≡ adapter.mjs; the adapter never runs as the user;
//   • config.ts fails closed on every missing/malformed value and refuses Production;
//   • the JSON documents bundled in the function are byte-identical to their canonical sources;
//   • the function tree contains no secret material.
// Run: node --test backend/torneos/phase3b/gateway-port.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../../..');
const FN = path.join(ROOT, 'backend/torneos/supabase/functions/torneos-gateway');
const LAB = path.join(ROOT, 'integration/torneos-core-contracts');
const labRequire = createRequire(path.join(LAB, 'package.json'));
const ts = (await import(pathToFileURL(path.join(ROOT, 'node_modules/typescript/lib/typescript.js')).href)).default;
const jose = await import(pathToFileURL(labRequire.resolve('jose')).href);
const nodeToken = await import(pathToFileURL(path.join(ROOT, 'integration/torneos-sso/token.mjs')).href);
// The Node modules resolve ./schemas.json next to themselves (a lab mount): stage them with it.
const NODE_STAGE = await fs.mkdtemp(path.join(os.tmpdir(), 'arma2-node-gateway-'));
for (const f of ['core-client.mjs', 'adapter.mjs']) {
  const src = await fs.readFile(path.join(LAB, f), 'utf8');
  await fs.writeFile(path.join(NODE_STAGE, f), src.replace(/from 'node:crypto'/, `from 'node:crypto'`));
}
await fs.copyFile(path.join(ROOT, 'backend/torneos/phase2a/schemas.json'), path.join(NODE_STAGE, 'schemas.json'));
const nodeCoreClient = await import(pathToFileURL(path.join(NODE_STAGE, 'core-client.mjs')).href);
const nodeAdapter = await import(pathToFileURL(path.join(NODE_STAGE, 'adapter.mjs')).href);

const FILES = ['token.ts', 'core-client.ts', 'db.ts', 'adapter.ts', 'config.ts', 'index.ts'];
const JOSE_URL = pathToFileURL(labRequire.resolve('jose')).href;

async function loadPort() {
  const outDir = await fs.mkdtemp(path.join(os.tmpdir(), 'arma2-gateway-port-'));
  // Recording stub of npm:postgres — the port must never be able to reach a database here.
  const calls = [];
  await fs.writeFile(path.join(outDir, 'postgres-stub.mjs'), `export const calls = [];
export default function postgres(url, options) {
  const sql = { url, options, begin: async (fn) => fn({ unsafe: async (q, params) => { calls.push({ q, params }); return [{ authorization: { identity_id: 'x', request_hash: 'h', core_request: {} } }]; } }) };
  return sql;
}`);
  for (const file of FILES) {
    let source = await fs.readFile(path.join(FN, file), 'utf8');
    source = source.replace(/"npm:jose@6\.2\.12"/g, JSON.stringify(JOSE_URL))
      .replace(/"npm:postgres@3\.4\.7"/g, '"./postgres-stub.mjs"')
      .replace(/from "\.\/(token|core-client|db|adapter|config)\.ts"/g, 'from "./$1.mjs"')
      // typescript 4.9 (the repo's harness version) cannot emit import attributes: load the JSON
      // documents through createRequire instead (same bytes, same objects).
      .replace(/import (\w+) from "\.\/([\w.-]+\.json)" with \{ type: "json" \}/g,
        'import { createRequire as __cr } from "node:module"; const $1 = __cr(import.meta.url)("./$2")');
    const out = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, isolatedModules: true, verbatimModuleSyntax: false }, fileName: file }).outputText;
    await fs.writeFile(path.join(outDir, file.replace(/\.ts$/, '.mjs')), out);
  }
  for (const json of ['schemas.json', 'session.schema.json', 'staging-v1-rpc-allowlist.json']) await fs.copyFile(path.join(FN, json), path.join(outDir, json));
  const mod = async (name) => import(pathToFileURL(path.join(outDir, `${name}.mjs`)).href);
  return { token: await mod('token'), coreClient: await mod('core-client'), db: await mod('db'), adapter: await mod('adapter'), config: await mod('config'),
    stub: await mod('postgres-stub'), cleanup: () => fs.rm(outDir, { recursive: true, force: true }) };
}

async function keyRing() {
  const keys = [];
  for (const kid of ['t-k1', 't-k2']) {
    const pair = await jose.generateKeyPair('RS256', { modulusLength: 2048, extractable: true });
    keys.push({ kid, privateKey: await jose.exportPKCS8(pair.privateKey), publicKey: { ...await jose.exportJWK(pair.publicKey), kid, alg: 'RS256', use: 'sig' } });
  }
  return { keys, activeKid: 't-k1', trustedKids: ['t-k1'] };
}
const uuid = () => randomUUID();

test('token.ts ≡ token.mjs: constants, cross-verification both ways, identical rejections', async () => {
  const port = await loadPort();
  try {
    const { token: T } = port;
    assert.deepEqual([T.ISSUER, T.AUDIENCE, T.TTL], [nodeToken.ISSUER, nodeToken.AUDIENCE, nodeToken.TTL]);
    assert.deepEqual([T.ISSUER, T.AUDIENCE, T.TTL], ['urn:arma2:local:identity-bridge', 'arma2-torneos-local', 120]);
    const cfg = await keyRing();
    const identity = { id: uuid(), core_user_id: uuid() };
    const session = uuid();
    const fromNode = await nodeToken.issueToken(cfg, identity, session);
    const fromEdge = await T.issueToken(cfg, identity, session);
    const a = await T.verifyToken(fromNode, cfg), b = await nodeToken.verifyToken(fromEdge, cfg);
    for (const p of [a, b]) {
      assert.deepEqual([p.sub, p.core_user_id, p.session_id, p.role, p.iss, p.aud, p.exp - p.iat, p.nbf === p.iat], [identity.id, identity.core_user_id, session, 'authenticated', T.ISSUER, T.AUDIENCE, 120, true]);
    }
    const headerOf = (t) => JSON.parse(Buffer.from(t.split('.')[0], 'base64url').toString());
    assert.deepEqual(headerOf(fromEdge), headerOf(fromNode));
    // Same rejections: both verifiers refuse the same forged tokens.
    const forge = async (payload, kid = 't-k1', header = {}) => new jose.SignJWT({ role: 'authenticated', core_user_id: identity.core_user_id, session_id: session, ...payload })
      .setProtectedHeader({ alg: 'RS256', typ: 'JWT', kid, ...header }).setIssuer(payload.iss ?? T.ISSUER).setAudience(payload.aud ?? T.AUDIENCE).setSubject(payload.sub ?? identity.id)
      .setIssuedAt(payload.iat ?? Math.floor(Date.now() / 1000)).setNotBefore(payload.nbf ?? payload.iat ?? Math.floor(Date.now() / 1000)).setExpirationTime(payload.exp ?? (payload.iat ?? Math.floor(Date.now() / 1000)) + 120).setJti(payload.jti ?? uuid())
      .sign(await jose.importPKCS8(cfg.keys.find(k => k.kid === kid).privateKey, 'RS256'));
    const now = Math.floor(Date.now() / 1000);
    const bad = {
      'untrusted kid': await forge({}, 't-k2'),
      'wrong issuer': await forge({ iss: 'urn:x' }),
      'wrong audience': await forge({ aud: 'x' }),
      'wrong ttl': await forge({ exp: now + 3600 }),
      'nbf ≠ iat': await forge({ nbf: now - 10, iat: now }),
      'expired': await forge({ iat: now - 400, exp: now - 280 }),
      'future iat': await forge({ iat: now + 60, exp: now + 180 }),
      'service_role': await forge({ role: 'service_role' }),
      'non-uuid sub': await forge({ sub: 'admin' }),
      'non-uuid session': await forge({ session_id: 'x' }),
      'jti not uuid': await forge({ jti: 'x' }),
      'typ not JWT': await forge({}, 't-k1', { typ: 'at+jwt' }),
    };
    for (const [name, tok] of Object.entries(bad)) {
      await assert.rejects(T.verifyToken(tok, cfg), undefined, `edge rejects ${name}`);
      await assert.rejects(nodeToken.verifyToken(tok, cfg), undefined, `node rejects ${name}`);
    }
    // jwks(): trusted keys only.
    const j = T.jwks({ ...cfg, trustedKids: ['t-k1'] });
    assert.deepEqual(j.keys.map(k => k.kid), ['t-k1']);
    assert.ok(j.keys.every(k => !('d' in k) && !('p' in k)), 'no private material in the JWKS');
  } finally { await port.cleanup(); }
});

test('core-client.ts validate() ≡ core-client.mjs validate() on the Phase 2A schemas + session schema', async () => {
  const port = await loadPort();
  try {
    const V = port.coreClient.validate, N = nodeCoreClient.validate;
    const samples = [
      ['verifiedEmailResponse', { verified: true, matches: false, checked_at: 1 }],
      ['verifiedEmailResponse', { verified: true, matches: false }],
      ['verifiedEmailResponse', { verified: 'yes', matches: false, checked_at: 1 }],
      ['verifiedEmailResponse', { verified: true, matches: false, checked_at: -1 }],
      ['playersResponse', { items: [], next_cursor: null }],
      ['playersResponse', { items: [{ core_user_id: uuid(), display_name: 'Ana', avatar_url: null, positions: ['ARQ'] }], next_cursor: null }],
      ['playersResponse', { items: [{ core_user_id: 'x', display_name: 'Ana', avatar_url: null, positions: [] }], next_cursor: null }],
      ['teamsResponse', { items: [{ core_team_id: uuid(), name: 'T', crest_url: null, colors: null }], next_cursor: 'abc' }],
      ['teamSnapshotResponse', { core_team_id: uuid(), name: 'T', crest_url: null, players: [], source_revision: 1, captured_at: 1 }],
      ['teamSnapshotResponse', { core_team_id: uuid(), name: 'T', crest_url: null, players: [], source_revision: 1, captured_at: 1, extra: 1 }],
    ];
    for (const [schema, value] of samples) {
      let e = null, n = null;
      try { V(value, schema); } catch (x) { e = x.message; }
      try { N(value, schema); } catch (x) { n = x.message; }
      assert.equal(e, n, `${schema}: same verdict (${JSON.stringify(value).slice(0, 80)})`);
    }
    // The v1.1 session schema (Edge only): closed object, active must be true.
    assert.doesNotThrow(() => V({ active: true, checked_at: 5 }, 'sessionResponse'));
    for (const bad of [{ active: false, checked_at: 5 }, { active: true }, { active: true, checked_at: 5, x: 1 }, { active: 'true', checked_at: 5 }]) assert.throws(() => V(bad, 'sessionResponse'));
    assert.deepEqual(port.coreClient.ROUTES, { ...nodeCoreClient.ROUTES, session: '/v1/session' });
    // Transport policy: lab internal http or https; never Production; never credentials/query.
    const A = port.coreClient.assertCoreContractUrl;
    assert.equal(A('http://core-api:8000/functions/v1/torneos-core-contract'), 'http://core-api:8000/functions/v1/torneos-core-contract');
    assert.equal(A('https://hhyvmhgpapyuzjgxfnqv.supabase.co/functions/v1/torneos-core-contract/'), 'https://hhyvmhgpapyuzjgxfnqv.supabase.co/functions/v1/torneos-core-contract');
    for (const bad of ['http://evil:8000/x', 'https://rcyuuoaqfwcembdajcss.supabase.co/functions/v1/torneos-core-contract', 'https://u:p@host/x', 'https://host/x?y=1', 'ftp://core-api/x']) assert.throws(() => A(bad), undefined, bad);
    // Same HMAC as the Node client for the same inputs.
    const key = Buffer.from('ab'.repeat(32), 'hex');
    const client = new port.coreClient.CoreClient('http://core-api:8000/functions/v1/torneos-core-contract', new Uint8Array(key));
    const body = new TextEncoder().encode('{"a":1}');
    const sig = await client.sign('/v1/session', '1700000000', '0'.repeat(32), body);
    const { createHmac } = await import('node:crypto');
    assert.equal(sig, createHmac('sha256', key).update('/v1/session\n1700000000\n' + '0'.repeat(32) + '\n').update(body).digest('hex'));
  } finally { await port.cleanup(); }
});

test('core-client.ts freshness: certified 3 s past window kept, bounded +5 s future clock skew, fail closed beyond both (R4.2 20260918T224221Z)', async () => {
  const port = await loadPort();
  try {
    const { CoreClient, Denied, isFreshObservation, MAX_RESPONSE_AGE_SECONDS, MAX_FUTURE_SKEW_SECONDS } = port.coreClient;
    assert.deepEqual([MAX_RESPONSE_AGE_SECONDS, MAX_FUTURE_SKEW_SECONDS], [3, 5]);
    // The future bound never exceeds the clock tolerance already certified for the bridge token (token.ts)
    // nor what the attestation table admits (observed_at ≤ created_at + 5 s): the gateway never accepts a
    // verdict the database would refuse to attest.
    assert.match(await fs.readFile(path.join(FN, 'token.ts'), 'utf8'), /clockTolerance: 5\b/);
    assert.match(await fs.readFile(path.join(ROOT, 'backend/torneos/contracts/core-boundary.sql'), 'utf8'), /observed_at <= created_at \+ interval '5 seconds'/);
    assert.ok(MAX_FUTURE_SKEW_SECONDS <= 5);

    // age = now − observed (observed is Core's truncated integer second; now is this clock, fractional).
    const NOW = 1_800_000_000;
    const cases = [
      [3, true, '−3 s: observed 3 s ago (past limit, inclusive)'],
      [2.999, true, 'just inside the past limit'],
      [3.001, false, 'just beyond the past limit → stale'],
      [4, false, 'too old'],
      [10, false, 'far too old (the certified outage case)'],
      [0, true, 'same instant'],
      [-0.15, true, '+0.15 s: Core 0.15 s ahead (the R4.2 signature)'],
      [-1, true, '+1 s: Core 1 s ahead'],
      [-5, true, '+5 s: Core 5 s ahead (future limit, inclusive)'],
      [-5.001, false, 'just beyond the future limit → unavailable'],
      [-6, false, '+6 s → unavailable'],
      [-10, false, '+10 s → unavailable (the certified outage case)'],
    ];
    for (const [age, expected, label] of cases) assert.equal(isFreshObservation(NOW, NOW + age), expected, `isFreshObservation: ${label}`);
    for (const bad of [NaN, Infinity, -Infinity, '5', null, undefined, {}]) assert.equal(isFreshObservation(bad, NOW), false, `fail closed on observed=${String(bad)}`);
    assert.equal(isFreshObservation(NOW, NaN), false, 'fail closed on a broken local clock');

    // Through call(): the same boundaries end as the verdict (200 body) or 503 CORE_UNAVAILABLE, on every
    // time-bound route (session / verified-email: checked_at; team-snapshot: captured_at). No cache: each call fetches.
    const teamId = uuid();
    const bodies = {
      '/v1/session': () => ({ active: true, checked_at: NOW }),
      '/v1/verified-email': () => ({ verified: true, matches: true, checked_at: NOW }),
      '/v1/team-snapshot': () => ({ core_team_id: teamId, name: 'Team', crest_url: null, players: [], source_revision: 1, captured_at: NOW }),
    };
    const requests = { '/v1/session': { core_user_id: uuid(), session_id: uuid() }, '/v1/verified-email': { core_user_id: uuid(), session_id: uuid(), expected_email: 'a@b.c' }, '/v1/team-snapshot': { core_user_id: uuid(), session_id: uuid(), core_team_id: teamId } };
    let now = NOW, fetches = 0;
    const fetchImpl = async (url) => { fetches += 1; const p = new URL(url).pathname.replace(/^.*torneos-core-contract/, ''); return new Response(JSON.stringify(bodies[p]()), { status: 200, headers: { 'content-type': 'application/json' } }); };
    const client = new CoreClient('https://hhyvmhgpapyuzjgxfnqv.supabase.co/functions/v1/torneos-core-contract', new Uint8Array(32), { clock: () => now, fetchImpl });
    for (const route of Object.keys(bodies)) {
      for (const [age, expected, label] of cases) {
        now = NOW + age;
        if (expected) assert.deepEqual(await client.call(route, requests[route]), bodies[route](), `${route} ${label}`);
        else await assert.rejects(client.call(route, requests[route]), (e) => e instanceof Denied && e.status === 503 && e.code === 'CORE_UNAVAILABLE', `${route} ${label}`);
      }
    }
    assert.equal(fetches, Object.keys(bodies).length * cases.length, 'one Core round trip per call, never a cached verdict');
    // A genuinely unavailable Core is still 503, a Core verdict is still 4xx → CORE_DENIED.
    now = NOW;
    const down = new CoreClient('https://hhyvmhgpapyuzjgxfnqv.supabase.co/functions/v1/torneos-core-contract', new Uint8Array(32), { clock: () => now, fetchImpl: async () => { throw new TypeError('down'); } });
    await assert.rejects(down.call('/v1/session', requests['/v1/session']), (e) => e.status === 503 && e.code === 'CORE_UNAVAILABLE');
    const five = new CoreClient('https://hhyvmhgpapyuzjgxfnqv.supabase.co/functions/v1/torneos-core-contract', new Uint8Array(32), { clock: () => now, fetchImpl: async () => new Response('{"error":"X"}', { status: 502 }) });
    await assert.rejects(five.call('/v1/session', requests['/v1/session']), (e) => e.status === 502 && e.code === 'CORE_UNAVAILABLE', 'upstream 5xx keeps its status; the gateway maps any ≥500 Denied to 503');
    const denied = new CoreClient('https://hhyvmhgpapyuzjgxfnqv.supabase.co/functions/v1/torneos-core-contract', new Uint8Array(32), { clock: () => now, fetchImpl: async () => new Response('{"error":"FORBIDDEN"}', { status: 403 }) });
    await assert.rejects(denied.call('/v1/session', requests['/v1/session']), (e) => e.status === 403 && e.code === 'CORE_DENIED');

    // Root-cause characterization: Core's clock a few tenths of a second AHEAD of the gateway, checked_at
    // truncated to the second, evaluated at 1000 evenly spaced instants. The pre-fix predicate
    // (0 ≤ age ≤ 3) rejected every instant where the truncated Core second was already ahead of the
    // gateway's fractional clock — a rejection rate equal to the skew — with age ∈ (−skew, 0).
    const legacy = (observed, at) => { const age = at - observed; return age >= 0 && age <= 3; };
    for (const skew of [0.05, 0.15, 0.25]) {
      let legacyRejected = 0, rejected = 0, worst = 0;
      for (let i = 0; i < 1000; i += 1) {
        const gateway = NOW + i / 1000, checkedAt = Math.floor(gateway + skew);
        if (!legacy(checkedAt, gateway)) { legacyRejected += 1; worst = Math.min(worst, gateway - checkedAt); }
        if (!isFreshObservation(checkedAt, gateway)) rejected += 1;
      }
      assert.equal(legacyRejected, Math.round(skew * 1000), `legacy predicate: ${skew * 100}% of instants rejected at +${skew} s skew`);
      assert.ok(worst < 0 && worst > -skew - 1e-6, `legacy rejections have age ∈ (−${skew}, 0) (float64 at epoch scale: ±1e-7), observed ${worst}`);
      assert.equal(rejected, 0, `bounded tolerance: no rejection at +${skew} s skew`);
    }
  } finally { await port.cleanup(); }
});

test('adapter.ts ≡ adapter.mjs: contracts, request mappers, SQL error mapping, role discipline', async () => {
  const port = await loadPort();
  try {
    const E = port.adapter, N = nodeAdapter;
    assert.deepEqual(Object.keys(E.CONTRACTS), Object.keys(N.CONTRACTS));
    const body = { p_token: 'x'.repeat(64), p_organization_id: uuid(), p_tournament_id: uuid(), p_team_entry_id: null, p_query: 'ana', p_category_id: uuid(), p_arma2_team_id: uuid() };
    for (const name of Object.keys(N.CONTRACTS)) {
      assert.equal(E.CONTRACTS[name].contract, N.CONTRACTS[name].contract);
      assert.deepEqual(E.CONTRACTS[name].request(body), N.CONTRACTS[name].request(body), name);
      assert.deepEqual(E.CONTRACTS[name].request({ ...body, p_arma2_team_id: null, p_limit: 3 }), N.CONTRACTS[name].request({ ...body, p_arma2_team_id: null, p_limit: 3 }), name);
    }
    for (const err of [{ message: 'TORNEOS_SEARCH_RATE_LIMITED', code: 'P0001' }, { message: 'TORNEOS_INVALID_CORE_CONTRACT_REQUEST', code: '22023' },
      { message: 'TORNEOS_RESOURCE_FORBIDDEN', code: '42501' }, { message: 'connection refused', code: 'ECONNREFUSED' }, { message: 'syntax error', code: '42601' }]) {
      const e = E.mapSqlError(err);
      assert.deepEqual([e.status, e.code], (() => { const m = err.message; if (/^TORNEOS_[A-Z_]+$/.test(m)) { if (m === 'TORNEOS_SEARCH_RATE_LIMITED') return [429, m]; if (err.code === '22023') return [400, m]; return [403, m]; } return [503, 'TORNEOS_UNAVAILABLE']; })());
    }
    // Role discipline: every adapter statement runs after SET LOCAL ROLE torneos_core_adapter inside a transaction.
    const sql = port.db.connect('postgres://lab_core_adapter:pw@torneos-db:5432/postgres');
    const client = new port.coreClient.CoreClient('http://core-api:8000/functions/v1/torneos-core-contract', new Uint8Array(32));
    const adapter = new E.Adapter(sql, client);
    const claims = { sub: uuid(), core_user_id: uuid(), session_id: uuid(), jti: uuid(), role: 'authenticated', iat: 1, exp: 121, nbf: 1, iss: 'urn:arma2:local:identity-bridge', aud: 'arma2-torneos-local' };
    port.stub.calls.length = 0;
    await adapter.authorize(claims, 'directory_players', { organization_id: uuid(), tournament_id: uuid(), team_entry_id: null, query: 'ana', limit: 8 });
    const qs = port.stub.calls.map(c => c.q);
    assert.equal(qs[0], 'SET LOCAL ROLE torneos_core_adapter');
    assert.match(qs[1], /SET LOCAL statement_timeout = 2000/);
    assert.match(qs[2], /set_config\('request\.jwt\.claims', \$1::text, true\)/);
    assert.match(qs[3], /private\.authorize_core_contract\(\$1, \$2::jsonb\)/);
    assert.equal(typeof port.stub.calls[3].params[1], 'object', 'JSON parameters are objects (single serialization by the driver)');
    assert.ok(!qs.some(q => /SET (LOCAL )?ROLE (authenticated|postgres|service_role)/i.test(q)));
    const src = await fs.readFile(path.join(FN, 'db.ts'), 'utf8');
    assert.match(src, /"torneos_identity_writer" \| "torneos_core_adapter"/, 'only the two baseline roles can be assumed');
  } finally { await port.cleanup(); }
});

test('config.ts fails closed: every missing/malformed value disables the gateway; Production refused; routePath', async () => {
  const port = await loadPort();
  try {
    const { loadConfig, routePath, ConfigError } = port.config;
    const ring = await keyRing();
    const good = {
      TORNEOS_GATEWAY_PUBLIC_URL: 'https://abcdefghijklmnopqrst.supabase.co/functions/v1/torneos-gateway',
      TORNEOS_ALLOWED_ORIGIN: 'https://torneos-staging.example',
      CORE_AUTH_URL: 'https://hhyvmhgpapyuzjgxfnqv.supabase.co/auth/v1',
      CORE_JWT_ISSUER: 'https://hhyvmhgpapyuzjgxfnqv.supabase.co/auth/v1',
      CORE_ANON_KEY: 'eyJpublic',
      CORE_CONTRACT_URL: 'https://hhyvmhgpapyuzjgxfnqv.supabase.co/functions/v1/torneos-core-contract',
      TORNEOS_CONTRACT_SERVICE_SECRET: 'ab'.repeat(32),
      TORNEOS_REST_URL: 'https://abcdefghijklmnopqrst.supabase.co/rest/v1',
      TORNEOS_ANON_KEY: 'eyJpublic2',
      TORNEOS_DB_IDENTITY_WRITER_URL: 'postgres://torneos_edge_identity_writer.abcdefghijklmnopqrst:pw@aws-0-us-east-1.pooler.supabase.com:6543/postgres',
      TORNEOS_DB_CORE_ADAPTER_URL: 'postgres://torneos_edge_core_adapter.abcdefghijklmnopqrst:pw@aws-0-us-east-1.pooler.supabase.com:6543/postgres',
      TORNEOS_BRIDGE_KEYS: JSON.stringify(ring),
    };
    const cfg = loadConfig(good);
    assert.equal(cfg.allowedOrigin, 'https://torneos-staging.example');
    assert.equal(cfg.publicUrl.host, 'abcdefghijklmnopqrst.supabase.co');
    assert.equal(cfg.bridge.activeKid, 't-k1');
    // base64 form of the key ring (env files) is accepted and identical.
    assert.deepEqual(loadConfig({ ...good, TORNEOS_BRIDGE_KEYS: Buffer.from(JSON.stringify(ring)).toString('base64') }).bridge, cfg.bridge);
    for (const name of Object.keys(good).filter(k => !['CORE_ANON_KEY', 'TORNEOS_ANON_KEY'].includes(k))) {
      const env = { ...good }; delete env[name];
      assert.throws(() => loadConfig(env), ConfigError, `missing ${name} disables the gateway`);
    }
    const PROD = 'rcyuuoaqfwcembdajcss';
    const bad = {
      'Production Core auth': { CORE_AUTH_URL: `https://${PROD}.supabase.co/auth/v1` },
      'Production contract': { CORE_CONTRACT_URL: `https://${PROD}.supabase.co/functions/v1/torneos-core-contract` },
      'Production Torneos rest': { TORNEOS_REST_URL: `https://${PROD}.supabase.co/rest/v1` },
      'Production DB': { TORNEOS_DB_CORE_ADAPTER_URL: `postgres://x.${PROD}:pw@aws-0-us-east-1.pooler.supabase.com:6543/postgres` },
      'Production public url': { TORNEOS_GATEWAY_PUBLIC_URL: `https://${PROD}.supabase.co/functions/v1/torneos-gateway` },
      'plain http remote': { CORE_AUTH_URL: 'http://hhyvmhgpapyuzjgxfnqv.supabase.co/auth/v1' },
      'origin with path': { TORNEOS_ALLOWED_ORIGIN: 'https://torneos-staging.example/app' },
      'short secret': { TORNEOS_CONTRACT_SERVICE_SECRET: 'ab'.repeat(16) },
      'non-hex secret': { TORNEOS_CONTRACT_SERVICE_SECRET: 'zz'.repeat(32) },
      'rest = Core project': { TORNEOS_REST_URL: 'https://hhyvmhgpapyuzjgxfnqv.supabase.co/rest/v1' },
      'db url not postgres': { TORNEOS_DB_IDENTITY_WRITER_URL: 'https://x' },
      'db url without login': { TORNEOS_DB_IDENTITY_WRITER_URL: 'postgres://host:5432/postgres' },
      'keys: active not trusted': { TORNEOS_BRIDGE_KEYS: JSON.stringify({ ...ring, trustedKids: ['t-k2'] }) },
      'keys: active without private key': { TORNEOS_BRIDGE_KEYS: JSON.stringify({ ...ring, keys: ring.keys.map(k => k.kid === 't-k1' ? { kid: k.kid, publicKey: k.publicKey } : k) }) },
      'keys: not json': { TORNEOS_BRIDGE_KEYS: 'nope' },
      'keys: unknown trusted kid': { TORNEOS_BRIDGE_KEYS: JSON.stringify({ ...ring, trustedKids: ['t-k1', 'ghost'] }) },
      'credentials in url': { CORE_AUTH_URL: 'https://u:p@hhyvmhgpapyuzjgxfnqv.supabase.co/auth/v1' },
    };
    for (const [name, patch] of Object.entries(bad)) assert.throws(() => loadConfig({ ...good, ...patch }), ConfigError, name);
    assert.equal(routePath('/torneos-gateway/exchange'), '/exchange');
    assert.equal(routePath('/functions/v1/torneos-gateway/torneos/rest/v1/rpc/x'), '/torneos/rest/v1/rpc/x');
    assert.equal(routePath('/torneos-gateway'), '/');
    assert.equal(routePath('/other/exchange'), null);
    assert.equal(routePath('/torneos-gatewayx/exchange'), null);
  } finally { await port.cleanup(); }
});

test('bundled documents are byte-identical to their canonical sources; function tree carries no secret material', async () => {
  const sha = async (p) => createHash('sha256').update(await fs.readFile(p)).digest('hex');
  assert.equal(await sha(path.join(FN, 'staging-v1-rpc-allowlist.json')), await sha(path.join(ROOT, 'backend/torneos/phase2d/staging-v1-rpc-allowlist.json')));
  assert.equal(await sha(path.join(FN, 'schemas.json')), await sha(path.join(ROOT, 'backend/torneos/phase2a/schemas.json')));
  assert.equal(await sha(path.join(FN, 'session.schema.json')), await sha(path.join(ROOT, 'backend/torneos/phase3b/contracts/session.schema.json')));
  const allow = JSON.parse(await fs.readFile(path.join(FN, 'staging-v1-rpc-allowlist.json'), 'utf8'));
  assert.equal(Object.values(allow.features).flat().length, 43);
  const gate = JSON.parse(await fs.readFile(path.join(ROOT, 'backend/torneos/phase2d/staging-v1-rpc-gate.json'), 'utf8'));
  const off = new Set(gate.functions.map(f => f.name));
  assert.equal(off.size, 33);
  for (const name of Object.values(allow.features).flat()) assert.ok(!off.has(name), `${name} is allowlisted and not gated`);
  for (const file of await fs.readdir(FN)) {
    const text = await fs.readFile(path.join(FN, file), 'utf8');
    // A PEM *header* may be named (it is what config.ts validates); an actual key body may not.
    assert.doesNotMatch(text, /-----BEGIN (RSA |EC )?PRIVATE KEY-----\s*\n[A-Za-z0-9+\/=]{40,}|sbp_[A-Za-z0-9]{20,}|eyJ[A-Za-z0-9_-]{30,}\.[A-Za-z0-9_-]{30,}\.|postgres:\/\/[^:\s"]+:[^@\s"]+@/, `${file} carries no secret material`);
    assert.doesNotMatch(text, /rcyuuoaqfwcembdajcss(?!")/, `${file} never targets Production`);
  }
  const index = await fs.readFile(path.join(FN, 'index.ts'), 'utf8');
  assert.doesNotMatch(index, /SUPABASE_SERVICE_ROLE_KEY|service_role/i, 'the gateway never uses a service role');
  assert.doesNotMatch(index, /console\.(log|info|debug)\(/, 'no request logging');
  assert.match(index, /Core is reached ONLY over HTTPS|Core only over HTTPS/);
  const dbSrc = await fs.readFile(path.join(FN, 'db.ts'), 'utf8');
  assert.doesNotMatch(dbSrc, /auth\.sessions|auth\.users|core-db|poc_session_reader/, 'no Core database access');
});
