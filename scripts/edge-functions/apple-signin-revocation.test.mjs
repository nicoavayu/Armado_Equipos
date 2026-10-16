// Unit tests for supabase/functions/_shared/appleSignInRevocation.ts (account deletion: Sign in with Apple revocation).
// Transpiles the real TypeScript and drives it against a FAKE Apple (no request leaves the process). The signing key is a
// throwaway P-256 key generated in memory for this run; it never touches the disk. The fake verifies the client_secret
// JWT with the matching public key, as Apple would.
import assert from 'node:assert/strict';
import { randomBytes, randomUUID, webcrypto } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';

const modulePath = path.join(process.cwd(), 'supabase', 'functions', '_shared', 'appleSignInRevocation.ts');
let outDir; let m; let keys; let pem;
const TEAM = 'TEAM123456';
const KEY_ID = 'KEY9876543';
const CLIENT = 'com.teambalancer.app';
const APPLE_SUB = `000123.${randomBytes(16).toString('hex')}.0456`;
const CODE = `c${randomBytes(20).toString('hex')}.0.mrxz.${randomBytes(8).toString('hex')}`;

const b64url = (buf) => Buffer.from(buf).toString('base64url');
const unsignedJwt = (claims) => `${b64url(JSON.stringify({ alg: 'RS256', kid: 'apple' }))}.${b64url(JSON.stringify(claims))}.${b64url('sig')}`;

test.before(async () => {
  outDir = await fs.mkdtemp(path.join(os.tmpdir(), 'arma2-apple-revocation-'));
  const js = ts.transpileModule(await fs.readFile(modulePath, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, isolatedModules: true }, fileName: 'm.ts' }).outputText;
  await fs.writeFile(path.join(outDir, 'm.mjs'), js);
  m = await import(pathToFileURL(path.join(outDir, 'm.mjs')).href);
  keys = await webcrypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const der = Buffer.from(await webcrypto.subtle.exportKey('pkcs8', keys.privateKey)).toString('base64');
  pem = `-----BEGIN PRIVATE KEY-----\n${der.match(/.{1,64}/g).join('\n')}\n-----END PRIVATE KEY-----`;
});
test.after(async () => { await fs.rm(outDir, { recursive: true, force: true }); });

const envOf = (overrides = {}) => {
  const values = { APPLE_SIWA_TEAM_ID: TEAM, APPLE_SIWA_CLIENT_ID: CLIENT, APPLE_SIWA_KEY_ID: KEY_ID, APPLE_SIWA_PRIVATE_KEY: pem, ...overrides };
  return { get: (name) => values[name] };
};
// The shape GoTrue returns in user.identities: `id` = the provider subject, `identity_id` = the row uuid.
const appleUser = (sub = APPLE_SUB) => ({ id: randomUUID(), identities: [{ provider: 'email', id: randomUUID(), identity_id: randomUUID() }, { provider: 'apple', id: sub, identity_id: randomUUID(), identity_data: { sub, provider_id: sub, iss: 'https://appleid.apple.com' } }] });

/** Apple, faked: checks what Apple checks (client_secret signature and claims, form fields) and records every call. */
function fakeApple({ tokenStatus = 200, revokeStatus = 200, idTokenClaims, tokenBody, throwOn } = {}) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    const u = String(url);
    const form = Object.fromEntries(new URLSearchParams(init.body));
    const [h, p, s] = form.client_secret.split('.');
    const header = JSON.parse(Buffer.from(h, 'base64url'));
    const claims = JSON.parse(Buffer.from(p, 'base64url'));
    const signatureValid = await webcrypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, keys.publicKey, Buffer.from(s, 'base64url'), Buffer.from(`${h}.${p}`));
    calls.push({ url: u, form, header, claims, signatureValid, init });
    if (throwOn === u) throw new TypeError('fetch failed');
    if (u === m.APPLE_TOKEN_URL) {
      const body = tokenBody ?? { access_token: 'at', token_type: 'Bearer', expires_in: 3600, refresh_token: 'rt-secret',
        id_token: unsignedJwt(idTokenClaims ?? { iss: 'https://appleid.apple.com', aud: CLIENT, sub: APPLE_SUB, exp: 9999999999 }) };
      return new Response(JSON.stringify(tokenStatus === 200 ? body : { error: 'invalid_grant' }), { status: tokenStatus });
    }
    if (u === m.APPLE_REVOKE_URL) return new Response('', { status: revokeStatus });
    throw new Error(`unexpected destination ${u}`);
  };
  return { calls, fetchImpl };
}

test('revoked: exchanges the code at /auth/token (no redirect_uri) and revokes the refresh token at /auth/revoke', async () => {
  const apple = fakeApple();
  const now = 1_800_000_000;
  const outcome = await m.revokeAppleSignIn({ env: envOf(), user: appleUser(), authorizationCode: CODE, fetchImpl: apple.fetchImpl, clock: () => now });
  assert.equal(outcome, 'revoked');
  assert.deepEqual(apple.calls.map((c) => c.url), ['https://appleid.apple.com/auth/token', 'https://appleid.apple.com/auth/revoke']);
  const [token, revoke] = apple.calls;
  assert.deepEqual(Object.keys(token.form).sort(), ['client_id', 'client_secret', 'code', 'grant_type']);
  assert.deepEqual([token.form.client_id, token.form.code, token.form.grant_type], [CLIENT, CODE, 'authorization_code']);
  assert.deepEqual(Object.keys(revoke.form).sort(), ['client_id', 'client_secret', 'token', 'token_type_hint']);
  assert.deepEqual([revoke.form.client_id, revoke.form.token, revoke.form.token_type_hint], [CLIENT, 'rt-secret', 'refresh_token']);
  for (const call of apple.calls) {
    assert.equal(call.init.method, 'POST');
    assert.equal(call.init.redirect, 'error');
    assert.equal(call.init.headers['content-type'], 'application/x-www-form-urlencoded');
    assert.ok(call.init.signal, 'every call has a timeout');
  }
});

test('client_secret: ES256 JWT, kid = Key ID; iss = Team ID, sub = client id, aud = appleid.apple.com, exp - iat = 300; signature verifies with the public key', async () => {
  const apple = fakeApple();
  const now = 1_800_000_123.7;
  await m.revokeAppleSignIn({ env: envOf(), user: appleUser(), authorizationCode: CODE, fetchImpl: apple.fetchImpl, clock: () => now });
  for (const call of apple.calls) {
    assert.deepEqual(call.header, { alg: 'ES256', kid: KEY_ID, typ: 'JWT' });
    assert.deepEqual(call.claims, { iss: TEAM, iat: 1_800_000_123, exp: 1_800_000_423, aud: 'https://appleid.apple.com', sub: CLIENT });
    assert.ok(call.claims.exp - call.claims.iat <= 300);
    assert.equal(call.signatureValid, true);
  }
  // A dashboard paste with literal \n and a bare base64 body both work.
  const escaped = envOf({ APPLE_SIWA_PRIVATE_KEY: pem.replace(/\n/g, '\\n') });
  assert.ok(await m.readAppleConfig(escaped));
  const bare = envOf({ APPLE_SIWA_PRIVATE_KEY: pem.replace(/-----[A-Z ]+-----/g, '').replace(/\s+/g, '') });
  assert.ok(await m.readAppleConfig(bare));
});

test('sub mismatch: the code belongs to another Apple ID → NOTHING is revoked', async () => {
  const apple = fakeApple({ idTokenClaims: { iss: 'https://appleid.apple.com', aud: CLIENT, sub: '000999.other.0001' } });
  assert.equal(await m.revokeAppleSignIn({ env: envOf(), user: appleUser(), authorizationCode: CODE, fetchImpl: apple.fetchImpl }), 'sub_mismatch');
  assert.deepEqual(apple.calls.map((c) => c.url), [m.APPLE_TOKEN_URL]);
  // An Apple account per app_metadata but without an identity subject cannot be matched either: no call at all.
  const noIdentity = fakeApple();
  const user = { id: randomUUID(), identities: [], app_metadata: { provider: 'apple', providers: ['apple'] } };
  assert.equal(await m.revokeAppleSignIn({ env: envOf(), user, authorizationCode: CODE, fetchImpl: noIdentity.fetchImpl }), 'sub_mismatch');
  assert.equal(noIdentity.calls.length, 0);
});

test('an id_token for another client or issuer, or none → failed, no revoke', async () => {
  for (const tokenBody of [
    { refresh_token: 'rt', id_token: unsignedJwt({ iss: 'https://appleid.apple.com', aud: 'com.other.app', sub: APPLE_SUB }) },
    { refresh_token: 'rt', id_token: unsignedJwt({ iss: 'https://evil.example', aud: CLIENT, sub: APPLE_SUB }) },
    { refresh_token: 'rt' },
    { id_token: unsignedJwt({ iss: 'https://appleid.apple.com', aud: CLIENT, sub: APPLE_SUB }) },
  ]) {
    const apple = fakeApple({ tokenBody });
    assert.equal(await m.revokeAppleSignIn({ env: envOf(), user: appleUser(), authorizationCode: CODE, fetchImpl: apple.fetchImpl }), 'failed');
    assert.deepEqual(apple.calls.map((c) => c.url), [m.APPLE_TOKEN_URL]);
  }
  // only an access token: revoked with the access_token hint
  const apple = fakeApple({ tokenBody: { access_token: 'at-only', id_token: unsignedJwt({ iss: 'https://appleid.apple.com', aud: [CLIENT], sub: APPLE_SUB }) } });
  assert.equal(await m.revokeAppleSignIn({ env: envOf(), user: appleUser(), authorizationCode: CODE, fetchImpl: apple.fetchImpl }), 'revoked');
  assert.deepEqual([apple.calls[1].form.token, apple.calls[1].form.token_type_hint], ['at-only', 'access_token']);
});

test('Apple 4xx/5xx or unreachable → failed (never throws)', async () => {
  for (const options of [{ tokenStatus: 400 }, { tokenStatus: 500 }, { revokeStatus: 400 }, { revokeStatus: 503 },
    { throwOn: 'https://appleid.apple.com/auth/token' }, { throwOn: 'https://appleid.apple.com/auth/revoke' }]) {
    const apple = fakeApple(options);
    assert.equal(await m.revokeAppleSignIn({ env: envOf(), user: appleUser(), authorizationCode: CODE, fetchImpl: apple.fetchImpl }), 'failed', JSON.stringify(options));
  }
});

test('no Apple identity → not_apple (even with a code, Apple is never called); Apple without code → no_code; bad code → failed; no secrets → not_configured', async () => {
  const apple = fakeApple();
  const google = { id: randomUUID(), identities: [{ provider: 'google', provider_id: '123' }], app_metadata: { provider: 'google', providers: ['google'] } };
  assert.equal(await m.revokeAppleSignIn({ env: envOf(), user: google, authorizationCode: CODE, fetchImpl: apple.fetchImpl }), 'not_apple');
  assert.equal(await m.revokeAppleSignIn({ env: envOf(), user: null, authorizationCode: CODE, fetchImpl: apple.fetchImpl }), 'not_apple');
  for (const code of [undefined, null, '']) {
    assert.equal(await m.revokeAppleSignIn({ env: envOf(), user: appleUser(), authorizationCode: code, fetchImpl: apple.fetchImpl }), 'no_code');
  }
  for (const code of ['short', 42, { code: CODE }, 'has spaces in it ok', 'x'.repeat(3000)]) {
    assert.equal(await m.revokeAppleSignIn({ env: envOf(), user: appleUser(), authorizationCode: code, fetchImpl: apple.fetchImpl }), 'failed');
  }
  for (const missing of m.SECRET_NAMES) {
    assert.equal(await m.revokeAppleSignIn({ env: envOf({ [missing]: undefined }), user: appleUser(), authorizationCode: CODE, fetchImpl: apple.fetchImpl }), 'not_configured', missing);
  }
  for (const [name, value] of [['APPLE_SIWA_TEAM_ID', 'short'], ['APPLE_SIWA_KEY_ID', 'lower12345'], ['APPLE_SIWA_PRIVATE_KEY', 'not a key'],
    ['APPLE_SIWA_PRIVATE_KEY', `-----BEGIN PRIVATE KEY-----\n${randomBytes(64).toString('base64')}\n-----END PRIVATE KEY-----`], ['APPLE_SIWA_CLIENT_ID', 'bad id/with slash']]) {
    assert.equal(await m.revokeAppleSignIn({ env: envOf({ [name]: value }), user: appleUser(), authorizationCode: CODE, fetchImpl: apple.fetchImpl }), 'not_configured', name);
  }
  assert.equal(apple.calls.length, 0, 'none of these reached Apple');
});

test('the module never logs (no code, tokens or key can end up in logs from here)', async () => {
  const source = await fs.readFile(modulePath, 'utf8');
  assert.doesNotMatch(source, /console\./);
  const lines = [];
  const saved = { log: console.log, warn: console.warn, error: console.error, info: console.info };
  for (const k of Object.keys(saved)) console[k] = (...a) => lines.push(a.join(' '));
  try {
    for (const options of [{}, { tokenStatus: 400 }, { revokeStatus: 500 }]) {
      const apple = fakeApple(options);
      await m.revokeAppleSignIn({ env: envOf(), user: appleUser(), authorizationCode: CODE, fetchImpl: apple.fetchImpl });
    }
  } finally { Object.assign(console, saved); }
  assert.deepEqual(lines, []);
});

test('helpers: appleSubjectsOf / hasAppleSignIn / decodeJwtClaims', () => {
  assert.deepEqual(m.appleSubjectsOf(appleUser()), [APPLE_SUB]);
  assert.deepEqual(m.appleSubjectsOf({ identities: [{ provider: 'apple', provider_id: 'p-sub' }] }), ['p-sub'], 'older shape');
  assert.deepEqual(m.appleSubjectsOf({ identities: [{ provider: 'apple', identity_data: { sub: 'd-sub' } }] }), ['d-sub']);
  assert.deepEqual(m.appleSubjectsOf({ identities: [{ provider: 'google', provider_id: 'g' }] }), []);
  assert.equal(m.hasAppleSignIn({ app_metadata: { providers: ['email', 'apple'] } }), true);
  assert.equal(m.hasAppleSignIn({ app_metadata: { providers: ['google'] } }), false);
  assert.equal(m.decodeJwtClaims('a.b'), null);
  assert.equal(m.decodeJwtClaims(`x.${b64url('not json')}.y`), null);
  assert.deepEqual(m.decodeJwtClaims(unsignedJwt({ sub: 's' })), { sub: 's' });
});
