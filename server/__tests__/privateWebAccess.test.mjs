import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import privateWebAccessHandler from '../../api/private-web-access.mjs';
import privateWebLogoutHandler from '../../api/private-web-logout.mjs';
import privateWebGate from '../../middleware.ts';
import publicVotingRoutes from '../../src/config/publicVotingRoutes.js';
import publicMatchInviteRoutes from '../../src/config/publicMatchInviteRoutes.js';
import {
  PRIVATE_WEB_COOKIE_MAX_AGE_SECONDS,
  PRIVATE_WEB_COOKIE_NAME,
  createPrivateWebAccessToken,
  createPrivateWebPasswordHash,
  normalizePrivateWebReturnTo,
  serializePrivateWebAccessCookie,
  verifyPrivateWebAccessToken,
  verifyPrivateWebPassword,
} from '../privateWebAccess.mjs';

const TEST_PASSWORD = 'not-a-real-private-password';
const TEST_SIGNING_SECRET = 'test-only-signing-secret-with-at-least-32-characters';
const OTHER_SIGNING_SECRET = 'different-test-signing-secret-with-32-characters';
const TEST_ORIGIN = 'https://arma2-preview.example.com';
const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(testDirectory, '../..');
const { PUBLIC_VOTING_ROUTE_ALLOWLIST } = publicVotingRoutes;
const { PUBLIC_MATCH_INVITE_ROUTE_ALLOWLIST } = publicMatchInviteRoutes;
const TEST_INVITE_TOKEN = '0123456789abcdef0123456789abcdef';

function createMockResponse() {
  const headers = new Map();
  return {
    statusCode: 200,
    body: '',
    ended: false,
    setHeader(name, value) {
      headers.set(String(name).toLowerCase(), value);
    },
    getHeader(name) {
      return headers.get(String(name).toLowerCase());
    },
    end(body = '') {
      this.body = body;
      this.ended = true;
    },
  };
}

function createPostRequest(body, { origin = TEST_ORIGIN } = {}) {
  return {
    method: 'POST',
    headers: {
      host: 'arma2-preview.example.com',
      origin,
      'x-forwarded-host': 'arma2-preview.example.com',
      'x-forwarded-proto': 'https',
      'content-type': 'application/x-www-form-urlencoded',
    },
    body,
  };
}

async function invokeGate(pathname, { cookie, origin = TEST_ORIGIN, method = 'GET' } = {}) {
  const headers = cookie ? { cookie } : undefined;
  return privateWebGate(new Request(`${origin}${pathname}`, { headers, method }));
}

test('PBKDF2 password hashes validate the right password without storing plaintext', async () => {
  const hash = await createPrivateWebPasswordHash(TEST_PASSWORD, { iterations: 100_000 });

  assert.equal(hash.includes(TEST_PASSWORD), false);
  assert.equal(await verifyPrivateWebPassword(TEST_PASSWORD, hash), true);
  assert.equal(await verifyPrivateWebPassword('wrong-password', hash), false);
});

test('signed access tokens reject tampering, expiration, and another signing secret', async () => {
  const nowMs = Date.UTC(2026, 6, 15, 12, 0, 0);
  const token = await createPrivateWebAccessToken(TEST_SIGNING_SECRET, { nowMs });
  const alteredToken = `${token.slice(0, -1)}${token.endsWith('a') ? 'b' : 'a'}`;

  assert.equal(await verifyPrivateWebAccessToken(token, TEST_SIGNING_SECRET, { nowMs }), true);
  assert.equal(await verifyPrivateWebAccessToken(alteredToken, TEST_SIGNING_SECRET, { nowMs }), false);
  assert.equal(await verifyPrivateWebAccessToken(token, OTHER_SIGNING_SECRET, { nowMs }), false);
  assert.equal(
    await verifyPrivateWebAccessToken(token, TEST_SIGNING_SECRET, {
      nowMs: nowMs + ((PRIVATE_WEB_COOKIE_MAX_AGE_SECONDS + 1) * 1000),
    }),
    false,
  );
});

test('the authorization cookie is host-only, secure, HttpOnly, Lax, and lasts 30 days', async () => {
  const token = await createPrivateWebAccessToken(TEST_SIGNING_SECRET);
  const cookie = serializePrivateWebAccessCookie(token);

  assert.match(cookie, new RegExp(`^${PRIVATE_WEB_COOKIE_NAME}=`));
  assert.match(cookie, /Path=\//);
  assert.match(cookie, /Max-Age=2592000/);
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /Secure/);
  assert.match(cookie, /SameSite=Lax/);
  assert.doesNotMatch(cookie, /Domain=/i);
});

test('returnTo accepts only same-origin paths and blocks open redirects', () => {
  assert.equal(normalizePrivateWebReturnTo('/profile?tab=cuenta#web'), '/profile?tab=cuenta#web');
  assert.equal(normalizePrivateWebReturnTo('//evil.example/path'), '/login');
  assert.equal(normalizePrivateWebReturnTo('/\\evil.example/path'), '/login');
  assert.equal(normalizePrivateWebReturnTo('https://evil.example/path'), '/login');
  assert.equal(normalizePrivateWebReturnTo('/login%0d%0aLocation:evil'), '/login');
});

test('an anonymous visitor receives mobile-only HTML for root and internal SPA routes', async () => {
  for (const pathname of ['/', '/login', '/registro', '/profile', '/partido/123', '/auth/callback']) {
    const response = await invokeGate(pathname);
    assert.equal(response.status, 200, pathname);
    assert.equal(
      response.headers.get('x-middleware-rewrite'),
      `${TEST_ORIGIN}/mobile-only.html`,
      pathname,
    );
  }

  const staticChunk = await invokeGate('/static/js/main.secret.js');
  assert.equal(staticChunk.headers.get('x-middleware-rewrite'), `${TEST_ORIGIN}/mobile-only.html`);
});

test('native association files bypass the private web gate', async () => {
  for (const pathname of [
    '/.well-known/apple-app-site-association',
    '/.well-known/assetlinks.json',
  ]) {
    const response = await invokeGate(pathname);
    assert.equal(response.headers.get('x-middleware-next'), '1', pathname);
    assert.equal(response.headers.get('x-middleware-rewrite'), null, pathname);
  }
});

test('the public voting allowlist is exact and requires the existing match-code query', async () => {
  assert.deepEqual(PUBLIC_VOTING_ROUTE_ALLOWLIST, [
    { pathname: '/votar-equipos', requiredQueryParameter: 'codigo' },
  ]);

  for (const pathname of [
    '/votar-equipos?codigo=H03G61',
    '/votar-equipos?codigo=INVALIDO',
    '/votar-equipos?codigo=H03G61&token=legacy-token&source=whatsapp',
  ]) {
    const response = await invokeGate(pathname);
    assert.equal(response.headers.get('x-middleware-next'), '1', pathname);
    assert.equal(response.headers.get('x-middleware-rewrite'), null, pathname);
  }

  for (const pathname of [
    '/votar-equipos',
    '/votar-equipos?codigo=',
    '/votar-equipos?partidoId=321',
    '/votar-equipos-extra?codigo=H03G61',
    '/votar-equipos/321?codigo=H03G61',
    '/login',
  ]) {
    const response = await invokeGate(pathname);
    assert.equal(
      response.headers.get('x-middleware-rewrite'),
      `${TEST_ORIGIN}/mobile-only.html`,
      pathname,
    );
  }

  const publicRoutePost = await invokeGate('/votar-equipos?codigo=H03G61', { method: 'POST' });
  assert.equal(publicRoutePost.status, 403);
  assert.equal(await publicRoutePost.text(), 'Access denied');
});

test('the public match-invite allowlist preserves the real path, aliases, code, and token contract', async () => {
  assert.deepEqual(PUBLIC_MATCH_INVITE_ROUTE_ALLOWLIST, [
    {
      pathnamePattern: '/partido/:partidoId/invitacion',
      requiredQueryParameters: [
        ['codigo', 'c'],
        ['invite', 'i'],
      ],
    },
  ]);

  for (const pathname of [
    `/partido/321/invitacion?c=H03G61&i=${TEST_INVITE_TOKEN}`,
    `/partido/321/invitacion?codigo=H03G61&invite=${TEST_INVITE_TOKEN}`,
    `/partido/321/invitacion?c=INVALIDO&i=${'f'.repeat(32)}&source=whatsapp`,
  ]) {
    const response = await invokeGate(pathname);
    assert.equal(response.headers.get('x-middleware-next'), '1', pathname);
    assert.equal(response.headers.get('x-middleware-rewrite'), null, pathname);
  }

  for (const pathname of [
    '/partido/321/invitacion',
    `/partido/321/invitacion?c=&i=${TEST_INVITE_TOKEN}`,
    '/partido/321/invitacion?c=H03G61',
    '/partido/321/invitacion?c=H03G61&i=not-a-token',
    `/partido/321/invitacion?c=ABC&i=${TEST_INVITE_TOKEN}`,
    `/partido/0/invitacion?c=H03G61&i=${TEST_INVITE_TOKEN}`,
    `/partido/not-a-match/invitacion?c=H03G61&i=${TEST_INVITE_TOKEN}`,
    `/partido/321/invitacion/extra?c=H03G61&i=${TEST_INVITE_TOKEN}`,
    `/partido/321?c=H03G61&i=${TEST_INVITE_TOKEN}`,
    `/profile?c=H03G61&i=${TEST_INVITE_TOKEN}`,
  ]) {
    const response = await invokeGate(pathname);
    assert.equal(
      response.headers.get('x-middleware-rewrite'),
      `${TEST_ORIGIN}/mobile-only.html`,
      pathname,
    );
  }

  const publicRoutePost = await invokeGate(
    `/partido/321/invitacion?c=H03G61&i=${TEST_INVITE_TOKEN}`,
    { method: 'POST' },
  );
  assert.equal(publicRoutePost.status, 403);
  assert.equal(await publicRoutePost.text(), 'Access denied');
});

test('public voting and guest invitation coexist without opening any third SPA entry', async () => {
  const voting = await invokeGate('/votar-equipos?codigo=H03G61');
  const invitation = await invokeGate(
    `/partido/321/invitacion?c=H03G61&i=${TEST_INVITE_TOKEN}`,
  );
  const privateRoute = await invokeGate('/partido/321');

  assert.equal(voting.headers.get('x-middleware-next'), '1');
  assert.equal(invitation.headers.get('x-middleware-next'), '1');
  assert.equal(
    privateRoute.headers.get('x-middleware-rewrite'),
    `${TEST_ORIGIN}/mobile-only.html`,
  );
});

test('anonymous public flows can load only hashed SPA build assets', async () => {
  for (const pathname of [
    '/static/js/main.983416ff.js',
    '/static/js/6438.e459db10.chunk.js',
    '/static/css/main.adb62df7.css',
    '/static/media/Logo.caa6c0d9880771643ab5.png',
    '/static/media/oswald-latin.e626a4120b15bb42a749.woff2',
  ]) {
    const response = await invokeGate(pathname);
    assert.equal(response.headers.get('x-middleware-next'), '1', pathname);
  }

  for (const pathname of [
    '/static/js/main.secret.js',
    '/static/js/unhashed.js',
    '/static/media/private-notes.txt',
  ]) {
    const response = await invokeGate(pathname);
    assert.equal(
      response.headers.get('x-middleware-rewrite'),
      `${TEST_ORIGIN}/mobile-only.html`,
      pathname,
    );
  }
});

test('the private route is available but never linked from the public page', async () => {
  const response = await invokeGate('/acceso-web?returnTo=%2Fprofile');
  assert.equal(
    response.headers.get('x-middleware-rewrite'),
    `${TEST_ORIGIN}/private-web-access.html`,
  );

  const publicHtml = await readFile(path.join(repoRoot, 'public/mobile-only.html'), 'utf8');
  assert.doesNotMatch(publicHtml, /acceso-web|private-web-access|login|registro/i);
});

test('a valid cookie permits the SPA and the access route redirects safely', async () => {
  process.env.PRIVATE_WEB_ACCESS_SIGNING_SECRET = TEST_SIGNING_SECRET;
  const token = await createPrivateWebAccessToken(TEST_SIGNING_SECRET);
  const cookie = `${PRIVATE_WEB_COOKIE_NAME}=${token}`;

  const response = await invokeGate('/profile', { cookie });
  assert.equal(response.headers.get('x-middleware-next'), '1');
  assert.equal(response.headers.get('x-middleware-rewrite'), null);

  const accessRoute = await invokeGate('/acceso-web?returnTo=%2Fprofile', { cookie });
  assert.equal(accessRoute.status, 302);
  assert.equal(accessRoute.headers.get('location'), `${TEST_ORIGIN}/profile`);
});

test('localhost and Capacitor origins bypass the Vercel web gate', async () => {
  const localhostResponse = await privateWebGate(new Request('https://localhost/login'));
  const loopbackResponse = await privateWebGate(new Request('http://127.0.0.1:3000/profile'));
  const capacitorResponse = await privateWebGate(new Request('capacitor://localhost/profile'));
  const nativeInviteDeepLink = await privateWebGate(new Request(
    `capacitor://localhost/partido/321/invitacion?c=H03G61&i=${TEST_INVITE_TOKEN}`,
  ));

  assert.equal(localhostResponse.headers.get('x-middleware-next'), '1');
  assert.equal(loopbackResponse.headers.get('x-middleware-next'), '1');
  assert.equal(capacitorResponse.headers.get('x-middleware-next'), '1');
  assert.equal(nativeInviteDeepLink.headers.get('x-middleware-next'), '1');
});

test('legacy production hosts redirect permanently while previews stay on their own host', async () => {
  const legacy = await privateWebGate(
    new Request('https://arma2.vercel.app/profile?source=legacy'),
  );
  assert.equal(legacy.status, 308);
  assert.equal(legacy.headers.get('location'), 'https://app.arma2.com.ar/profile?source=legacy');

  const preview = await invokeGate('/login', {
    origin: 'https://arma2-git-private-web-nicoavayus-projects.vercel.app',
  });
  assert.equal(preview.status, 200);
  assert.equal(
    preview.headers.get('x-middleware-rewrite'),
    'https://arma2-git-private-web-nicoavayus-projects.vercel.app/mobile-only.html',
  );
});

test('legacy voting links preserve their code, token, path, and query before opening the exact public route', async () => {
  const currentVotingLink = await privateWebGate(
    new Request('https://arma2.vercel.app/votar-equipos?codigo=H03G61&token=abc123&source=whatsapp'),
  );
  assert.equal(currentVotingLink.status, 308);
  assert.equal(
    currentVotingLink.headers.get('location'),
    'https://app.arma2.com.ar/votar-equipos?codigo=H03G61&token=abc123&source=whatsapp',
  );

  const historicalRootLink = await privateWebGate(
    new Request('https://arma2.vercel.app/?codigo=H03G61&token=abc123&source=whatsapp'),
  );
  assert.equal(historicalRootLink.status, 308);
  assert.equal(
    historicalRootLink.headers.get('location'),
    'https://app.arma2.com.ar/?codigo=H03G61&token=abc123&source=whatsapp',
  );

  const normalizedHistoricalLink = await privateWebGate(
    new Request(historicalRootLink.headers.get('location')),
  );
  assert.equal(normalizedHistoricalLink.status, 308);
  assert.equal(
    normalizedHistoricalLink.headers.get('location'),
    'https://app.arma2.com.ar/votar-equipos?codigo=H03G61&token=abc123&source=whatsapp',
  );

  const publicVotingResponse = await privateWebGate(
    new Request(normalizedHistoricalLink.headers.get('location')),
  );
  assert.equal(publicVotingResponse.headers.get('x-middleware-next'), '1');
  assert.equal(publicVotingResponse.headers.get('x-middleware-rewrite'), null);
});

test('legacy production invite links preserve the existing deep-link path and short parameters', async () => {
  const legacyInvite = await privateWebGate(new Request(
    `https://arma2.vercel.app/partido/321/invitacion?c=H03G61&i=${TEST_INVITE_TOKEN}`,
  ));

  assert.equal(legacyInvite.status, 308);
  assert.equal(
    legacyInvite.headers.get('location'),
    `https://app.arma2.com.ar/partido/321/invitacion?c=H03G61&i=${TEST_INVITE_TOKEN}`,
  );

  const canonicalInvite = await privateWebGate(
    new Request(legacyInvite.headers.get('location')),
  );
  assert.equal(canonicalInvite.headers.get('x-middleware-next'), '1');
  assert.equal(canonicalInvite.headers.get('x-middleware-rewrite'), null);
});

test('anonymous health checks do not load the SPA or expose user data', async () => {
  const response = await invokeGate('/health');
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { status: 'ok' });
  assert.equal(response.headers.get('x-middleware-rewrite'), null);
});

test('correct password issues the private cookie and incorrect password never authorizes', async () => {
  process.env.PRIVATE_WEB_ACCESS_PASSWORD_HASH = await createPrivateWebPasswordHash(
    TEST_PASSWORD,
    { iterations: 100_000 },
  );
  process.env.PRIVATE_WEB_ACCESS_SIGNING_SECRET = TEST_SIGNING_SECRET;

  const successResponse = createMockResponse();
  await privateWebAccessHandler(
    createPostRequest({ password: TEST_PASSWORD, returnTo: '/profile' }),
    successResponse,
  );
  assert.equal(successResponse.statusCode, 303);
  assert.equal(successResponse.getHeader('location'), '/profile');
  assert.match(successResponse.getHeader('set-cookie'), /HttpOnly; Secure; SameSite=Lax/);

  const failureResponse = createMockResponse();
  await privateWebAccessHandler(
    createPostRequest({ password: 'wrong-password', returnTo: '/profile' }),
    failureResponse,
  );
  assert.equal(failureResponse.statusCode, 303);
  assert.equal(failureResponse.getHeader('set-cookie'), undefined);
  assert.match(failureResponse.getHeader('location'), /^\/acceso-web\?error=1/);
});

test('private access POST rejects a cross-origin request and returnTo open redirects', async () => {
  process.env.PRIVATE_WEB_ACCESS_PASSWORD_HASH = await createPrivateWebPasswordHash(
    TEST_PASSWORD,
    { iterations: 100_000 },
  );
  process.env.PRIVATE_WEB_ACCESS_SIGNING_SECRET = TEST_SIGNING_SECRET;

  const crossOriginResponse = createMockResponse();
  await privateWebAccessHandler(
    createPostRequest(
      { password: TEST_PASSWORD, returnTo: '/profile' },
      { origin: 'https://evil.example' },
    ),
    crossOriginResponse,
  );
  assert.equal(crossOriginResponse.statusCode, 403);
  assert.equal(crossOriginResponse.getHeader('set-cookie'), undefined);

  const safeRedirectResponse = createMockResponse();
  await privateWebAccessHandler(
    createPostRequest({ password: TEST_PASSWORD, returnTo: '//evil.example' }),
    safeRedirectResponse,
  );
  assert.equal(safeRedirectResponse.getHeader('location'), '/login');
});

test('closing web access clears only the private cookie', () => {
  const response = createMockResponse();
  privateWebLogoutHandler(createPostRequest({}), response);

  assert.equal(response.statusCode, 204);
  assert.match(response.getHeader('set-cookie'), new RegExp(`^${PRIVATE_WEB_COOKIE_NAME}=`));
  assert.match(response.getHeader('set-cookie'), /Max-Age=0/);
  assert.match(response.getHeader('set-cookie'), /HttpOnly; Secure; SameSite=Lax/);
});

test('public and private pages preserve copy, stores, accessibility, and secret isolation', async () => {
  const [publicHtml, privateHtml, publicStyles, publicScript, profileEditor, logoutService] = await Promise.all([
    readFile(path.join(repoRoot, 'public/mobile-only.html'), 'utf8'),
    readFile(path.join(repoRoot, 'public/private-web-access.html'), 'utf8'),
    readFile(path.join(repoRoot, 'public/web-access.css'), 'utf8'),
    readFile(path.join(repoRoot, 'public/web-access.js'), 'utf8'),
    readFile(path.join(repoRoot, 'src/components/ProfileEditor.js'), 'utf8'),
    readFile(path.join(repoRoot, 'src/services/authLogoutService.js'), 'utf8'),
  ]);

  assert.match(publicHtml, /<html lang="es"/);
  assert.match(publicHtml, /<main class="gate-shell">/);
  assert.match(publicHtml, /<h1 id="mobile-only-title">ARMA2 SE VIVE DESDE LA APP<\/h1>/);
  assert.match(publicHtml, /Descargala en tu teléfono y viví tu fútbol amateur como nunca antes\./);
  assert.match(publicHtml, /Descargar en App Store/);
  assert.match(publicHtml, /apps\.apple\.com\/ar\/app\/arma2\/id6760599244/);
  assert.match(publicHtml, /Próximamente en Google Play/);
  assert.doesNotMatch(publicHtml, /play\.google\.com/);
  assert.doesNotMatch(publicHtml, /href=["'][^"']*google/i);
  assert.match(publicStyles, /\.gate-copy h1\s*{[^}]*font-family: 'Bebas Neue'/s);
  assert.match(publicStyles, /\.gate-lead\s*{[^}]*font-family: 'Inter', sans-serif;[^}]*font-weight: 400;[^}]*line-height: 1\.5;[^}]*letter-spacing: normal;/s);
  assert.match(publicStyles, /\.gate-store-button\s*{[^}]*font-family: 'Inter', sans-serif;[^}]*font-weight: 500;[^}]*line-height: 1\.5;[^}]*letter-spacing: normal;/s);
  const embeddedInter = publicHtml.match(/<template id="inter-font-data" aria-hidden="true">([A-Za-z0-9+/=]+)<\/template>/);
  assert.ok(embeddedInter, 'the standalone page embeds the same Inter face used by login');
  const interFontBytes = Buffer.from(embeddedInter[1], 'base64');
  assert.equal(interFontBytes.subarray(0, 4).toString('ascii'), 'wOF2');
  assert.ok(interFontBytes.length > 40000);
  assert.match(publicScript, /new FontFace\('Inter', source/);
  assert.match(publicScript, /document\.fonts\.add\(loadedFace\)/);
  assert.match(privateHtml, /<label for="private-password">Contraseña<\/label>/);
  assert.match(privateHtml, /role="alert" aria-live="polite"/);
  assert.match(profileEditor, /Cerrar acceso web/);
  assert.match(profileEditor, /closePrivateWebAccess/);
  assert.doesNotMatch(logoutService, /PRIVATE_WEB_ACCESS|arma2_private_web/);

  for (const html of [publicHtml, privateHtml]) {
    assert.doesNotMatch(html, /PRIVATE_WEB_ACCESS_PASSWORD_HASH|PRIVATE_WEB_ACCESS_SIGNING_SECRET/);
  }
});
