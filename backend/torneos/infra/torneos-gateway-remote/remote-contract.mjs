// GATEWAY REMOTE (Phase B/C) — pins for deploying the certified gateway to Deno Deploy and certifying it remotely.
//
// Architecture (unchanged, see ../torneos-gateway-auth/README.md): the gateway is an EXTERNAL app (never a Supabase
// Edge Function). Deno Deploy app `torneos-gateway`, rooted at backend/torneos/supabase/functions (the repo-root
// package.json must stay outside Deno's resolution scope), entry torneos-gateway/index.ts, app-level variables only,
// 0 layers (organization-shared configuration), no database integration, no build/install/predeploy step, production
// timeline only. Commerce stays OFF: the Production topology refuses it (topology.ts).
//
// Nothing here is an argument: the Deno API endpoints, the app slug, the variable names, the Core public key source and
// the phrases are pins. The Deno token and the Supabase PAT live only in the session process (typed on the tty).
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as G from '../torneos-gateway-auth/gateway-auth-contract.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(HERE, '../../../..');
export const FUNCTIONS_DIR = path.join(REPO_ROOT, 'backend/torneos/supabase/functions');
export const EVIDENCE_DIR = path.join(REPO_ROOT, 'backend/torneos/mp-b/evidence/gateway-remote');
export const DEPLOY_PIN_FILE = path.join(HERE, 'pins/gateway-deploy.json');
export const sha256 = (b) => crypto.createHash('sha256').update(b).digest('hex');

export const DENO_API_HOST = 'api.deno.com';
export const DENO_TOKEN_PATTERN = /^dd[op]_[A-Za-z0-9_-]{20,200}$/;
export const APP_SLUG = 'torneos-gateway';
export const ENTRYPOINT = 'torneos-gateway/index.ts';
export const GATEWAY_MOUNT = '/functions/v1/torneos-gateway';
/** The Deno Deploy default production alias `<app>.<org>.deno.net` (the only hostname this phase accepts). */
export const DEFAULT_HOST_RE = new RegExp(`^${APP_SLUG}\\.([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)\\.deno\\.net$`);
export const APP_CONFIG = Object.freeze({ install: null, build: null, predeploy: null, runtime: Object.freeze({ type: 'dynamic', entrypoint: ENTRYPOINT }), crons: false });

// The gateway environment, exactly: the names --deploy-preflight validates (gateway-auth.mjs DEPLOY_*_NAMES).
export const SECRET_NAMES = Object.freeze(['TORNEOS_CONTRACT_SERVICE_SECRET', 'TORNEOS_BRIDGE_KEYS', 'TORNEOS_DB_IDENTITY_WRITER_URL', 'TORNEOS_DB_CORE_ADAPTER_URL']);
export const CONFIG_NAMES = Object.freeze(['TORNEOS_GATEWAY_PUBLIC_URL', 'TORNEOS_ALLOWED_ORIGIN', 'CORE_AUTH_URL', 'CORE_JWT_ISSUER', 'CORE_ANON_KEY', 'CORE_CONTRACT_URL', 'TORNEOS_REST_URL', 'TORNEOS_ANON_KEY', 'TORNEOS_DB_SSL_CA']);
export const ENV_NAMES = Object.freeze([...SECRET_NAMES, ...CONFIG_NAMES].sort());
/** Never in the gateway app (by name or by pattern), in any phase of this tooling. */
export const FORBIDDEN_ENV = Object.freeze([/^CORE_SERVICE_ROLE_KEY$/, /^CORE_SECRET_KEY$/, /^CORE_JWT_SECRET$/, /^CORE_DB_URL$/, /^CORE_DATABASE_URL$/, /^SUPABASE_/, /^DATABASE_URL$/,
  /^PG[A-Z_]*$/, /^MERCADO_PAGO_/, /^TORNEOS_PAYMENT/, /^TORNEOS_COMMERCE_/]);
export const forbiddenEnvNames = (names) => names.filter((n) => FORBIDDEN_ENV.some((re) => re.test(n)));

// CORE_ANON_KEY: the Core Production public (anon-level) key, read from the public Production web bundle — the exact
// key the shipped frontend uses. No Core Management API call is made for it (the api-keys listing of Core would also
// return Core admin material, which never enters this process).
export const CORE_PUBLIC_KEY_SOURCE = Object.freeze({ page: 'https://app.arma2.com.ar/torneos', bundleRe: /src="(\/static\/js\/main\.[0-9a-f]{8,}\.js)"/ });
export function assertCoreAnonKey(value) {
  if (typeof value !== 'string') throw new Error('core_anon_key_missing');
  if (/^sb_publishable_[A-Za-z0-9_-]{10,}$/.test(value)) return { kind: 'publishable' };
  const m = /^eyJ[\w-]+\.(eyJ[\w-]+)\.[\w-]+$/.exec(value);
  if (!m) throw new Error('core_anon_key_shape');
  let c; try { c = JSON.parse(Buffer.from(m[1], 'base64url').toString('utf8')); } catch { throw new Error('core_anon_key_unreadable'); }
  if (c.role !== 'anon' || c.ref !== G.CORE_PROD_REF || c.iss !== 'supabase') throw new Error('core_anon_key_not_core_production_anon');
  return { kind: 'legacy-anon', ref: c.ref, role: c.role };
}

// ─────────────────────────── Deno Deploy API allowlist ───────────────────────────
// Only the one app. Writes are armed one at a time by the session (create → env → deploy).
const A = APP_SLUG;
export const DENO_ENDPOINTS = Object.freeze([
  { id: 'apps', method: 'GET', re: /^\/v2\/apps(\?limit=100)?$/, kind: 'read' },
  { id: 'app', method: 'GET', re: new RegExp(`^/v2/apps/${A}$`), kind: 'read' },
  { id: 'layers', method: 'GET', re: /^\/v2\/layers$/, kind: 'read' },
  { id: 'revisions', method: 'GET', re: new RegExp(`^/v2/apps/${A}/revisions(\\?limit=\\d{1,3})?$`), kind: 'read' },
  { id: 'revision', method: 'GET', re: /^\/v2\/revisions\/[A-Za-z0-9_-]{4,80}$/, kind: 'read' },
  { id: 'revision-timelines', method: 'GET', re: /^\/v2\/revisions\/[A-Za-z0-9_-]{4,80}\/timelines$/, kind: 'read' },
  { id: 'logs', method: 'GET', re: new RegExp(`^/v2/apps/${A}/logs\\?start=[0-9A-Z:.%-]+&end=[0-9A-Z:.%-]+(&limit=\\d{1,4})?$`), kind: 'read' },
  { id: 'app-create', method: 'POST', re: /^\/v2\/apps$/, kind: 'write:app-create' },
  { id: 'app-env', method: 'PATCH', re: new RegExp(`^/v2/apps/${A}$`), kind: 'write:app-env' },
  { id: 'deploy', method: 'POST', re: new RegExp(`^/v2/apps/${A}/deploy$`), kind: 'write:deploy' },
]);

export function classifyDenoRequest({ method, path: p, body }, { armedFor = null } = {}) {
  const hit = DENO_ENDPOINTS.find((e) => e.method === method && e.re.test(p));
  if (!hit) throw new Error(`deno_endpoint_not_allowlisted ${method} ${p}`);
  if (hit.kind === 'read' && body !== undefined) throw new Error('deno_get_with_body');
  if (hit.kind.startsWith('write:')) {
    const w = hit.kind.slice(6);
    if (armedFor !== w) throw new Error(`deno_write_not_armed ${w}`);
    assertDenoWriteBody(w, body);
  }
  return { id: hit.id, kind: hit.kind };
}

/** Every write body: only the pinned slug/config, only the pinned env names, no layer, no labels beyond ours. */
export function assertDenoWriteBody(w, body) {
  if (!body || typeof body !== 'object') throw new Error('deno_body_missing');
  const envKeys = (body.env_vars ?? []).map((e) => e.key);
  const bad = forbiddenEnvNames(envKeys);
  if (bad.length) throw new Error(`deno_env_forbidden ${bad.join(',')}`);
  if (envKeys.some((k) => !ENV_NAMES.includes(k))) throw new Error('deno_env_not_pinned');
  if (new Set(envKeys).size !== envKeys.length) throw new Error('deno_env_duplicate');
  for (const e of body.env_vars ?? []) {
    const keys = Object.keys(e).sort().join(',');
    if (keys !== 'contexts,key,secret,value') throw new Error('deno_env_entry_shape');
    if (e.secret !== SECRET_NAMES.includes(e.key)) throw new Error('deno_env_secret_flag');
    if (e.contexts !== 'all') throw new Error('deno_env_contexts');
  }
  if ('layers' in body && !(Array.isArray(body.layers) && body.layers.length === 0)) throw new Error('deno_layers_refused');
  if (w === 'app-create') {
    if (Object.keys(body).sort().join(',') !== 'config,env_vars,labels,layers,slug' || body.slug !== APP_SLUG) throw new Error('deno_create_shape');
    if (JSON.stringify(body.config) !== JSON.stringify(APP_CONFIG)) throw new Error('deno_create_config');
    if (envKeys.join(',') !== [...ENV_NAMES].filter((n) => n !== 'TORNEOS_GATEWAY_PUBLIC_URL').join(',')) throw new Error('deno_create_env_set');
  }
  if (w === 'app-env') {
    if (Object.keys(body).join(',') !== 'env_vars' || envKeys.join(',') !== 'TORNEOS_GATEWAY_PUBLIC_URL') throw new Error('deno_env_update_only_public_url');
  }
  if (w === 'deploy') {
    if (Object.keys(body).sort().join(',') !== 'assets,labels,preview,production') throw new Error('deno_deploy_shape');
    if (body.production !== true || body.preview !== false) throw new Error('deno_deploy_timelines');
    assertAssets(body.assets);
  }
  return true;
}

/** Deploy assets: only the gateway module graph under the functions root, utf-8 files, nothing secret-shaped. */
export function assertAssets(assets) {
  const keys = Object.keys(assets ?? {});
  if (!keys.includes(ENTRYPOINT)) throw new Error('deno_assets_no_entrypoint');
  for (const k of keys) {
    if (!/^(torneos-gateway\/[a-z0-9.-]+\.(ts|json)|torneos-payments\/(hmac|remote-hosts)\.ts)$/.test(k)) throw new Error(`deno_asset_outside_graph ${k}`);
    const a = assets[k];
    if (a.kind !== 'file' || a.encoding !== 'utf-8' || typeof a.content !== 'string') throw new Error('deno_asset_shape');
    // config.ts names the PEM header as a validation literal: a PEM header counts only when key material follows it.
    const scanned = a.content.replace(/-----BEGIN [A-Z ]*PRIVATE KEY-----(?!\s*[A-Za-z0-9+/]{40})/g, '«pem-header-literal»');
    if (G.secretFindings(scanned).length) throw new Error(`deno_asset_secret_shaped ${k}`);
  }
  return true;
}

export const PHRASES = Object.freeze({
  create: (id) => `CREATE TORNEOS GATEWAY DENO APP ${APP_SLUG} ${id}`,
  deploy: (id) => `DEPLOY TORNEOS GATEWAY ${APP_SLUG} ${id}`,
});

/** The Supabase PAT one session needs: the union of the gateway-auth modes it runs (reads + Auth Config RW for B03). */
export const SESSION_GA_MODES = Object.freeze(['--preflight', '--keyring-generate', '--b03', '--deploy-preflight', '--certify']);
export function sessionPatText() {
  const perms = new Set(SESSION_GA_MODES.flatMap((m) => G.patRequirement(m).permissions));
  const list = [...perms].filter((l) => !(l.endsWith(': Read') && perms.has(`${l}-write`))).sort();
  return [`Supabase scoped token, resource access: Organization ${G.ORG_SLUG}, expiry 24 hours:`, ...list.map((p) => `  ${p}`), '  everything else: None'].join('\n');
}
