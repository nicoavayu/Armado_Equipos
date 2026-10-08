import test from 'node:test';
import assert from 'node:assert/strict';
import { prepare } from './prepare.mjs';
import { createPrivateWebPasswordHash, createPrivateWebAccessToken } from '../../server/privateWebAccess.mjs';
import access from '../../netlify/functions/private-web-access.mjs';
import logout from '../../netlify/functions/private-web-logout.mjs';

prepare();
const { default: gate } = await import('../../.netlify-generated/edge-functions/private-web-gate.js');
const base = 'https://arma2-test.netlify.app';
const secret = 'test-only-signing-secret-that-is-not-a-deployed-credential';
const context = (request) => ({ next: async (replacement) => new Response(new URL(replacement?.url || request.url).pathname) });
const run = (path, options = {}) => {
  const request = new Request(base + path, options);
  return gate(request, context(request));
};

test('private routes remain gated without a secret, including direct index.html', async () => {
  for (const path of ['/', '/profile', '/index.html', '/frecuentes/1/historial', '/votar-equipos']) {
    const result = await run(path);
    assert.equal(await result.text(), '/mobile-only.html');
    assert.match(result.headers.get('Cache-Control'), /no-store/);
    assert.match(result.headers.get('Content-Security-Policy'), /frame-ancestors 'none'/);
  }
});
test('public login, tournament routes and valid WhatsApp links retain their allowlist', async () => {
  for (const path of ['/login', '/auth/callback', '/torneos/explorar', '/votar-equipos?codigo=ABCD', '/partido/1/invitacion?codigo=ABCD&invite=' + 'a'.repeat(32)]) {
    assert.equal(await (await run(path)).text(), new URL(base + path).pathname);
  }
  assert.equal(await (await run('/partido/1/invitacion?codigo=ABCD')).text(), '/mobile-only.html');
});
test('legacy WhatsApp voting alias redirects without weakening the gate', async () => {
  const response = await run('/?codigo=ABCD');
  assert.equal(response.status, 308);
  assert.equal(response.headers.get('Location'), base + '/votar-equipos?codigo=ABCD');
});
test('valid signed cookie allows private routes; tampered cookie does not', async () => {
  globalThis.Netlify = { env: { get: () => secret } };
  const token = await createPrivateWebAccessToken(secret);
  assert.equal(await (await run('/profile', { headers: { cookie: '__Host-arma2_private_web=' + token } })).text(), '/profile');
  assert.equal(await (await run('/profile', { headers: { cookie: '__Host-arma2_private_web=' + token + 'x' } })).text(), '/mobile-only.html');
  delete globalThis.Netlify;
});
test('unauthorized writes are denied and missing auth configuration is unavailable', async () => {
  assert.equal((await run('/profile', { method: 'POST' })).status, 403);
  assert.equal((await access(new Request(base + '/api/private-web-access', { method: 'POST', body: 'password=test' }))).status, 503);
});
test('access handler validates origin, password, cookie flags and safe return path', async () => {
  process.env.PRIVATE_WEB_ACCESS_PASSWORD_HASH = await createPrivateWebPasswordHash('local-test-password');
  process.env.PRIVATE_WEB_ACCESS_SIGNING_SECRET = secret;
  const request = (origin, body) => new Request(base + '/api/private-web-access', {
    method: 'POST', headers: { origin, 'content-type': 'application/x-www-form-urlencoded' }, body,
  });
  assert.equal((await access(request('https://unrelated.invalid', 'password=local-test-password'))).status, 403);
  const response = await access(request(base, 'password=local-test-password&returnTo=https://unrelated.invalid'));
  assert.equal(response.status, 303);
  assert.equal(response.headers.get('Location'), '/login');
  for (const flag of ['HttpOnly', 'Secure', 'SameSite=Lax', 'Path=/']) assert.ok(response.headers.get('Set-Cookie').includes(flag));
  const invalid = await access(request(base, 'password=incorrect'));
  assert.equal(invalid.headers.get('Set-Cookie'), null);
  assert.match(invalid.headers.get('Location'), /error=1/);
  delete process.env.PRIVATE_WEB_ACCESS_PASSWORD_HASH;
  delete process.env.PRIVATE_WEB_ACCESS_SIGNING_SECRET;
});
test('access handler rejects oversized streamed payloads', async () => {
  const response = await access(new Request(base + '/api/private-web-access', { method: 'POST', body: 'x'.repeat(4097) }));
  assert.equal(response.status, 413);
});
test('logout remains same-origin and expires the cookie', async () => {
  assert.equal((await logout(new Request(base + '/api/private-web-logout'))).status, 405);
  assert.equal((await logout(new Request(base + '/api/private-web-logout', { method: 'POST', headers: { origin: 'https://unrelated.invalid' } }))).status, 403);
  const response = await logout(new Request(base + '/api/private-web-logout', { method: 'POST', headers: { origin: base } }));
  assert.equal(response.status, 204);
  assert.match(response.headers.get('Set-Cookie'), /Max-Age=0/);
});
