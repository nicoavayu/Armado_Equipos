#!/usr/bin/env node
// GATEWAY/AUTH — offline MEASUREMENTS of local PostgREST v14.15 against the post-bootstrap database (not a gate):
//   window  when does the in-DB pgrst.db_pre_request take effect after a start? 4 starts reaching the DB after
//           0 / 300 / 1500 / 3000 ms (the connection-recovery path); a bridge token for a non-existent identity is
//           polled every 25 ms: 200 = served WITHOUT the pre_request, 401/PT401 = the identity gate.
//   aud     the same bridge token (aud arma2-torneos-local) with jwt-aud unset / "authenticated" / "arma2-torneos-local".
// Local Docker only (--pull never), throwaway containers and keys; evidence → mp-b/evidence/gateway-auth/.
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import crypto from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import * as G from './gateway-auth-contract.mjs';
import * as FC from '../torneos-foundation/foundation-contract.mjs';
import { generateRing } from './keyring.mjs';
import { mintBridgeToken } from './bridge-probe.mjs';
import { EVIDENCE_DIR } from './gateway-auth.mjs';

const D = ['/Applications/Docker.app/Contents/Resources/bin/docker', '/usr/local/bin/docker', '/opt/homebrew/bin/docker'].find((p) => fs.existsSync(p));
if (!D) { console.error('docker not found'); process.exit(2); }
const dk = (a) => execFileSync(D, a, { encoding: 'utf8' });
const PW = crypto.randomBytes(12).toString('hex');
const NET = `gam-${process.pid}`; const EDGE = `${NET}-e`; const DB = `gam-db-${process.pid}`; const PR = `gam-pr-${process.pid}`;
const psql = (input, user = 'postgres') => spawnSync(D, ['exec', '-i', '-e', `PGPASSWORD=${PW}`, DB, 'psql', '-U', user, '-h', 'localhost', '-d', 'postgres', '-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1', '-f', '-'], { input, encoding: 'utf8' });
const get = (port, token) => new Promise((r) => { const q = http.get({ host: '127.0.0.1', port, path: '/torneos_identity?select=id&limit=1', headers: { Authorization: `Bearer ${token}` } }, (res) => { let b = ''; res.on('data', (c) => { b += c; }); res.on('end', () => { let j = null; try { j = JSON.parse(b); } catch { j = null; } r(`${res.statusCode}${j?.code ? `/${j.code}` : ''}`); }); }); q.on('error', () => r('ERR')); });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function start(ring, { aud = null, reachAfterMs = 0, pollMs = 4000 }) {
  spawnSync(D, ['rm', '-f', PR]);
  dk(['run', '-d', '--rm', '--network', EDGE, '-p', '127.0.0.1::3000', '--name', PR, '-e', `PGRST_DB_URI=postgres://authenticator:${PW}@db:5432/postgres`, '-e', 'PGRST_DB_SCHEMAS=public,graphql_public', '-e', 'PGRST_DB_ANON_ROLE=anon',
    '-e', `PGRST_JWT_SECRET=${JSON.stringify(ring.jwks)}`, '-e', 'PGRST_SERVER_PORT=3000', '-e', 'PGRST_JWT_CACHE_MAX_LIFETIME=0', ...(aud ? ['-e', `PGRST_JWT_AUD=${aud}`] : []), '--pull', 'never', 'public.ecr.aws/supabase/postgrest:v14.15']);
  await sleep(reachAfterMs);
  dk(['network', 'connect', NET, PR]);
  const port = Number(dk(['port', PR, '3000/tcp']).trim().split('\n')[0].split(':').pop());
  const t0 = Date.now(); const seen = [];
  while (Date.now() - t0 < pollMs) {
    const s = await get(port, mintBridgeToken({ pkcs8: ring.slots[0].pkcs8, kid: ring.slots[0].kid }));
    if (!seen.length || seen[seen.length - 1][1] !== s) seen.push([Date.now() - t0, s]);
    await sleep(25);
  }
  return seen;
}

const out = { generated_at: new Date().toISOString(), tool: 'backend/torneos/infra/torneos-gateway-auth/measure-postgrest.mjs', local_only: true, images: ['public.ecr.aws/supabase/postgres:17.6.1.147', 'public.ecr.aws/supabase/postgrest:v14.15'], window: [], aud: [] };
try {
  dk(['network', 'create', '--internal', NET]); dk(['network', 'create', EDGE]);
  dk(['run', '-d', '--rm', '--network', NET, '--network-alias', 'db', '--name', DB, '-e', `POSTGRES_PASSWORD=${PW}`, '--pull', 'never', 'public.ecr.aws/supabase/postgres:17.6.1.147']);
  for (let i = 0; i < 90 && psql('select 1').status !== 0; i++) await sleep(1000);
  for (const m of FC.loadMigrations(G.REPO_ROOT)) if (psql(fs.readFileSync(m.abs)).status !== 0) throw new Error(`migration ${m.seq}`);
  const verifiers = Object.fromEntries(G.EDGE_LOGINS.map((l) => [l.login, G.scramVerifier(crypto.randomBytes(30).toString('base64url'))]));
  if (psql(G.renderBootstrapSql(verifiers)).status !== 0) throw new Error('bootstrap');
  psql(`alter role authenticator with password '${PW}'`, 'supabase_admin');
  const ring = generateRing();
  for (const reachAfterMs of [0, 300, 1500, 3000]) {
    const seen = await start(ring, { reachAfterMs });
    const first200 = seen.findIndex(([, v]) => v === '200');
    const servedWithout = first200 < 0 ? 0 : ((seen.slice(first200 + 1).find(([, v]) => v !== '200')?.[0] ?? 4000) - seen[first200][0]);
    out.window.push({ db_reachable_after_ms: reachAfterMs, transitions: seen, served_without_pre_request_ms: servedWithout });
    console.log(`window reach+${reachAfterMs}ms: ${JSON.stringify(seen)}`);
  }
  for (const aud of [null, 'authenticated', 'arma2-torneos-local']) {
    const seen = await start(ring, { aud, reachAfterMs: 0, pollMs: 2500 });
    out.aud.push({ jwt_aud: aud ?? '(unset)', token_aud: G.BRIDGE.audience, final: seen[seen.length - 1][1] });
    console.log(`jwt-aud ${aud ?? '(unset)'} → ${seen[seen.length - 1][1]}`);
  }
} finally {
  spawnSync(D, ['rm', '-f', PR, DB]); for (const n of [EDGE, NET]) spawnSync(D, ['network', 'rm', n]);
}
out.summary = { starts_with_window: out.window.filter((w) => w.served_without_pre_request_ms > 0).length, starts: out.window.length, max_window_ms: Math.max(...out.window.map((w) => w.served_without_pre_request_ms)),
  aud_accepts_bridge: out.aud.filter((a) => a.final === '401/PT401').map((a) => a.jwt_aud), aud_rejects_bridge: out.aud.filter((a) => a.final !== '401/PT401').map((a) => `${a.jwt_aud} → ${a.final}`) };
const text = `${JSON.stringify(out, null, 1)}\n`;
if (G.secretFindings(text, [PW]).length) throw new Error('measurement carries a secret');
fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
const file = path.join(EVIDENCE_DIR, `postgrest-measurements-${out.generated_at.replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z')}.json`);
fs.writeFileSync(file, text, { flag: 'wx' });
console.log(`${JSON.stringify(out.summary)}\nEVIDENCE ${path.relative(G.REPO_ROOT, file)} ${G.sha256(text)}`);
