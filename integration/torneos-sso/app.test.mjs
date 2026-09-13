import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { chromium } from 'playwright';
import { decodeJwt } from 'jose';
import { config, sql, dc } from './lab.mjs';
const origin = 'http://127.0.0.1:58410';
const evidence = { scope: 'Real App.js/AuthProvider/AuthCallback/Core singleton with isolated local GoTrue and profile fixtures', results: [], traffic: [] };
const tokens = [];
async function api(path, token, method = 'GET', body) {
  const r = await fetch(`${origin}${path}`, { method, headers: { ...(token ? { authorization: `Bearer ${token}` } : {}),
    ...(body ? { 'content-type': 'application/json', prefer: 'return=representation' } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, data: await r.json().catch(() => null) };
}
async function account(label) {
  const r = await api('/auth/v1/signup', null, 'POST', { email: `${label}-${randomUUID()}@example.test`, password: `${randomUUID()}Aa!` });
  assert.equal(r.status, 200);
  tokens.push(r.data.access_token, r.data.refresh_token);
  sql('core-db', `INSERT INTO usuarios(id,nombre,email) VALUES ('${r.data.user.id}','Usuario Phase 1.5','fixture@example.test');`);
  const e = await api('/exchange', r.data.access_token, 'POST');
  assert.equal(e.status, 200); tokens.push(e.data.access_token);
  const claims = decodeJwt(e.data.access_token);
  const row = await api('/torneos/rest/v1/sso_probe', e.data.access_token, 'POST', {
    id: randomUUID(), identity_id: claims.sub, note: `Acceso propio ${label}`,
  });
  assert.equal(row.status, 201);
  return { ...r.data, torneosToken: e.data.access_token, identity: claims.sub };
}
async function allFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  return (await Promise.all(entries.map(e => e.isDirectory() ? allFiles(`${dir}/${e.name}`) : `${dir}/${e.name}`))).flat();
}

test('Phase 1.5 real application integration', async t => {
  await mkdir('evidence', { recursive: true });
  const cfg = await config();
  const alice = await account('alice-app');
  const bob = await account('bob-app');
  const browser = await chromium.launch({ headless: true,
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
  const context = await browser.newContext({ viewport: { width: 1280, height: 840 }, serviceWorkers: 'block' });
  const consoleMessages = [];
  let lastTorneosToken;
  let exchangeBlocked = false;
  let coreBefore;
  let page;
  const check = async (name, fn) => t.test(name, async () => {
    try { await fn(); evidence.results.push({ name, status: 'PASS' }); }
    catch (error) { evidence.results.push({ name, status: 'FAIL' }); throw error; }
  });
  await context.route('**/*', async route => {
    const u = new URL(route.request().url());
    if (u.origin !== origin) {
      evidence.traffic.push({ path: 'EXTERNAL_BLOCKED', host: u.hostname });
      return route.abort();
    }
    if (u.pathname.includes('/auth/') || u.pathname === '/exchange' || u.pathname.includes('/rest/')) {
      evidence.traffic.push({ path: u.pathname, method: route.request().method(), grant: u.searchParams.get('grant_type') });
    }
    if (exchangeBlocked && u.pathname === '/exchange') return route.abort();
    if (u.pathname.startsWith('/torneos/rest/')) lastTorneosToken = route.request().headers().authorization?.slice(7);
    return route.continue();
  });
  page = await context.newPage();
  page.on('console', msg => consoleMessages.push(msg.text()));
  page.on('pageerror', error => consoleMessages.push(`PAGEERROR:${error.message}`));
  page.on('response', async r => {
    if (r.url() === `${origin}/exchange` && r.ok()) {
      try { tokens.push((await r.json()).access_token); } catch {}
    }
  });
  const storage = () => page.evaluate(() => Object.fromEntries(Object.entries(localStorage)));
  const coreSession = async () => {
    const values = await storage();
    const key = Object.keys(values).find(k => k.endsWith('-auth-token'));
    assert.ok(key, 'real Core auth storage exists');
    return JSON.parse(values[key]);
  };
  const verify = async () => {
    await Promise.all([
      page.waitForResponse(r => r.url().includes('/torneos/rest/v1/sso_probe') && r.request().method() === 'GET'),
      page.getByRole('button', { name: 'Verificar acceso' }).click(),
    ]);
    await page.getByRole('status').filter({ hasText: 'Acceso Torneos confirmado' }).waitFor();
  };
  const denied = async () => {
    await page.getByRole('button', { name: 'Verificar acceso' }).click();
    await page.getByRole('status').filter({ hasText: 'Torneos no disponible' }).waitFor();
  };
  try {
    await check('existing real Core callback/session -> /torneos silently obtains own RLS row', async () => {
      // Feed a real local GoTrue session into the unchanged application's existing callback.
      // No mocked AuthProvider, no local edit identity, no custom application login.
      await page.goto(`${origin}/auth/callback#access_token=${alice.access_token}&refresh_token=${alice.refresh_token}&type=signup`);
      await page.getByRole('status').filter({ hasText: 'Acceso Torneos confirmado' }).waitFor({ timeout: 25000 });
      assert.equal(new URL(page.url()).pathname, '/torneos');
      assert.ok(await page.getByText('Acceso propio alice-app', { exact: true }).isVisible());
      await page.getByText('Usuario Phase 1.5', { exact: true }).waitFor({ timeout: 5000 });
      coreBefore = await coreSession();
      assert.equal(coreBefore.user.id, alice.user.id);
      await page.screenshot({ path: 'evidence/real-app-torneos.png', fullPage: true });
    });
    await check('second login = 0; no Torneos Auth endpoint; normal navigation retains Core', async () => {
      const before = await coreSession();
      await page.goto(`${origin}/terms`);
      await page.getByRole('heading', { name: 'Términos y Condiciones' }).waitFor();
      await page.getByRole('link', { name: 'Ver Política de Privacidad' }).click();
      await page.getByRole('heading', { name: 'Política de Privacidad' }).waitFor();
      await page.goto(`${origin}/torneos`);
      await page.getByText('Acceso propio alice-app', { exact: true }).waitFor();
      assert.equal((await coreSession()).access_token, before.access_token);
      assert.equal(evidence.traffic.filter(r => r.path?.includes('/torneos/auth/')).length, 0);
      assert.equal(evidence.traffic.filter(r => ['password', 'pkce'].includes(r.grant) || ['/auth/v1/signup', '/auth/v1/otp', '/auth/v1/authorize'].includes(r.path)).length, 0);
    });
    await check('browser cross-user SELECT empty and INSERT/PATCH ownership denied by real RLS', async () => {
      const result = await page.evaluate(async ({ other, token }) => {
        const headers = { Authorization: `Bearer ${token}`, 'content-type': 'application/json', Prefer: 'return=representation' };
        const read = await fetch(`/torneos/rest/v1/sso_probe?identity_id=eq.${other}`, { headers });
        const write = await fetch('/torneos/rest/v1/sso_probe', { method: 'POST', headers,
          body: JSON.stringify({ id: crypto.randomUUID(), identity_id: other, note: 'forbidden' }) });
        const update = await fetch(`/torneos/rest/v1/sso_probe?identity_id=eq.${other}`, { method: 'PATCH', headers, body: JSON.stringify({ note: 'forbidden' }) });
        return { rows: await read.json(), status: write.status, updated: await update.json() };
      }, { other: bob.identity, token: lastTorneosToken });
      assert.deepEqual(result, { rows: [], status: 403, updated: [] });
    });
    await check('silent Torneos renewal after TTL threshold uses existing Core session', async () => {
      const exchanges = evidence.traffic.filter(r => r.path === '/exchange').length;
      const before = await coreSession();
      await page.evaluate(() => { const original = Date.now; window.restoreClock = () => { Date.now = original; }; Date.now = () => original() + 101000; });
      try { await verify(); } finally { await page.evaluate(() => { window.restoreClock(); delete window.restoreClock; }); }
      assert.equal(evidence.traffic.filter(r => r.path === '/exchange').length, exchanges + 1);
      assert.equal((await coreSession()).access_token, before.access_token);
    });
    await check('Torneos REST unavailable -> real app Core session and profile API unaffected', async () => {
      const before = await coreSession();
      dc(['stop', 'torneos-rest'], undefined, true);
      try {
        await denied();
        assert.equal((await coreSession()).access_token, before.access_token);
        const user = await api('/auth/v1/user', before.access_token);
        assert.equal(user.data.id, alice.user.id);
        const profile = await api(`/rest/v1/usuarios?id=eq.${alice.user.id}`, before.access_token);
        assert.equal(profile.status, 200); assert.equal(profile.data[0].nombre, 'Usuario Phase 1.5');
      } finally {
        dc(['start', 'torneos-rest'], undefined, true);
        for (let i = 0; i < 50; i++) {
          if ((await api('/torneos/rest/v1/sso_probe', lastTorneosToken)).status === 200) break;
          await new Promise(resolve => setTimeout(resolve, 100));
        }
      }
      await verify();
    });
    await check('exchange transport unavailable -> Torneos fail-closed, no Core logout', async () => {
      const before = await coreSession();
      exchangeBlocked = true;
      try {
        await page.reload();
        await page.getByRole('status').filter({ hasText: 'Torneos no disponible' }).waitFor();
        assert.equal((await coreSession()).access_token, before.access_token);
        assert.equal((await api('/auth/v1/user', before.access_token)).data.id, alice.user.id);
      } finally { exchangeBlocked = false; }
      await verify();
    });
    await check('Core banned user -> existing app authorization denied; unban recovers', async () => {
      sql('core-db', `UPDATE auth.users SET banned_until=now()+interval '1 hour' WHERE id='${alice.user.id}';`);
      try { await denied(); }
      finally { sql('core-db', `UPDATE auth.users SET banned_until=NULL WHERE id='${alice.user.id}';`); }
      await verify();
    });
    await check('Core session not_after expired -> live Torneos JWT denied', async () => {
      const sid = decodeJwt((await coreSession()).access_token).session_id;
      sql('core-db', `UPDATE auth.sessions SET not_after=now()-interval '1 second' WHERE id='${sid}';`);
      try { await denied(); }
      finally { sql('core-db', `UPDATE auth.sessions SET not_after=NULL WHERE id='${sid}';`); }
      await verify();
    });
    await check('real Core SDK refresh on session hydration renews Torneos silently', async () => {
      const before = await coreSession();
      const grants = evidence.traffic.filter(r => r.grant === 'refresh_token').length;
      // Make the persisted Core session due for refresh; unchanged SDK performs the real grant.
      await page.evaluate(() => {
        const key = Object.keys(localStorage).find(k => k.endsWith('-auth-token'));
        const session = JSON.parse(localStorage.getItem(key));
        session.expires_at = Math.floor(Date.now() / 1000) + 5;
        localStorage.setItem(key, JSON.stringify(session));
      });
      await page.reload();
      await page.getByText('Acceso propio alice-app', { exact: true }).waitFor();
      assert.ok(evidence.traffic.filter(r => r.grant === 'refresh_token').length > grants);
      const after = await coreSession(); tokens.push(after.access_token, after.refresh_token);
      assert.notEqual(after.access_token, before.access_token);
      assert.equal(after.user.id, before.user.id);
      assert.equal(decodeJwt(lastTorneosToken).session_id, decodeJwt(after.access_token).session_id);
    });
    await check('Torneos tokens absent from browser storage; Core session persistence unchanged', async () => {
      const persisted = JSON.stringify(await storage()) + await page.evaluate(() => JSON.stringify({ ...sessionStorage }));
      for (const token of tokens.filter(value => value && value.split('.').length === 3 && decodeJwt(value).aud === 'arma2-torneos-local')) {
        assert.equal(persisted.includes(token), false);
      }
      assert.equal((await coreSession()).user.id, alice.user.id);
      assert.equal((await context.cookies()).length, 0);
    });
    await check('real Core logout service -> login route; live Torneos bearer replay and exchange denied', async () => {
      const before = await coreSession();
      const bearer = lastTorneosToken;
      await page.getByRole('button', { name: 'Cerrar sesión', exact: true }).click();
      await page.waitForURL(/\/login\?/);
      assert.equal((await api('/torneos/rest/v1/sso_probe', bearer)).status, 401);
      assert.equal((await api('/exchange', before.access_token, 'POST')).status, 401);
      assert.equal(Object.keys(await storage()).filter(k => k.endsWith('-auth-token')).length, 0);
    });
    await check('real app build/logs contain no server secrets or full JWTs; no production API traffic', async () => {
      const files = (await allFiles('dist')).filter(f => /\.(js|html|css|json)$/.test(f));
      const bundle = (await Promise.all(files.map(f => readFile(f, 'utf8')))).join('\n');
      const logs = dc(['logs', '--no-color'], undefined, true) + consoleMessages.join('\n');
      for (const secret of [cfg.dbPassword, cfg.readerPassword, cfg.writerPassword, cfg.coreSecret,
        ...cfg.keys.map(k => k.privateKey), ...tokens]) {
        assert.equal(bundle.includes(secret), false, 'bundle has no privileged/runtime token');
        assert.equal(logs.includes(secret), false, 'logs contain no secret/token');
      }
      assert.equal(bundle.includes('BEGIN PRIVATE KEY'), false);
      // Existing static domain links are product copy; no hosted Supabase data endpoint is configured.
      assert.equal(/https:\/\/[a-z0-9]+\.supabase\.co/.test(bundle), false);
      assert.equal(evidence.traffic.filter(r => r.path === 'EXTERNAL_BLOCKED').length, 0);
      assert.equal(consoleMessages.filter(m => m.startsWith('PAGEERROR:')).length, 0);
      evidence.bundleFilesScanned = files.length;
      evidence.secondLoginCount = 0;
      evidence.configuredOrigins = [origin];
    });
  } finally {
    evidence.status = evidence.results.every(r => r.status === 'PASS') ? 'PASS' : 'FAIL';
    await writeFile('evidence/app-console.json', JSON.stringify(consoleMessages.map(m => tokens.reduce((text, token) => text.split(token).join('[REDACTED]'), m)), null, 2));
    await writeFile('evidence/app-results.json', JSON.stringify(evidence, null, 2));
    await browser.close();
  }
});
