import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { prepare } from './prepare.mjs';
import { decide, onlyNonWebChanges } from './should-build.mjs';
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
test('universal-link files keep the content type and cache vercel.json gives them', () => {
  const vercel = JSON.parse(fs.readFileSync(new URL('../../vercel.json', import.meta.url), 'utf8'));
  const toml = fs.readFileSync(new URL('../../netlify.toml', import.meta.url), 'utf8');
  for (const file of ['/.well-known/apple-app-site-association', '/.well-known/assetlinks.json']) {
    const expected = vercel.headers.find((rule) => rule.source === file).headers;
    const block = toml.split('[[headers]]').find((part) => part.includes(`for = "${file}"`));
    assert.ok(block, `netlify.toml has no header rule for ${file}`);
    for (const { key, value } of expected) assert.ok(block.includes(`${key} = "${value}"`), `${file}: ${key}`);
  }
});
test('the ignore command skips only merges that touch no web path, and builds when unsure', () => {
  assert.equal(onlyNonWebChanges(['backend/torneos/x.sql', 'docs/a.md', 'android/app/build.gradle', 'README.md']), true);
  assert.equal(onlyNonWebChanges(['backend/torneos/x.sql', 'src/App.js']), false);
  for (const web of ['public/index.html', 'package.json', 'netlify.toml', 'middleware.ts', 'server/privateWebAccess.mjs',
    'api/private-web-access.mjs', 'netlify/functions/private-web-access.mjs', 'scripts/netlify/prepare.mjs', 'scripts/build-env.mjs']) {
    assert.equal(onlyNonWebChanges(['docs/a.md', web]), false, web);
  }
  assert.equal(onlyNonWebChanges([]), false);
  assert.deepEqual(decide({ from: undefined, to: 'b' }).skip, false);
  assert.deepEqual(decide({ from: 'a', to: 'a' }).skip, false);
  assert.equal(decide({ from: 'a', to: 'b', git: () => { throw new Error('shallow'); } }).skip, false);
  assert.equal(decide({ from: 'a', to: 'b', git: () => 'supabase/migrations/x.sql\ndocs/y.md\n' }).skip, true);
  assert.equal(decide({ from: 'a', to: 'b', git: () => 'supabase/migrations/x.sql\nsrc/index.js\n' }).skip, false);
});

// netlify.toml as { "<table>": { key: value } } (plain tables only; [[array]] blocks are skipped). Enough for this file.
function tomlTables(text) {
  const tables = {};
  let current = null;
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    if (line.startsWith('[[')) { current = null; continue; }
    const header = line.match(/^\[([^\]]+)\]$/);
    if (header) { current = header[1]; tables[current] = tables[current] || {}; continue; }
    const pair = line.match(/^([A-Za-z0-9_.-]+)\s*=\s*"(.*)"$/);
    if (pair && current) tables[current][pair[1]] = pair[2];
  }
  return tables;
}
const toml = () => tomlTables(fs.readFileSync(new URL('../../netlify.toml', import.meta.url), 'utf8'));

test('production builds like Vercel: gate secrets validated, Sentry release = commit, only DEPLOY_ENV set by the file', () => {
  const t = toml();
  const command = t['context.production'].command;
  const vercel = JSON.parse(fs.readFileSync(new URL('../../vercel.json', import.meta.url), 'utf8'));
  for (const step of ['node scripts/netlify/prepare.mjs', 'npm run validate:web-access-env', 'REACT_APP_SENTRY_RELEASE=$COMMIT_REF', 'npm run release:web:sentry']) {
    assert.ok(command.includes(step), step);
  }
  for (const step of ['validate:web-access-env', 'release:web:sentry']) assert.ok(vercel.buildCommand.includes(step), `vercel ${step}`);
  assert.deepEqual(t['context.production.environment'], { REACT_APP_DEPLOY_ENV: 'production' });
  // The base environment reaches production: no REACT_APP_* there, so production takes the site's Production values.
  assert.deepEqual(Object.keys(t['build.environment']).filter((key) => key.startsWith('REACT_APP_')), []);
});
test('every non-production deploy stays a preview with Torneos production off, and no context sets billing', () => {
  const t = toml();
  for (const context of ['context.deploy-preview.environment', 'context.branch-deploy.environment']) {
    assert.equal(t[context].REACT_APP_DEPLOY_ENV, 'preview', context);
    assert.equal(t[context].REACT_APP_TORNEOS_PRODUCTION_ENABLED, 'false', context);
  }
  for (const [name, values] of Object.entries(t)) {
    assert.equal(values.REACT_APP_TORNEOS_BILLING_MODE, undefined, name);
    if (name.startsWith('context.production')) {
      assert.deepEqual(Object.keys(values).filter((key) => key.startsWith('REACT_APP_TORNEOS_')), [], name);
    }
  }
});
test('a merge to main does not deploy on Vercel; other branches keep their Vercel previews', () => {
  const vercel = JSON.parse(fs.readFileSync(new URL('../../vercel.json', import.meta.url), 'utf8'));
  assert.deepEqual(vercel.git, { deploymentEnabled: { main: false } });
});
test('site-wide headers match Vercel production and nothing marks production noindex', () => {
  const vercel = JSON.parse(fs.readFileSync(new URL('../../vercel.json', import.meta.url), 'utf8'));
  const text = fs.readFileSync(new URL('../../netlify.toml', import.meta.url), 'utf8');
  const block = text.split('[[headers]]').find((part) => part.includes('for = "/*"'));
  for (const { key, value } of vercel.headers.find((rule) => rule.source === '/(.*)').headers) {
    assert.ok(block.includes(`${key} = "${value}"`), key);
  }
  assert.doesNotMatch(text, /X-Robots-Tag/);
});
test('source maps a release build produces stay behind the gate, as on Vercel', async () => {
  for (const path of ['/static/js/main.1a2b3c4d.js.map', '/static/css/main.1a2b3c4d.css.map', '/static/js/123.1a2b3c4d.chunk.js.map']) {
    assert.equal(await (await run(path)).text(), '/mobile-only.html', path);
  }
  assert.equal(await (await run('/static/js/main.1a2b3c4d.js')).text(), '/static/js/main.1a2b3c4d.js');
});
