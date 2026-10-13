// The RUNNER of 0018 on a real PostgreSQL with pg_cron, pg_net and Vault (the lab image preloads them as hosted
// Supabase does): the two jobs exist at their offset minutes, the lifecycle job's command runs, and the purge caller's
// request — sent by pg_net from inside the database — reaches a local receiver and is accepted by the REAL
// torneos-media-store handler with the purge secret read from Vault (the signature computed in SQL is the protocol's).
//   COMMERCE_PRODUCTION_LAB_CONTAINER=arma2-season-lab-db node --test backend/torneos/season-lifecycle/season-cron.test.mjs
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { up, MIGRATIONS_DIR, REPO, sql, sqlTry } from '../commerce-production/lab/pg-lab.mjs';
import { loadGatewayTree } from '../infra/torneos-gateway-auth/gateway-loader.mjs';
import { storeEnv } from '../media-store-v1/test/support.mjs';

const CRON = readFileSync(path.join(REPO, 'backend/torneos/season-lifecycle/scheduler/season-lifecycle-cron.sql'), 'utf8');
const CRON_ROLLBACK = readFileSync(path.join(REPO, 'backend/torneos/season-lifecycle/scheduler/season-lifecycle-cron.rollback.sql'), 'utf8');
const M18 = readFileSync(path.join(MIGRATIONS_DIR, '00000000000018_season_media_lifecycle.sql'), 'utf8');
const one = (q) => sql(q).trim();
const PURGE_SECRET = randomBytes(32).toString('hex');
let tree; let store; let server; let port; const received = [];

before(async () => {
  await up({ upTo: '00000000000017' });
  if (one("select to_regprocedure('public.run_tournament_season_media_lifecycle()') is not null") !== 't') sql(M18);
  tree = await loadGatewayTree();
  store = await tree.import('torneos-media-store/store.ts');
  server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      received.push({ method: req.method, url: req.url, headers: req.headers, body: Buffer.concat(chunks) });
      res.writeHead(204).end();
    });
  });
  await new Promise((resolve) => server.listen(0, '0.0.0.0', resolve));
  port = server.address().port;
});
after(async () => {
  sqlTry(CRON_ROLLBACK);
  sqlTry("DELETE FROM vault.secrets WHERE name IN ('torneos_media_purge_secret', 'torneos_media_store_purge_url')");
  await new Promise((resolve) => server?.close(resolve));
  await tree?.cleanup();
});

test('jobs at the offset minutes; without the Vault entries the caller sends nothing', () => {
  sqlTry(CRON_ROLLBACK);
  sql("DELETE FROM vault.secrets WHERE name IN ('torneos_media_purge_secret', 'torneos_media_store_purge_url')");
  sql(CRON);
  const jobs = one("select string_agg(jobname || ' ' || schedule || ' ' || command, ' | ' order by jobname) from cron.job where jobname like 'torneos-season-media-%'");
  assert.equal(jobs, 'torneos-season-media-lifecycle 3-59/15 * * * * select public.run_tournament_season_media_lifecycle() | '
    + 'torneos-season-media-purge 8-59/15 * * * * select private.request_tournament_media_purge(50)');
  assert.equal(one('select private.request_tournament_media_purge(50) is null'), 't');
  // The lifecycle job's command, exactly as pg_cron runs it.
  assert.match(one('select public.run_tournament_season_media_lifecycle()'), /"seasonsClosed": \d+/);
  assert.equal(one("select has_function_privilege('authenticated', 'private.request_tournament_media_purge(integer)', 'EXECUTE')"), 'f');
});

test('the purge request pg_net sends is accepted by the real torneos-media-store handler (signature built in SQL)', async () => {
  sql(`select vault.create_secret('${PURGE_SECRET}', 'torneos_media_purge_secret')`);
  sql(`select vault.create_secret('http://host.docker.internal:${port}/torneos-media-store/v1/media-purge', 'torneos_media_store_purge_url')`);
  const requestId = one('select private.request_tournament_media_purge(7)');
  assert.match(requestId, /^\d+$/);
  for (let i = 0; i < 40 && received.length === 0; i += 1) await new Promise((r) => { setTimeout(r, 250); });
  assert.equal(received.length, 1, 'pg_net delivered exactly one request');
  const got = received[0];
  assert.equal(got.method, 'POST'); assert.equal(got.url, '/torneos-media-store/v1/media-purge');
  assert.equal(got.headers['x-torneos-store-identity'], undefined);
  // Replay it into the real handler, purge secret configured, Data API / Storage emulated: 200 means the signature over
  // the exact bytes pg_net sent is valid; a tampered body or a wrong secret is 401.
  const cfg = store.loadStoreConfig({ ...storeEnv(), TORNEOS_MEDIA_PURGE_SECRET: PURGE_SECRET });
  const fakeFetch = async (url) => (String(url).endsWith('/rpc/claim_tournament_media_purge')
    ? new Response(JSON.stringify({ assets: [], orphans: [] }), { status: 200 }) : new Response('[]', { status: 200 }));
  const replay = (body, secretCfg = cfg) => store.handle(new Request(`http://store.example${got.url}`, { method: 'POST', body,
    headers: { 'content-type': got.headers['content-type'], 'x-torneos-store-timestamp': got.headers['x-torneos-store-timestamp'],
      'x-torneos-store-signature': got.headers['x-torneos-store-signature'] } }), secretCfg, { fetchImpl: fakeFetch });
  const ok = await replay(got.body);
  assert.equal(ok.status, 200);
  assert.deepEqual(await ok.json(), { purged: 0, failed: 0, orphansRemoved: 0, errors: [] });
  assert.deepEqual(JSON.parse(got.body.toString('utf8')), { limit: 7 });
  assert.equal((await replay(Buffer.from('{"limit": 99}'))).status, 401, 'a body other than the signed one is refused');
  const other = store.loadStoreConfig({ ...storeEnv(), TORNEOS_MEDIA_PURGE_SECRET: randomBytes(32).toString('hex') });
  assert.equal((await replay(got.body, other)).status, 401, 'another purge secret is refused');
});

test('rollback: no job left, caller gone; re-apply works', () => {
  sql(CRON_ROLLBACK);
  assert.equal(one("select count(*) from cron.job where jobname like 'torneos-season-media-%'"), '0');
  assert.equal(one("select to_regprocedure('private.request_tournament_media_purge(integer)') is null"), 't');
  sql(CRON);
  assert.equal(one("select count(*) from cron.job where jobname like 'torneos-season-media-%' and active"), '2');
});
