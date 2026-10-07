// COMMERCE-PRODUCTION — operator tool of the Deno Deploy app `torneos-payments` (Mercado Pago PRODUCTION). Same discipline
// as the certified PAYMENTS TEST session: every request is classified before it reaches the socket, writes need the exact
// phrase of the exact bundle, nothing secret is printed, logged or written; evidence is secret-scanned against every value
// the run holds. One command per run (bash run-production-deploy.sh <command> [phrase…]); the wrapper reads the secrets
// with echo off and pipes them here on stdin.
//   plan       no network: bundle digest, files, env names, URLs, the gateway and frontend switches, the phrases
//   preflight  reads: both Deno apps (the TEST app must exist and is never touched), Mercado Pago /users/me attestation
//              of the PRODUCTION seller (never a test_user), Keychain custody, the env validated by the REAL config.ts
//   create     CREATE TORNEOS PAYMENTS PRODUCTION APP torneos-payments <digest12>: POST app (exact env) + first deploy
//   deploy     DEPLOY TORNEOS PAYMENTS PRODUCTION torneos-payments <digest12>: code only, the env stays as it is
//   status     reads: the app and its latest revisions (projected: ids, states, env NAMES only)
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as C from './production-contract.mjs';
import { buildProductionAssets } from './production-bundle.mjs';
import { CA_CERT } from '../torneos-gateway-auth/psql-gateway-auth.mjs';
import * as G from '../torneos-gateway-auth/gateway-auth-contract.mjs';

export class DeployStop extends Error { constructor(code, detail) { super(code); this.code = code; this.detail = detail ?? null; } }

const DENO_ENDPOINTS = Object.freeze([
  { id: 'app', method: 'GET', re: /^\/v2\/apps\/(torneos-payments|torneos-payments-test)$/, kind: 'read' },
  { id: 'revisions', method: 'GET', re: /^\/v2\/apps\/torneos-payments\/revisions\?limit=\d{1,2}$/, kind: 'read' },
  { id: 'app-create', method: 'POST', re: /^\/v2\/apps$/, kind: 'write:app-create' },
  { id: 'deploy', method: 'POST', re: /^\/v2\/apps\/torneos-payments\/deploy$/, kind: 'write:deploy' },
]);
const MP_ENDPOINTS = Object.freeze([{ id: 'users-me', method: 'GET', re: /^\/users\/me$/, kind: 'read' }]);

export function classify(endpoints, { method, path: p, body }, armedFor) {
  const hit = endpoints.find((e) => e.method === method && e.re.test(p));
  if (!hit) throw new DeployStop('ENDPOINT_NOT_ALLOWLISTED', `${method} ${p}`);
  if (hit.kind === 'read' && body !== undefined) throw new DeployStop('READ_WITH_BODY');
  if (hit.kind.startsWith('write:') && armedFor !== hit.kind.slice(6)) throw new DeployStop('WRITE_NOT_ARMED', hit.id);
  return hit;
}

/** The exact app-create body: slug, config, labels, no layers, exactly the production env (names, secret flags, values). */
export function assertCreateBody(body) {
  if (Object.keys(body).sort().join(',') !== 'config,env_vars,labels,layers,slug' || body.slug !== C.APP_SLUG) throw new DeployStop('CREATE_SHAPE');
  if (JSON.stringify(body.config) !== JSON.stringify(C.APP_CONFIG) || JSON.stringify(body.labels) !== JSON.stringify(C.APP_LABELS)) throw new DeployStop('CREATE_CONFIG');
  if (!Array.isArray(body.layers) || body.layers.length) throw new DeployStop('CREATE_LAYERS');
  const keys = body.env_vars.map((e) => e.key);
  if (C.forbiddenEnvNames(keys).length) throw new DeployStop('ENV_FORBIDDEN', C.forbiddenEnvNames(keys).join(','));
  if ([...keys].sort().join(',') !== C.ENV_NAMES.join(',')) throw new DeployStop('ENV_NOT_EXACT');
  for (const e of body.env_vars) {
    if (Object.keys(e).sort().join(',') !== 'contexts,key,secret,value' || e.contexts !== 'all' || typeof e.value !== 'string' || !e.value) throw new DeployStop('ENV_ENTRY');
    if (e.secret !== C.SECRET_NAMES.includes(e.key)) throw new DeployStop('ENV_SECRET_FLAG', e.key);
  }
  return true;
}

/** The REAL production config.ts of this tree (transpiled like every offline suite; native TS is not assumed). */
export async function realConfigLoader() {
  const { loadGatewayTree } = await import('../torneos-gateway-auth/gateway-loader.mjs');
  const tree = await loadGatewayTree();
  try { return (await tree.import('torneos-payments-production/config.ts')).loadProductionPaymentsConfig; } finally { await tree.cleanup(); }
}

/** The env of the production app, built from the operator's typed values and the Keychain; validated by the REAL config. */
export async function productionEnv({ mpToken, mpSecret, sellerId, keychain, caPem, loadConfig = realConfigLoader }) {
  if (!C.MP_TOKEN_PATTERN.test(mpToken ?? '') || !C.MP_SECRET_PATTERN.test(mpSecret ?? '') || !C.MP_SELLER_PATTERN.test(sellerId ?? '')) throw new DeployStop('MP_VALUES_MALFORMED');
  if (C.sellerOfToken(mpToken) !== sellerId) throw new DeployStop('MP_TOKEN_NOT_OF_SELLER');
  if (keychain.dbPassword.check() !== 'PRESENT') throw new DeployStop('PRODUCTION_LOGIN_PASSWORD_ABSENT (run db-0013.mjs login first)');
  if (keychain.internalSecret.check() === 'ABSENT') keychain.internalSecret.generate();
  const env = {
    TORNEOS_PAYMENT_PROVIDER: 'MERCADO_PAGO',
    MERCADO_PAGO_ENVIRONMENT: 'production',
    MERCADO_PAGO_PRODUCTION_ACCESS_TOKEN: mpToken,
    MERCADO_PAGO_PRODUCTION_WEBHOOK_SECRET: mpSecret,
    MERCADO_PAGO_PRODUCTION_SELLER_ID: sellerId,
    APP_PUBLIC_URL: C.APP_PUBLIC_URL,
    TORNEOS_PAYMENTS_NOTIFICATION_URL: C.WEBHOOK_URL,
    TORNEOS_PAYMENTS_DEPLOYMENT: 'production',
    TORNEOS_PAYMENTS_DB_URL: C.dbUrlFor(keychain.dbPassword.read()),
    TORNEOS_PAYMENTS_DB_SSL_CA: Buffer.from(caPem, 'utf8').toString('base64'),
    TORNEOS_PAYMENTS_INTERNAL_SECRET: keychain.internalSecret.read(),
  };
  const loadProductionPaymentsConfig = await loadConfig();
  try { loadProductionPaymentsConfig(env); } catch (error) { throw new DeployStop('ENV_REFUSED_BY_CONFIG', error.message); }
  return env;
}

const projectApp = (a) => (a && typeof a === 'object' ? { id: a.id ?? null, slug: a.slug ?? null, config: a.config ?? null, labels: a.labels ?? null,
  env_names: Array.isArray(a.env_vars) ? a.env_vars.map((e) => e?.key ?? null).sort() : null, updated_at: a.updated_at ?? null } : null);
const projectRevision = (r) => (r && typeof r === 'object' ? { id: r.id ?? null, status: r.status ?? null, labels: r.labels ?? null, created_at: r.created_at ?? null,
  failure_reason: r.failure_reason ?? null } : null);

export function makeSession({ deno, mp, secrets = {}, keychain, readCa = () => fs.readFileSync(CA_CERT, 'utf8'), build = buildProductionAssets, now = () => new Date() }) {
  const requests = [];
  let armed = null;
  const call = async (transport, endpoints, token, method, p, body) => {
    const hit = classify(endpoints, { method, path: p, body }, armed);
    requests.push({ id: hit.id, method, kind: hit.kind });
    const res = await transport({ token, method, path: p, body });
    return { ...res, hit };
  };
  const denoCall = (method, p, body) => call(deno, DENO_ENDPOINTS, secrets.deno, method, p, body);
  const app = async (slug) => { const r = await denoCall('GET', `/v2/apps/${slug}`); return r.status === 404 ? null : r.status === 200 ? projectApp(r.body) : (() => { throw new DeployStop('DENO_STATUS', r.status); })(); };
  const phrases = (bundle) => ({
    create: `CREATE TORNEOS PAYMENTS PRODUCTION APP ${C.APP_SLUG} ${bundle.digest.slice(0, 12)}`,
    deploy: `DEPLOY TORNEOS PAYMENTS PRODUCTION ${C.APP_SLUG} ${bundle.digest.slice(0, 12)}`,
  });
  const deployBody = (bundle) => ({ assets: bundle.assets, labels: { 'custom.git_head': bundle.head, 'custom.bundle_digest': bundle.digest }, production: true, preview: false });

  return {
    get requests() { return requests.slice(); },
    async plan() {
      const bundle = build({ requireClean: false });
      return { verdict: 'PRODUCTION_PLAN', app: C.APP_SLUG, host: C.PAYMENTS_HOST, webhook_url: C.WEBHOOK_URL, app_public_url: C.APP_PUBLIC_URL,
        bundle: { digest: bundle.digest, head: bundle.head, files: bundle.manifest }, env_names: C.ENV_NAMES, secret_names: C.SECRET_NAMES,
        gateway_env: C.GATEWAY_ENV, frontend_env: C.FRONTEND_ENV, phrases: phrases(bundle) };
    },
    async preflight() {
      const out = { verdict: 'PRODUCTION_PREFLIGHT_PASS', failures: [] };
      out.test_app_present = Boolean(await app(C.TEST_APP_SLUG));
      out.production_app = await app(C.APP_SLUG);
      const me = await call(mp, MP_ENDPOINTS, secrets.mpToken, 'GET', '/users/me');
      const attestation = me.status === 200 ? C.productionAttestation(me.body, secrets.sellerId) : { ok: false, reason: `status_${me.status}` };
      out.attestation = attestation;
      if (!attestation.ok) out.failures.push(`attestation ${attestation.reason}`);
      out.keychain = { dbPassword: keychain.dbPassword.check(), internalSecret: keychain.internalSecret.check() };
      if (out.keychain.dbPassword !== 'PRESENT') out.failures.push('production login password absent');
      // The env as create would build it, without writing anything (an absent internal key is stood in for, not generated).
      const standIn = crypto.randomBytes(32).toString('hex');
      const internalSecret = out.keychain.internalSecret === 'PRESENT' ? keychain.internalSecret
        : { check: () => 'PRESENT', generate: () => null, read: () => standIn };
      try { await productionEnv({ ...secrets, keychain: { ...keychain, internalSecret }, caPem: readCa() }); } catch (error) { out.failures.push(`env ${error.code ?? error.message}`); }
      if (out.failures.length) out.verdict = 'PRODUCTION_PREFLIGHT_FAILED';
      return out;
    },
    async create(words) {
      const bundle = build();
      if (words.join(' ') !== phrases(bundle).create) throw new DeployStop('PHRASE_REQUIRED', phrases(bundle).create);
      if (await app(C.APP_SLUG)) throw new DeployStop('APP_ALREADY_EXISTS');
      const me = await call(mp, MP_ENDPOINTS, secrets.mpToken, 'GET', '/users/me');
      const attestation = me.status === 200 ? C.productionAttestation(me.body, secrets.sellerId) : { ok: false, reason: `status_${me.status}` };
      if (!attestation.ok) throw new DeployStop('MP_NOT_PRODUCTION_SELLER', attestation.reason);
      const env = await productionEnv({ ...secrets, keychain, caPem: readCa() });
      const body = { slug: C.APP_SLUG, config: C.APP_CONFIG, labels: C.APP_LABELS, layers: [],
        env_vars: C.ENV_NAMES.map((key) => ({ key, value: env[key], secret: C.SECRET_NAMES.includes(key), contexts: 'all' })) };
      assertCreateBody(body);
      armed = 'app-create';
      let created;
      try { created = await denoCall('POST', '/v2/apps', body); } finally { armed = null; }
      if (![200, 201].includes(created.status)) throw new DeployStop('APP_CREATE_FAILED', created.status);
      armed = 'deploy';
      let deployed;
      try { deployed = await denoCall('POST', `/v2/apps/${C.APP_SLUG}/deploy`, deployBody(bundle)); } finally { armed = null; }
      if (![200, 201, 202].includes(deployed.status)) throw new DeployStop('DEPLOY_FAILED', deployed.status);
      return { verdict: 'PRODUCTION_APP_CREATED', app: projectApp(created.body), revision: projectRevision(deployed.body), bundle: { digest: bundle.digest, head: bundle.head } };
    },
    async deploy(words) {
      const bundle = build();
      if (words.join(' ') !== phrases(bundle).deploy) throw new DeployStop('PHRASE_REQUIRED', phrases(bundle).deploy);
      const current = await app(C.APP_SLUG);
      if (!current) throw new DeployStop('APP_ABSENT');
      if ([...(current.env_names ?? [])].join(',') !== C.ENV_NAMES.join(',')) throw new DeployStop('APP_ENV_DRIFT', current.env_names);
      armed = 'deploy';
      let deployed;
      try { deployed = await denoCall('POST', `/v2/apps/${C.APP_SLUG}/deploy`, deployBody(bundle)); } finally { armed = null; }
      if (![200, 201, 202].includes(deployed.status)) throw new DeployStop('DEPLOY_FAILED', deployed.status);
      return { verdict: 'PRODUCTION_APP_REDEPLOYED', revision: projectRevision(deployed.body), bundle: { digest: bundle.digest, head: bundle.head } };
    },
    async status() {
      const current = await app(C.APP_SLUG);
      const revisions = current ? await denoCall('GET', `/v2/apps/${C.APP_SLUG}/revisions?limit=5`) : null;
      const list = Array.isArray(revisions?.body) ? revisions.body : Array.isArray(revisions?.body?.items) ? revisions.body.items : [];
      return { verdict: 'PRODUCTION_STATUS', app: current, revisions: list.map(projectRevision), at: now().toISOString() };
    },
  };
}

/** Evidence never carries a value the run holds (and nothing secret-shaped at all). */
export function writeEvidence(name, doc, known, { dir = C.EVIDENCE_DIR, now = new Date() } = {}) {
  const text = `${JSON.stringify(doc, null, 1)}\n`;
  for (const value of known) if (value && value.length >= 8 && text.includes(value)) throw new DeployStop('EVIDENCE_WOULD_LEAK');
  if (G.secretFindings(text).length) throw new DeployStop('EVIDENCE_SECRET_SHAPED');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${name}-${now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z')}.json`);
  fs.writeFileSync(file, text, { flag: 'wx' });
  return file;
}

async function main() {
  const [command, ...words] = process.argv.slice(2);
  const raw = fs.readFileSync(0, 'utf8');
  const secrets = raw.trim() ? JSON.parse(raw) : {};
  const { httpsTo } = await import('../torneos-payments-test/payments-clients.mjs');
  const { productionKeychain } = await import('./keychain-payments-production.mjs');
  const session = makeSession({
    deno: httpsTo(C.DENO_API_HOST, { userAgent: 'arma2-torneos-payments-production/1' }),
    mp: httpsTo(C.MP_API_HOST, { userAgent: 'arma2-torneos-payments-production/1' }),
    secrets, keychain: productionKeychain(),
  });
  const known = Object.values(secrets).filter((v) => typeof v === 'string');
  let out;
  try {
    if (!['plan', 'preflight', 'create', 'deploy', 'status'].includes(command)) throw new DeployStop('USAGE plan|preflight|create|deploy|status');
    out = await session[command](words);
  } catch (error) {
    out = { verdict: 'PRODUCTION_STOP', code: error.code ?? 'ERROR', detail: typeof error.detail === 'string' ? error.detail.slice(0, 200) : error.detail ?? null };
  }
  out.requests = session.requests;
  if (command !== 'plan') out.evidence = writeEvidence(`pp-${command}`, out, known);
  process.stdout.write(`${JSON.stringify({ ...out, bundle: out.bundle ? { digest: out.bundle.digest, head: out.bundle.head } : undefined }, null, 1)}\n`);
  secrets.deno = secrets.mpToken = secrets.mpSecret = null;
  process.exit(/STOP|FAILED/.test(out.verdict) ? 1 : 0);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
