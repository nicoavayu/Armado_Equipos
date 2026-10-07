#!/usr/bin/env node
// Starts the app against the B04 hybrid lab: Core = the lab's real GoTrue/PostgREST
// (through the bridge, 58422), Torneos = the lab gateway (through the bridge, 58423).
// Fail-closed like qa:torneos:review: the lab must be up, the anon key comes from the
// lab's own .runtime (never printed), every flag is set in the child process and the
// .env* files never decide the target.
//
//   node scripts/torneos-frontend/start-hybrid-lab-app.mjs            (checks only)
//   node scripts/torneos-frontend/start-hybrid-lab-app.mjs --start    (bridge + app)
//   B04_LAB_APP_PORT=3103 node scripts/torneos-frontend/start-hybrid-lab-app.mjs --start --connected
//     (another port when 3000 is taken; --connected = REACT_APP_TORNEOS_CONNECTED_MODE=on, which only works against a
//      lab gateway started with TORNEOS_CONNECTED_MODE=on; --branding = REACT_APP_TORNEOS_BRANDING_MODE=on, against a lab
//      started with TORNEOS_BRANDING_MODE=on — logos/shields in the lab's Torneos storage, signed by the gateway;
//      --production-flags = the feature flags Production's bundle carries today: PLAN READ on, Estudio Social on, public
//      pages on — against a lab gateway with TORNEOS_PLAN_READ_MODE=on and TORNEOS_SOCIAL_MODE=on;
//      --media = the photo galleries (REACT_APP_TORNEOS_MEDIA_ENABLED=true + REACT_APP_TORNEOS_MEDIA_MODE=on), against a
//      lab gateway with TORNEOS_MEDIA_MODE=on — e.g. backend/torneos/media-v1/lab/media-lab.mjs, which runs its own gateway
//      and bridge ports through B04_LAB_GATEWAY_ORIGIN, B04_LAB_BRIDGE_CORE_PORT and B04_LAB_BRIDGE_GATEWAY_PORT)
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const labRuntime = path.join(root, 'integration/torneos-core-contracts/.runtime/config.json');
const APP_PORT = process.env.B04_LAB_APP_PORT || '3000';
if (!/^3[0-9]{3}$/.test(APP_PORT)) { console.error('B04_LAB_APP_PORT must be a 3000-3999 port'); process.exit(1); }
const APP_ORIGIN = `http://localhost:${APP_PORT}`;
const CONNECTED = process.argv.includes('--connected');
const BRANDING = process.argv.includes('--branding');
const PRODUCTION_FLAGS = process.argv.includes('--production-flags');
// --edge: the bridge talks to the lab's Edge gateway (the hosted runtime) instead of its Node port.
const EDGE = process.argv.includes('--edge');
const MEDIA = process.argv.includes('--media');
const CORE_URL = `http://127.0.0.1:${process.env.B04_LAB_BRIDGE_CORE_PORT || '58422'}`;
const GATEWAY_URL = `http://127.0.0.1:${process.env.B04_LAB_BRIDGE_GATEWAY_PORT || '58423'}`;
const GATEWAY_HEALTH = process.env.B04_LAB_GATEWAY_ORIGIN
  ? `${process.env.B04_LAB_GATEWAY_ORIGIN}/health`
  : (EDGE ? 'http://127.0.0.1:58421/torneos-gateway/health' : 'http://127.0.0.1:58420/health');

async function probe(url) {
  try { const r = await fetch(url, { signal: AbortSignal.timeout(3000) }); return r.status; } catch { return null; }
}

const gatewayHealth = await probe(GATEWAY_HEALTH);
const coreHealth = await probe('http://127.0.0.1:58424/auth/v1/health');
if (gatewayHealth !== 200 || coreHealth !== 200) {
  console.error(`B04 hybrid lab is not up (gateway ${gatewayHealth}, core-api ${coreHealth}).`);
  console.error('  cd integration/torneos-core-contracts && PHASE3A_LAB_PROJECT=arma2-b04-hybrid-lab node lab.mjs up');
  console.error('  docker compose -p arma2-b04-hybrid-lab --env-file .runtime/compose.env -f compose.yaml -f compose.b04.yaml up -d core-api');
  process.exit(1);
}
if (!fs.existsSync(labRuntime)) { console.error('lab .runtime/config.json missing'); process.exit(1); }
const { anonKey } = JSON.parse(fs.readFileSync(labRuntime, 'utf8'));
if (!anonKey) { console.error('lab anon key missing'); process.exit(1); }

const env = {
  ...process.env,
  PORT: APP_PORT,
  BROWSER: 'none',
  REACT_APP_SUPABASE_URL: CORE_URL,
  REACT_APP_SUPABASE_ANON_KEY: anonKey,
  REACT_APP_TORNEOS_GATEWAY_URL: GATEWAY_URL,
  REACT_APP_PUBLIC_APP_URL: APP_ORIGIN,
  REACT_APP_AUTH_REDIRECT_URL: `${APP_ORIGIN}/auth/callback`,
  REACT_APP_DEPLOY_ENV: 'development',
  REACT_APP_TORNEOS_DATA_ENV: 'local',
  REACT_APP_LOCAL_EDIT_MODE: 'false',
  REACT_APP_TORNEOS_ENABLED: 'true',
  REACT_APP_TORNEOS_WORKSPACES_ENABLED: 'true',
  REACT_APP_TORNEOS_WORKSPACE_SWITCHER_ENABLED: 'true',
  REACT_APP_TORNEOS_DEEP_LINKS_ENABLED: 'true',
  REACT_APP_TORNEOS_NOTIFICATIONS_ENABLED: 'false',
  REACT_APP_TORNEOS_OFFICIAL_STATS_ENABLED: 'false',
  // Explorar torneos shows a call on the tournament's published public page: the connected run needs public pages.
  REACT_APP_TORNEOS_PUBLIC_PAGES_ENABLED: CONNECTED || PRODUCTION_FLAGS ? 'true' : 'false',
  REACT_APP_TORNEOS_MEDIA_ENABLED: MEDIA ? 'true' : 'false',
  REACT_APP_TORNEOS_MEDIA_MODE: MEDIA ? 'on' : 'off',
  REACT_APP_TORNEOS_MEDIA_UPLOAD_ENABLED: 'false',
  REACT_APP_TORNEOS_SOCIAL_GENERATOR_ENABLED: PRODUCTION_FLAGS ? 'true' : 'false',
  ...(PRODUCTION_FLAGS ? { REACT_APP_TORNEOS_PLAN_READ_MODE: 'on' } : {}),
  REACT_APP_TORNEOS_MEDIA_SIGNER_READY: 'false',
  REACT_APP_TORNEOS_MEDIA_WORKER_READY: 'false',
  REACT_APP_TORNEOS_MEDIA_AV_READY: 'false',
  REACT_APP_TORNEOS_MEDIA_CLEANUP_READY: 'false',
  REACT_APP_TORNEOS_MEDIA_OBSERVABILITY_READY: 'false',
  REACT_APP_TORNEOS_PRODUCTION_ENABLED: 'false',
  REACT_APP_PRODUCTION_PROJECT_REF: process.env.REACT_APP_PRODUCTION_PROJECT_REF || '',
  REACT_APP_TORNEOS_ISOLATED_SSO: 'false',
  REACT_APP_TORNEOS_CONNECTED_MODE: CONNECTED ? 'on' : 'off',
  REACT_APP_TORNEOS_BRANDING_MODE: BRANDING ? 'on' : 'off',
  B04_LAB_APP_ORIGIN: APP_ORIGIN,
  ...(EDGE ? { B04_LAB_GATEWAY: 'edge' } : {}),
};
console.log(`B04 hybrid lab app: Core ${CORE_URL} · gateway ${GATEWAY_URL} · app ${APP_ORIGIN} · DATA_ENV=local · connected ${CONNECTED ? 'on' : 'off'} · branding ${BRANDING ? 'on' : 'off'} · media ${MEDIA ? 'on' : 'off'} · anon key from lab .runtime (not printed)`);
if (!process.argv.includes('--start')) process.exit(0);

const bridge = spawn(process.execPath, [path.join(root, 'scripts/torneos-frontend/lab-bridge.mjs')], { env, stdio: 'inherit' });
const app = spawn('npx', ['react-scripts', 'start'], { cwd: root, env, stdio: 'inherit' });
const stop = () => { bridge.kill(); app.kill(); };
process.on('SIGINT', stop); process.on('SIGTERM', stop);
app.on('exit', (code) => { bridge.kill(); process.exit(code ?? 0); });
