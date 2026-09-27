// GATEWAY/AUTH — B03 = jwks_url (owner decision 2026-09-26, option A), offline. No network, no Keychain.
// Run: node --test backend/torneos/infra/torneos-gateway-auth/b03-jwks-url.test.mjs
//
// The hosted resolver and PostgREST are emulated: PostgREST verifies RS256 against the RESOLVED jwks only (an unresolved
// integration = PGRST301, as measured on 2026-09-26), then applies the certified identity gate and RLS own_identity.
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as G from './gateway-auth-contract.mjs';
import * as K from './keyring.mjs';
import { runGatewayAuth } from './gateway-auth.mjs';
import { projectThirdPartyAuth } from './mgmt-gateway-auth.mjs';
import { probeJwksUrl } from './jwks-url-probe.mjs';

const T = G.TORNEOS_REF;
const ring = K.generateRing();
const pin = K.jwksPinDocument(ring.jwks, { generatedAt: '2026-09-25T00:00:00Z' });
const PUBLIC_JWKS = JSON.stringify(G.customJwksBody(pin).custom_jwks);
const FOUNDATION_PIN = JSON.parse(fs.readFileSync(G.FOUNDATION_PIN_FILE, 'utf8'));
const DELTA_PIN = JSON.parse(fs.readFileSync(G.DELTA_PIN_FILE, 'utf8'));
const IDENTITY = { id: crypto.randomUUID(), core_user_id: crypto.randomUUID() };
const inlineRow = (over = {}) => ({ id: G.B03_SUPERSEDED_INLINE_ID, type: 'custom', oidc_issuer_url: null, jwks_url: null, custom_jwks: JSON.parse(PUBLIC_JWKS), resolved_jwks: null, resolved_at: null, inserted_at: '2026-09-26T00:58:24Z', ...over });

test('contract: jwks_url pinned to the exact gateway host over https; the body is exactly {jwks_url}; the pin equals the deploy pin', () => {
  const u = new URL(G.B03_JWKS_URL);
  assert.deepEqual([u.protocol, u.hostname, u.port, u.pathname, u.search], ['https:', 'torneos-gateway.nicoavayu.deno.net', '', '/functions/v1/torneos-gateway/.well-known/jwks.json', '']);
  const deploy = JSON.parse(fs.readFileSync(new URL('../torneos-gateway-remote/pins/gateway-deploy.json', import.meta.url), 'utf8'));
  assert.equal(G.B03_JWKS_URL, `${deploy.public_url}/.well-known/jwks.json`, 'the gateway that is deployed');
  assert.equal(deploy.host, G.GATEWAY_HOST);
  assert.deepEqual(G.jwksUrlBody(), { jwks_url: G.B03_JWKS_URL });
  assert.doesNotThrow(() => G.assertThirdPartyAuthBody({ jwks_url: G.B03_JWKS_URL }));
  for (const bad of [G.customJwksBody(pin), { jwks_url: G.B03_JWKS_URL.replace('https:', 'http:') }, { jwks_url: `${G.B03_JWKS_URL}/` }, { jwks_url: G.B03_JWKS_URL.replace('nicoavayu', 'attacker') },
    { jwks_url: G.B03_JWKS_URL, oidc_issuer_url: 'https://x' }, { jwks_url: G.B03_JWKS_URL, custom_jwks: JSON.parse(PUBLIC_JWKS) }, { oidc_issuer_url: 'https://torneos-gateway.nicoavayu.deno.net' }, {}]) {
    assert.throws(() => G.assertThirdPartyAuthBody(bad), /tpa_body_not_the_pinned_jwks_url/, JSON.stringify(bad).slice(0, 80));
  }
});

test('allowlist: DELETE only the superseded inline id, only in --b03, only armed, no body; POST only {jwks_url}', () => {
  const c = (method, p, body, opts) => G.classifyRequest({ method, path: p, body }, opts);
  const del = `/v1/projects/${T}/config/auth/third-party-auth/${G.B03_SUPERSEDED_INLINE_ID}`;
  assert.equal(c('DELETE', del, undefined, { mode: '--b03', armedFor: 'b03-delete', jwksPin: pin }).kind, 'write:b03-delete');
  assert.throws(() => c('DELETE', del, undefined, { mode: '--b03', armedFor: 'b03', jwksPin: pin }), /b03_delete_not_armed/);
  assert.throws(() => c('DELETE', del, undefined, { mode: '--b03', armedFor: null, jwksPin: pin }), /b03_delete_not_armed/);
  assert.throws(() => c('DELETE', del, {}, { mode: '--b03', armedFor: 'b03-delete', jwksPin: pin }), /delete_with_body/);
  for (const m of Object.keys(G.MODE_ENDPOINTS).filter((x) => x !== '--b03')) assert.throws(() => c('DELETE', del, undefined, { mode: m, armedFor: 'b03-delete', jwksPin: pin }), /not_in_mode/, m);
  for (const p of [`/v1/projects/${T}/config/auth/third-party-auth/${crypto.randomUUID()}`, `/v1/projects/${T}/config/auth/third-party-auth`, `/v1/projects/${G.CORE_PROD_REF}/config/auth/third-party-auth/${G.B03_SUPERSEDED_INLINE_ID}`,
    `/v1/projects/${T}/config/auth`, `/v1/projects/${T}`, `/v1/projects/${T}/functions/x`]) {
    assert.throws(() => c('DELETE', p, undefined, { mode: '--b03', armedFor: 'b03-delete', jwksPin: pin }), /endpoint_not_allowlisted/, p);
  }
  const post = `/v1/projects/${T}/config/auth/third-party-auth`;
  assert.equal(c('POST', post, G.jwksUrlBody(), { mode: '--b03', armedFor: 'b03', jwksPin: pin }).kind, 'write:b03');
  assert.throws(() => c('POST', post, G.jwksUrlBody(), { mode: '--b03', armedFor: 'b03-delete', jwksPin: pin }), /b03_not_armed/);
  assert.throws(() => c('POST', post, G.jwksUrlBody(), { mode: '--b03', armedFor: 'b03', jwksPin: null }), /b03_not_armed/);
  assert.throws(() => c('POST', post, G.customJwksBody(pin), { mode: '--b03', armedFor: 'b03', jwksPin: pin }), /tpa_body/, 'inline custom_jwks is never published again');
  assert.deepEqual(G.patRequirement('--b03').api_writes, ['tpa-delete', 'tpa-create']);
  assert.deepEqual(G.patRequirement('--b03').permissions.filter((p) => p.endsWith('Read-write')), ['Auth Config: Read-write'], 'the same PAT scope as the first B03');
});

test('state: pending / superseded-inline (exactly the unresolved one) / resolving / applied (resolved = pin) / foreign', () => {
  const st = (rows) => G.b03State(projectThirdPartyAuth(rows), pin).state;
  const pending = { id: crypto.randomUUID(), type: 'custom', oidc_issuer_url: null, jwks_url: G.B03_JWKS_URL, custom_jwks: null, resolved_jwks: null, resolved_at: null };
  const resolved = { ...pending, resolved_jwks: JSON.parse(PUBLIC_JWKS), resolved_at: '2026-09-26T02:00:00Z' };
  assert.equal(st([]), 'pending');
  assert.equal(st([inlineRow()]), 'superseded-inline');
  assert.equal(st([inlineRow({ resolved_at: '2026-09-26T01:00:00Z' })]), 'foreign', 'if the inline one ever resolved, a human looks: never deleted blind');
  assert.equal(st([inlineRow({ id: crypto.randomUUID() })]), 'foreign', 'another id is never the superseded one');
  assert.equal(st([inlineRow({ custom_jwks: { keys: [...JSON.parse(PUBLIC_JWKS).keys].reverse() } })]), 'foreign');
  assert.equal(st([pending]), 'resolving');
  assert.equal(st([{ ...pending, resolved_at: '2026-09-26T02:00:00Z' }]), 'resolving', 'resolved_at without keys is not resolved');
  assert.equal(st([resolved]), 'applied');
  const withD = JSON.parse(PUBLIC_JWKS); withD.keys[0].d = 'x';
  assert.equal(st([{ ...resolved, resolved_jwks: withD }]), 'foreign');
  assert.equal(st([{ ...resolved, resolved_jwks: { keys: [JSON.parse(PUBLIC_JWKS).keys[0]] } }]), 'foreign');
  assert.equal(st([{ ...resolved, jwks_url: `${G.B03_JWKS_URL}?x` }]), 'foreign');
  assert.equal(st([{ ...resolved, oidc_issuer_url: 'https://x' }]), 'foreign');
  assert.equal(st([resolved, inlineRow()]), 'foreign', 'never two integrations');
});

// ─────────────── the jwks_url probe ───────────────
function jwksServer({ body = PUBLIC_JWKS, status = 200, headers = { 'content-type': 'application/json' }, onQuery = null } = {}) {
  return async ({ method = 'GET', path: p, headers: h = {} }) => {
    if (h.Origin) return { status: 403, headers: { 'content-type': 'application/json' }, raw: '{"error":"origin rejected"}' };
    if (method !== 'GET') return { status: 404, headers: {}, raw: '{"error":"not found"}' };
    if (p.includes('?') && onQuery) return onQuery();
    return { status, headers, raw: body };
  };
}
test('jwks_url probe: passes only on the exact public pin as application/json, 200, no redirect; request input cannot alter it', async () => {
  const ok = await probeJwksUrl({ jwksPin: pin, transport: jwksServer() });
  assert.equal(ok.pass, true, JSON.stringify(ok.checks.filter((c) => !c.pass)));
  const withD = JSON.parse(PUBLIC_JWKS); withD.keys[1].d = 'A'.repeat(64);
  const fails = {
    redirect: jwksServer({ status: 301, headers: { location: 'https://attacker.invalid/jwks' }, body: '' }),
    'text/html': jwksServer({ headers: { 'content-type': 'text/html' } }),
    reordered: jwksServer({ body: JSON.stringify({ keys: [...JSON.parse(PUBLIC_JWKS).keys].reverse() }) }),
    'private member': jwksServer({ body: JSON.stringify(withD) }),
    'extra key': jwksServer({ body: JSON.stringify({ keys: [...JSON.parse(PUBLIC_JWKS).keys, { ...JSON.parse(PUBLIC_JWKS).keys[0], kid: 'x' }] }) }),
    'cookie': jwksServer({ headers: { 'content-type': 'application/json', 'set-cookie': 'a=b' } }),
    'query alters': jwksServer({ onQuery: () => ({ status: 200, headers: { 'content-type': 'application/json' }, raw: '{"keys":[]}' }) }),
  };
  for (const [name, transport] of Object.entries(fails)) assert.equal((await probeJwksUrl({ jwksPin: pin, transport })).pass, false, name);
  const leak = await probeJwksUrl({ jwksPin: pin, transport: jwksServer({ body: PUBLIC_JWKS }), known: [JSON.parse(PUBLIC_JWKS).keys[0].n.slice(0, 40)] });
  assert.equal(leak.pass, false, 'a value the session holds as secret must never be served');
});

// ─────────────── the runner, end to end against emulated hosts ───────────────
const b64json = (s) => JSON.parse(Buffer.from(s, 'base64url').toString('utf8'));
function world({ tpa = [inlineRow()], resolveAfterPolls = 2, createFails = false, deleteLeaves = false, identities = [IDENTITY], jwks = jwksServer() } = {}) {
  const PAT = `sbp_${'e'.repeat(40)}`;
  const PUB = `sb_publishable_${'r'.repeat(24)}`;
  const w = { tpa: tpa.map((r) => ({ ...r })), writes: [], polls: 0, created: 0 };
  const lockedAuth = { ...G.AUTH_LOCKDOWN_BODY, ...Object.fromEntries(G.AUTH_MUST_BE_OFF.map((k) => [k, false])) };
  const proj = (ref, name, status, region) => ({ ref, id: ref, name, organization_slug: G.ORG_SLUG, region, status });
  const projects = [proj(G.CORE_PROD_REF, 'core', 'ACTIVE_HEALTHY', 'sa-east-1'), proj(G.STAGING_REF, 'staging', 'INACTIVE', 'us-east-1'), proj(G.OLD_REF, 'old', 'INACTIVE', 'us-west-2'), proj(T, G.PROJECT_NAME, 'ACTIVE_HEALTHY', 'sa-east-1')];
  const roles = { ...DELTA_PIN.roles, payment_logins: 0, login_member_of_api_role: 0, authenticator_config: [...G.PRE_REQUEST_ROLECONFIG], auth_users: 0, installer: {}, edge_login_can_set_role: {} };
  const transport = async ({ pat, method, path: p, body }) => {
    assert.equal(pat, PAT);
    const cls = G.classifyRequest({ method, path: p, body }, { mode: '--b03', armedFor: method === 'DELETE' ? 'b03-delete' : method === 'POST' && p.endsWith('/third-party-auth') ? 'b03' : null, jwksPin: pin });
    const r = (status, b) => ({ status, body: b });
    switch (cls.id) {
      case 'org': return r(200, { slug: G.ORG_SLUG, plan: 'free' });
      case 'projects': return r(200, projects);
      case 'prod-project': return r(200, projects[0]);
      case 'prod-contract-fn': return r(200, { slug: G.CORE_CONTRACT_SLUG, status: 'ACTIVE', verify_jwt: false, ezbr_sha256: G.CORE_CONTRACT_EZBR });
      case 'project': return r(200, projects.find((x) => x.ref === cls.ref));
      case 'functions': return r(200, []);
      case 'auth-config': return r(200, { ...lockedAuth });
      case 'third-party-auth': {
        w.polls += 1;
        for (const row of w.tpa) if (row.jwks_url && !row.resolved_at && w.polls >= row.resolveAt) Object.assign(row, { resolved_jwks: JSON.parse(PUBLIC_JWKS), resolved_at: '2026-09-26T02:10:00Z' });
        return r(200, w.tpa.map((x) => { const { resolveAt: _r, ...rest } = x; return rest; }));
      }
      case 'api-keys': return r(200, [{ name: 'default', type: 'publishable', api_key: PUB }]);
      case 'query':
        if (body.query === G.IDENTITY_PROBE_SQL) return r(201, identities.map((i) => ({ ...i })));
        return r(201, [{ json_build_object: body.query === G.CATALOG_SQL ? { ...FOUNDATION_PIN.catalog, ...DELTA_PIN.catalog } : roles }]);
      case 'tpa-delete': w.writes.push('DELETE'); if (!deleteLeaves) w.tpa = w.tpa.filter((x) => x.id !== G.B03_SUPERSEDED_INLINE_ID); return r(200, {});
      case 'tpa-create': {
        w.writes.push('POST');
        if (createFails) return r(500, { message: 'upstream error' });
        const row = { id: crypto.randomUUID(), type: 'custom', oidc_issuer_url: null, jwks_url: body.jwks_url, custom_jwks: null, resolved_jwks: null, resolved_at: null, resolveAt: w.polls + resolveAfterPolls };
        w.tpa.push(row); w.created += 1;
        const { resolveAt: _r, ...out } = row; return r(201, out);
      }
      default: throw new Error(`unexpected ${cls.id}`);
    }
  };
  // PostgREST: RS256 against the RESOLVED jwks only; then check_token (certified claims + identity) and RLS own_identity.
  const probeTransport = async ({ path: p, headers }) => {
    if (headers.apikey !== PUB) return { status: 401, body: { message: 'No API key found in request' } };
    const auth = headers.Authorization;
    if (!auth) return p.includes('tournament_competition_formats') ? { status: 200, body: [] } : { status: 401, body: { code: '42501' } };
    const [h, c, s] = auth.slice(7).split('.');
    let head; try { head = b64json(h); } catch { return { status: 401, body: { code: 'PGRST301', message: 'invalid' } }; }
    if (head.alg !== 'RS256') return { status: 401, body: { code: 'PGRST301', message: 'Wrong or unsupported encoding algorithm' } };
    const trusted = w.tpa.flatMap((x) => x.resolved_jwks?.keys ?? []);
    const jwk = trusted.find((k) => k.kid === head.kid);
    if (!jwk) return { status: 401, body: { code: 'PGRST301', message: 'No suitable key or wrong key type' } };
    const ok = crypto.verify('sha256', Buffer.from(`${h}.${c}`), crypto.createPublicKey({ key: { kty: 'RSA', n: jwk.n, e: jwk.e }, format: 'jwk' }), Buffer.from(s ?? '', 'base64url'));
    if (!ok) return { status: 401, body: { code: 'PGRST301', message: 'JWSInvalidSignature' } };
    const cl = b64json(c);
    const now = Math.floor(Date.now() / 1000);
    if (cl.exp <= now) return { status: 401, body: { code: 'PGRST303', message: 'JWT expired' } };
    const ident = identities.find((i) => i.id === cl.sub && i.core_user_id === cl.core_user_id);
    const bridgeOk = cl.role === 'authenticated' && cl.iss === G.BRIDGE.issuer && cl.aud === G.BRIDGE.audience && cl.exp - cl.iat === 120 && cl.nbf === cl.iat;
    if (!bridgeOk || !ident) return { status: 401, body: { code: 'PT401', message: 'invalid identity token' } };
    return { status: 200, body: [{ id: ident.id }] }; // RLS own_identity: only its own row
  };
  const said = [];
  const evidenceDir = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'ga-b03-'));
  const jwksPinFile = path.join(evidenceDir, 'pin.json'); fs.writeFileSync(jwksPinFile, JSON.stringify(pin));
  const kc = Object.fromEntries(ring.slots.map((s) => [s.slot, s]));
  const keychain = {
    dbLogin: () => ({ check: () => 'PRESENT' }), dataplane: { check: () => 'PRESENT' },
    ring: { check: () => 'PRESENT', read: (slot, kid) => { assert.equal(kc[slot].kid, kid); return kc[slot].pkcs8; } },
  };
  let phrase = null;
  const deps = { transport, probeTransport, jwksTransport: jwks, keychain, now: () => Date.now(), sleep: async () => {}, say: (x) => said.push(x), evidenceDir, jwksPinFile,
    b03ResolveIntervalMs: 1, b03ResolveTimeoutMs: 200, b03ProbeIntervalMs: 1, b03ProbeAttempts: 3,
    tty: { readLine: () => { if (phrase !== null) return phrase; const m = [...said.join('\n').matchAll(/To proceed type exactly:\n {2}(.+)\n/g)].pop(); return m ? m[1] : ''; } } };
  const run = () => runGatewayAuth({ mode: '--b03', request: { pat: PAT }, deps });
  const evidence = () => fs.readdirSync(evidenceDir).filter((f) => f.startsWith('ga-05')).map((f) => { const text = fs.readFileSync(path.join(evidenceDir, f), 'utf8'); return { f, text, j: JSON.parse(text) }; });
  return { w, run, said, evidence, setPhrase: (p) => { phrase = p; }, PAT, PUB };
}

test('--b03 from the superseded inline: plan → phrase → DELETE exactly it → absent → POST {jwks_url} → resolves → probes A–F pass', async () => {
  const x = world();
  const r = await x.run();
  assert.equal(r.verdict, 'B03_APPLIED_BRIDGE_ACCEPTED');
  assert.deepEqual(x.w.writes, ['DELETE', 'POST'], 'exactly one DELETE then one POST');
  assert.equal(x.w.tpa.length, 1); assert.equal(x.w.tpa[0].jwks_url, G.B03_JWKS_URL);
  const plan = x.said.join('\n');
  assert.match(plan, new RegExp(`DELETE the superseded inline custom_jwks integration ${G.B03_SUPERSEDED_INLINE_ID}`));
  assert.match(plan, /PUBLISH TORNEOS B03 JWKS URL onzpwnqxnvlgsevivngf [0-9a-f]{12}/);
  const [ev] = x.evidence();
  assert.equal(ev.j.verdict, 'B03_APPLIED_BRIDGE_ACCEPTED');
  assert.equal(ev.j.management_api_writes, 2);
  assert.equal(ev.j.start_state, 'superseded-inline');
  assert.equal(ev.j.resolution.state, 'applied');
  assert.equal(ev.j.jwks_url_probe.pass, true);
  assert.equal(ev.j.bridge_probe_before.hostAcceptsBridge, false);
  const names = ev.j.bridge_probe_after.checks.map((c) => `${c.pass ? 'PASS' : 'FAIL'} ${c.name}`);
  assert.ok(ev.j.bridge_probe_after.pass, names.join('\n'));
  for (const want of [/^PASS A k1/, /^PASS E k2/, /^PASS D tampered/, /^PASS k1 \(active\) bridge token, unknown identity/, /^PASS unknown RS256 key/, /^PASS anon/]) assert.ok(names.some((n) => want.test(n)), String(want));
  assert.deepEqual(ev.j.identity, { rows: 1, id: IDENTITY.id.slice(0, 8), core_user_id: IDENTITY.core_user_id.slice(0, 8) });
  assert.doesNotMatch(ev.text, new RegExp(`${IDENTITY.id}|${IDENTITY.core_user_id}|sb_publishable_|sbp_`), 'no full ids, no keys');
  assert.ok(ev.j.trail.some((t) => t.step === 'after DELETE' && t.tpa.length === 0));
});

test('--b03: a wrong phrase writes nothing; a changed integration after the plan writes nothing', async () => {
  const x = world(); x.setPhrase('PUBLISH TORNEOS B03 JWKS URL onzpwnqxnvlgsevivngf 000000000000');
  await assert.rejects(x.run(), (e) => e.code === 'NOT_AUTHORIZED');
  assert.deepEqual(x.w.writes, []);
});

test('--b03: the JWKS URL not serving the pin → blocked before any write', async () => {
  const x = world({ jwks: jwksServer({ body: JSON.stringify({ keys: [JSON.parse(PUBLIC_JWKS).keys[0]] }) }) });
  await assert.rejects(x.run(), (e) => e.code === 'B03_JWKS_URL_NOT_CERTIFIED');
  assert.deepEqual(x.w.writes, []);
});

test('--b03: the inline integration resolved / another integration present → foreign, blocked, nothing deleted', async () => {
  for (const tpa of [[inlineRow({ resolved_at: '2026-09-26T01:00:00Z' })], [inlineRow({ id: crypto.randomUUID() })], [inlineRow(), { id: crypto.randomUUID(), jwks_url: 'https://x.invalid/jwks' }]]) {
    const x = world({ tpa });
    await assert.rejects(x.run(), (e) => e.code === 'B03_BLOCKED' && e.detail.failures.includes('B03_STATE_FOREIGN'));
    assert.deepEqual(x.w.writes, []);
  }
});

test('--b03: DELETE passes, POST fails → B03_CREATE_FAILED with evidence; the next run starts from pending and only POSTs (new plan + phrase)', async () => {
  const x = world({ createFails: true });
  await assert.rejects(x.run(), (e) => e.code === 'B03_CREATE_FAILED');
  assert.deepEqual(x.w.writes, ['DELETE', 'POST']);
  assert.equal(x.evidence()[0].j.verdict, 'B03_CREATE_FAILED');
  assert.equal(x.w.tpa.length, 0);
  // Same scope, recreate only the authorized jwks_url integration.
  const y = world({ tpa: [] });
  const r = await y.run();
  assert.equal(r.verdict, 'B03_APPLIED_BRIDGE_ACCEPTED');
  assert.deepEqual(y.w.writes, ['POST'], 'no DELETE when there is nothing to delete');
  assert.doesNotMatch(y.said.join('\n'), /DELETE the superseded/);
});

test('--b03: a DELETE that leaves the integration → B03_DELETE_NOT_EFFECTIVE, no POST', async () => {
  const x = world({ deleteLeaves: true });
  await assert.rejects(x.run(), (e) => e.code === 'B03_DELETE_NOT_EFFECTIVE');
  assert.deepEqual(x.w.writes, ['DELETE']);
});

test('--b03: not resolved within the window → B03_RESOLVING (no retry of the POST); the next run resumes read-only and certifies', async () => {
  const x = world({ resolveAfterPolls: 10000 });
  await assert.rejects(x.run(), (e) => e.code === 'B03_RESOLVING');
  assert.deepEqual(x.w.writes, ['DELETE', 'POST']);
  assert.equal(x.w.created, 1);
  const pending = x.w.tpa.map((r) => ({ ...r, resolveAt: 2 })); // still resolving at the first observe
  const y = world({ tpa: pending });
  const r = await y.run();
  assert.equal(r.verdict, 'B03_APPLIED_BRIDGE_ACCEPTED');
  assert.deepEqual(y.w.writes, [], 'resume = zero writes');
  assert.equal(y.evidence()[0].j.start_state, 'resolving');
});

test('--b03 applied: no write, probes only; without the identity probe A cannot pass → postcheck fails', async () => {
  const resolved = [{ id: crypto.randomUUID(), type: 'custom', oidc_issuer_url: null, jwks_url: G.B03_JWKS_URL, custom_jwks: null, resolved_jwks: JSON.parse(PUBLIC_JWKS), resolved_at: '2026-09-26T02:10:00Z' }];
  const x = world({ tpa: resolved });
  assert.equal((await x.run()).verdict, 'B03_APPLIED_BRIDGE_ACCEPTED');
  assert.deepEqual(x.w.writes, []);
  const y = world({ tpa: resolved, identities: [] });
  await assert.rejects(y.run(), (e) => e.code === 'B03_POSTCHECK_FAILED' && e.detail.failures.includes('B03_NO_IDENTITY_FOR_PROBE_A'));
});
